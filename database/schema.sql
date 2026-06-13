-- ============================================================================
-- LMS SaaS — Canonical PostgreSQL schema (source of truth)
-- ============================================================================
-- Target: PostgreSQL 15+ (Neon / Vercel Postgres).
-- Tenancy: HYBRID.
--   * pool tenants share these tables; isolation enforced by tenant_id + RLS
--     (see /database/policies/rls.sql).
--   * silo tenants get this same schema in a dedicated database/branch.
-- Conventions:
--   * UUID primary keys (uuid_generate_v7-style via pg_uuidv7 or gen_random_uuid).
--   * Every tenant-owned table carries tenant_id for pool RLS + silo symmetry.
--   * snake_case identifiers; created_at/updated_at audit columns.
-- NOTE: This is the baseline; domain modules are extended as specs land.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";    -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "citext";      -- case-insensitive email
CREATE EXTENSION IF NOT EXISTS "pg_trgm";     -- search

-- Helper: current tenant from the request-scoped GUC set by @lms/db.withTenant.
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

-- Reusable updated_at trigger.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
  LANGUAGE plpgsql AS $$
  BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- ============================================================================
-- CONTROL PLANE  (lives in the control-plane DB; replicated here for silo)
-- ============================================================================
CREATE TABLE IF NOT EXISTS tenant (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          citext NOT NULL UNIQUE,
  name          text   NOT NULL,
  -- Sub-tenant hierarchy: a parent (e.g. a district / university) owns child
  -- sub-tenants (e.g. schools / colleges). NULL parent_id = a top-level tenant.
  parent_id     uuid REFERENCES tenant(id) ON DELETE RESTRICT,
  kind          text   NOT NULL DEFAULT 'standalone'
                   CHECK (kind IN ('standalone','parent','sub')),
  tier          text   NOT NULL DEFAULT 'pool' CHECK (tier IN ('pool','silo')),
  status        text   NOT NULL DEFAULT 'provisioning'
                   CHECK (status IN ('provisioning','active','suspended','deleted')),
  region        text   NOT NULL DEFAULT 'us-east',
  -- For silo tenants: opaque reference resolved to a connection string via
  -- the secret store (never the raw DSN).
  database_ref  text,
  plan_id       uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  -- A sub-tenant must declare a parent; parents/standalone must not.
  CONSTRAINT tenant_parent_consistency CHECK (
    (kind = 'sub' AND parent_id IS NOT NULL) OR
    (kind <> 'sub' AND parent_id IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS ix_tenant_parent ON tenant(parent_id);
CREATE TRIGGER trg_tenant_updated BEFORE UPDATE ON tenant
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- All tenant ids in a subtree (the root plus every descendant sub-tenant).
-- Used for district roll-up reporting/billing while row-level data stays
-- isolated per sub-tenant via RLS.
CREATE OR REPLACE FUNCTION tenant_subtree(root uuid) RETURNS TABLE (id uuid)
  LANGUAGE sql STABLE AS $$
    WITH RECURSIVE sub AS (
      SELECT t.id FROM tenant t WHERE t.id = root
      UNION ALL
      SELECT c.id FROM tenant c JOIN sub ON c.parent_id = sub.id
    )
    SELECT id FROM sub
$$;


-- Billing / packaging (Core + add-ons: Performance+, Creator+, Achievement+, Lumi).
CREATE TABLE IF NOT EXISTS plan (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  base_price_cents integer NOT NULL DEFAULT 0,
  billing_model text NOT NULL DEFAULT 'per_active_user'
                 CHECK (billing_model IN ('per_active_user','per_fte','flat')),
  addons      jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS subscription (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  plan_id     uuid NOT NULL REFERENCES plan(id),
  status      text NOT NULL DEFAULT 'trialing'
                 CHECK (status IN ('trialing','active','past_due','canceled')),
  seats       integer,
  period_start timestamptz,
  period_end   timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_subscription_tenant ON subscription(tenant_id);

-- ============================================================================
-- ORG-UNIT HIERARCHY  (organization → … → section/group)
-- ============================================================================
CREATE TABLE IF NOT EXISTS org_unit (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  type        text NOT NULL CHECK (type IN (
                 'organization','department','semester','course_template',
                 'course_offering','section','group')),
  parent_id   uuid REFERENCES org_unit(id) ON DELETE CASCADE,
  name        text NOT NULL,
  code        text,
  -- Materialised path of ancestor ids enables fast cascade/subtree queries.
  path        uuid[] NOT NULL DEFAULT '{}',
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_org_unit_tenant_type ON org_unit(tenant_id, type);
CREATE INDEX IF NOT EXISTS ix_org_unit_parent ON org_unit(parent_id);
CREATE INDEX IF NOT EXISTS ix_org_unit_path ON org_unit USING gin (path);
CREATE TRIGGER trg_org_unit_updated BEFORE UPDATE ON org_unit
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- IDENTITY & RBAC
-- ============================================================================
CREATE TABLE IF NOT EXISTS app_user (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  email        citext NOT NULL,
  display_name text NOT NULL,
  status       text NOT NULL DEFAULT 'invited'
                  CHECK (status IN ('invited','active','inactive')),
  external_id  text,                 -- OneRoster sourcedId / SSO subject
  locale       text NOT NULL DEFAULT 'en',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);
CREATE INDEX IF NOT EXISTS ix_user_external ON app_user(tenant_id, external_id);
CREATE TRIGGER trg_user_updated BEFORE UPDATE ON app_user
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- SSO providers (SAML / OIDC) per tenant.
CREATE TABLE IF NOT EXISTS identity_provider (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('saml','oidc','ldap','cas')),
  display_name text NOT NULL,
  config      jsonb NOT NULL DEFAULT '{}'::jsonb,  -- metadata URL, client id, etc.
  is_enabled  boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_identity (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  provider_id uuid REFERENCES identity_provider(id) ON DELETE SET NULL,
  subject     text NOT NULL,         -- provider subject / NameID
  UNIQUE (provider_id, subject)
);

-- Local password credential for users not federated through an external IdP.
-- SSO-only users have no row here; auth then flows through identity_provider.
CREATE TABLE IF NOT EXISTS user_credential (
  user_id       uuid PRIMARY KEY REFERENCES app_user(id) ON DELETE CASCADE,
  tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  algo          text NOT NULL DEFAULT 'scrypt',
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_user_credential_updated BEFORE UPDATE ON user_credential
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Rotating refresh tokens. Each login starts a token "family"; on every refresh
-- the presented token is revoked and replaced. Re-use of an already-revoked
-- token (replay/theft) is detected and revokes the whole family.
CREATE TABLE IF NOT EXISTS refresh_token (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  family_id   uuid NOT NULL,
  token_hash  text NOT NULL UNIQUE,   -- sha256(opaque token); raw token never stored
  issued_at   timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  replaced_by uuid REFERENCES refresh_token(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS ix_refresh_token_user ON refresh_token(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS ix_refresh_token_family ON refresh_token(family_id);

CREATE TABLE IF NOT EXISTS role (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  name       text NOT NULL,
  is_system  boolean NOT NULL DEFAULT false,
  UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS permission (
  key         text PRIMARY KEY,      -- e.g. 'discussions:posts:manage'
  description text
);

CREATE TABLE IF NOT EXISTS role_permission (
  role_id        uuid NOT NULL REFERENCES role(id) ON DELETE CASCADE,
  permission_key text NOT NULL REFERENCES permission(key) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_key)
);

-- Role granted to a user at an org-unit; optionally cascades to the subtree.
CREATE TABLE IF NOT EXISTS role_assignment (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  role_id     uuid NOT NULL REFERENCES role(id) ON DELETE CASCADE,
  org_unit_id uuid NOT NULL REFERENCES org_unit(id) ON DELETE CASCADE,
  cascade     boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role_id, org_unit_id)
);
CREATE INDEX IF NOT EXISTS ix_role_assignment_ou ON role_assignment(org_unit_id);

-- Per-tenant governance rules beyond RBAC: each tenant owns its own policy set
-- (e.g. password rules, quiz lockdown defaults, grading-scheme defaults,
-- enrollment self-registration on/off). Stored as namespaced key -> JSON value.
CREATE TABLE IF NOT EXISTS tenant_setting (
  tenant_id  uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  key        text NOT NULL,          -- e.g. 'password.min_length', 'quiz.lockdown_default'
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key)
);
CREATE TRIGGER trg_tenant_setting_updated BEFORE UPDATE ON tenant_setting
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Per-tenant white-label branding (logo, colours, theme, custom domain, CSS).
-- Sub-tenants may inherit unset fields from their parent (resolved by the app
-- or via tenant_effective_branding()).
CREATE TABLE IF NOT EXISTS tenant_branding (
  tenant_id       uuid PRIMARY KEY REFERENCES tenant(id) ON DELETE CASCADE,
  display_name    text,
  logo_url        text,
  favicon_url     text,
  primary_color   text,             -- hex, e.g. '#0B5FFF'
  secondary_color text,
  accent_color    text,
  theme           text NOT NULL DEFAULT 'system'
                     CHECK (theme IN ('light','dark','system')),
  custom_domain   citext UNIQUE,    -- e.g. 'lms.school.edu'
  custom_css      text,
  support_email   citext,
  inherit_parent  boolean NOT NULL DEFAULT true,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_tenant_branding_updated BEFORE UPDATE ON tenant_branding
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Resolve a tenant's effective branding: its own row, with any NULL field
-- filled from the nearest ancestor that has inherit_parent enabled. Lets a
-- district set a default look that schools override field-by-field.
CREATE OR REPLACE FUNCTION tenant_effective_branding(target uuid)
  RETURNS tenant_branding LANGUAGE plpgsql STABLE AS $$
  DECLARE
    cur      uuid := target;
    acc      tenant_branding;
    row_b    tenant_branding;
    guard    int  := 0;
  BEGIN
    SELECT * INTO acc FROM tenant_branding WHERE tenant_id = target;
    IF acc.tenant_id IS NULL THEN
      acc.tenant_id := target;
    END IF;
    -- Walk up the parent chain filling NULLs while inheritance is allowed.
    LOOP
      EXIT WHEN cur IS NULL OR guard > 32;
      guard := guard + 1;
      SELECT parent_id INTO cur FROM tenant WHERE id = cur;
      EXIT WHEN cur IS NULL OR NOT COALESCE(acc.inherit_parent, true);
      SELECT * INTO row_b FROM tenant_branding WHERE tenant_id = cur;
      CONTINUE WHEN row_b.tenant_id IS NULL;
      acc.display_name    := COALESCE(acc.display_name, row_b.display_name);
      acc.logo_url        := COALESCE(acc.logo_url, row_b.logo_url);
      acc.favicon_url     := COALESCE(acc.favicon_url, row_b.favicon_url);
      acc.primary_color   := COALESCE(acc.primary_color, row_b.primary_color);
      acc.secondary_color := COALESCE(acc.secondary_color, row_b.secondary_color);
      acc.accent_color    := COALESCE(acc.accent_color, row_b.accent_color);
      acc.support_email   := COALESCE(acc.support_email, row_b.support_email);
    END LOOP;
    RETURN acc;
  END
$$;

-- ============================================================================
-- COURSES & CONTENT
-- ============================================================================
-- A course offering IS an org_unit of type 'course_offering'; this table holds
-- its LMS-specific attributes.
CREATE TABLE IF NOT EXISTS course (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  org_unit_id   uuid NOT NULL UNIQUE REFERENCES org_unit(id) ON DELETE CASCADE,
  template_id   uuid REFERENCES org_unit(id),
  title         text NOT NULL,
  description   text,
  start_date    timestamptz,
  end_date      timestamptz,
  is_published  boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_course_tenant ON course(tenant_id);
CREATE TRIGGER trg_course_updated BEFORE UPDATE ON course
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS content_module (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  course_id   uuid NOT NULL REFERENCES course(id) ON DELETE CASCADE,
  parent_id   uuid REFERENCES content_module(id) ON DELETE CASCADE,
  title       text NOT NULL,
  position    integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_module_course ON content_module(course_id);

CREATE TABLE IF NOT EXISTS content_topic (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  module_id   uuid NOT NULL REFERENCES content_module(id) ON DELETE CASCADE,
  title       text NOT NULL,
  kind        text NOT NULL DEFAULT 'html'
                 CHECK (kind IN ('html','file','link','scorm','lti','video')),
  -- For file/scorm/video: a Vercel Blob URL or external href.
  body        text,
  blob_url    text,
  position    integer NOT NULL DEFAULT 0,
  is_required boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_topic_module ON content_topic(module_id);

CREATE TABLE IF NOT EXISTS content_completion (
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  topic_id    uuid NOT NULL REFERENCES content_topic(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  completed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (topic_id, user_id)
);

-- ============================================================================
-- ENROLLMENT
-- ============================================================================
CREATE TABLE IF NOT EXISTS enrollment (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  org_unit_id uuid NOT NULL REFERENCES org_unit(id) ON DELETE CASCADE,
  role_id     uuid NOT NULL REFERENCES role(id),
  status      text NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active','inactive','completed','withdrawn')),
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, org_unit_id)
);
CREATE INDEX IF NOT EXISTS ix_enrollment_ou ON enrollment(org_unit_id);
CREATE INDEX IF NOT EXISTS ix_enrollment_user ON enrollment(user_id);

-- ============================================================================
-- ASSESSMENT — quizzes, question library, attempts
-- ============================================================================
CREATE TABLE IF NOT EXISTS question_library (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  course_id   uuid REFERENCES course(id) ON DELETE CASCADE,
  name        text NOT NULL
);

CREATE TABLE IF NOT EXISTS question (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  library_id  uuid REFERENCES question_library(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN (
                 'multiple_choice','multi_select','true_false','short_answer',
                 'essay','matching','ordering','fill_blank','numeric')),
  stem        text NOT NULL,
  points      numeric(8,2) NOT NULL DEFAULT 1,
  -- Options/answers/feedback as structured JSON keyed by question kind.
  body        jsonb NOT NULL DEFAULT '{}'::jsonb,
  difficulty  text CHECK (difficulty IN ('remember','understand','apply','analyze','evaluate','create')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_question_library ON question(library_id);

CREATE TABLE IF NOT EXISTS quiz (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  course_id     uuid NOT NULL REFERENCES course(id) ON DELETE CASCADE,
  title         text NOT NULL,
  description   text,
  attempts_allowed integer,           -- NULL = unlimited
  time_limit_minutes integer,
  shuffle       boolean NOT NULL DEFAULT false,
  available_from timestamptz,
  available_until timestamptz,
  grading_method text NOT NULL DEFAULT 'highest'
                 CHECK (grading_method IN ('highest','latest','average','first')),
  is_published  boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_quiz_course ON quiz(course_id);

-- Question pools allow random draw of N from a set.
CREATE TABLE IF NOT EXISTS quiz_section (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  quiz_id     uuid NOT NULL REFERENCES quiz(id) ON DELETE CASCADE,
  title       text,
  position    integer NOT NULL DEFAULT 0,
  draw_count  integer                 -- NULL = include all questions in section
);

CREATE TABLE IF NOT EXISTS quiz_question (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  section_id  uuid NOT NULL REFERENCES quiz_section(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES question(id) ON DELETE CASCADE,
  points      numeric(8,2),
  position    integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS quiz_attempt (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  quiz_id      uuid NOT NULL REFERENCES quiz(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  attempt_no   integer NOT NULL DEFAULT 1,
  status       text NOT NULL DEFAULT 'in_progress'
                 CHECK (status IN ('in_progress','submitted','graded')),
  score        numeric(8,2),
  max_score    numeric(8,2),
  started_at   timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  graded_at    timestamptz,
  UNIQUE (quiz_id, user_id, attempt_no)
);
CREATE INDEX IF NOT EXISTS ix_attempt_quiz_user ON quiz_attempt(quiz_id, user_id);

CREATE TABLE IF NOT EXISTS quiz_response (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  attempt_id  uuid NOT NULL REFERENCES quiz_attempt(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES question(id),
  response    jsonb NOT NULL DEFAULT '{}'::jsonb,
  awarded     numeric(8,2),
  is_correct  boolean
);
CREATE INDEX IF NOT EXISTS ix_response_attempt ON quiz_response(attempt_id);

-- ============================================================================
-- ASSIGNMENTS
-- ============================================================================
CREATE TABLE IF NOT EXISTS assignment (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  course_id    uuid NOT NULL REFERENCES course(id) ON DELETE CASCADE,
  title        text NOT NULL,
  instructions text,
  due_at       timestamptz,
  points       numeric(8,2) NOT NULL DEFAULT 100,
  submission_type text NOT NULL DEFAULT 'file'
                 CHECK (submission_type IN ('file','text','url','none')),
  allow_late   boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_assignment_course ON assignment(course_id);

CREATE TABLE IF NOT EXISTS submission (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  assignment_id uuid NOT NULL REFERENCES assignment(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  body         text,
  blob_url     text,
  status       text NOT NULL DEFAULT 'submitted'
                 CHECK (status IN ('draft','submitted','returned','resubmitted')),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  is_late      boolean NOT NULL DEFAULT false,
  UNIQUE (assignment_id, user_id)
);

-- ============================================================================
-- GRADEBOOK
-- ============================================================================
CREATE TABLE IF NOT EXISTS grade_scheme (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  name        text NOT NULL,
  ranges      jsonb NOT NULL DEFAULT '[]'::jsonb  -- [{symbol:'A',min:90}, ...]
);

CREATE TABLE IF NOT EXISTS grade_category (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  course_id   uuid NOT NULL REFERENCES course(id) ON DELETE CASCADE,
  name        text NOT NULL,
  weight      numeric(6,3),
  position    integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS grade_item (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  course_id   uuid NOT NULL REFERENCES course(id) ON DELETE CASCADE,
  category_id uuid REFERENCES grade_category(id) ON DELETE SET NULL,
  scheme_id   uuid REFERENCES grade_scheme(id) ON DELETE SET NULL,
  name        text NOT NULL,
  max_points  numeric(8,2) NOT NULL DEFAULT 100,
  weight      numeric(6,3),
  -- Optional link to the source activity that auto-populates this item.
  source_type text CHECK (source_type IN ('quiz','assignment','manual')),
  source_id   uuid,
  position    integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_grade_item_course ON grade_item(course_id);

CREATE TABLE IF NOT EXISTS grade (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  grade_item_id uuid NOT NULL REFERENCES grade_item(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  points       numeric(8,2),
  feedback     text,
  is_released  boolean NOT NULL DEFAULT false,
  graded_by    uuid REFERENCES app_user(id),
  graded_at    timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (grade_item_id, user_id)
);
CREATE INDEX IF NOT EXISTS ix_grade_user ON grade(user_id);
CREATE TRIGGER trg_grade_updated BEFORE UPDATE ON grade
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- RUBRICS, COMPETENCIES & OUTCOMES
-- ============================================================================
CREATE TABLE IF NOT EXISTS rubric (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  course_id   uuid REFERENCES course(id) ON DELETE CASCADE,
  name        text NOT NULL,
  kind        text NOT NULL DEFAULT 'analytic'
                 CHECK (kind IN ('analytic','holistic'))
);

CREATE TABLE IF NOT EXISTS rubric_criterion (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  rubric_id   uuid NOT NULL REFERENCES rubric(id) ON DELETE CASCADE,
  name        text NOT NULL,
  position    integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS rubric_level (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  criterion_id uuid NOT NULL REFERENCES rubric_criterion(id) ON DELETE CASCADE,
  label        text NOT NULL,
  points       numeric(8,2) NOT NULL DEFAULT 0,
  descriptor   text
);

CREATE TABLE IF NOT EXISTS competency (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  parent_id   uuid REFERENCES competency(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text
);

CREATE TABLE IF NOT EXISTS learning_objective (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  competency_id uuid REFERENCES competency(id) ON DELETE SET NULL,
  code        text,
  statement   text NOT NULL
);

-- Polymorphic alignment of an objective to any gradable activity.
CREATE TABLE IF NOT EXISTS objective_alignment (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  objective_id uuid NOT NULL REFERENCES learning_objective(id) ON DELETE CASCADE,
  target_type  text NOT NULL CHECK (target_type IN ('quiz','assignment','question','rubric_criterion')),
  target_id    uuid NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_alignment_target ON objective_alignment(target_type, target_id);

-- ============================================================================
-- DISCUSSIONS
-- ============================================================================
CREATE TABLE IF NOT EXISTS discussion_forum (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  course_id   uuid NOT NULL REFERENCES course(id) ON DELETE CASCADE,
  title       text NOT NULL,
  position    integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS discussion_topic (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  forum_id    uuid NOT NULL REFERENCES discussion_forum(id) ON DELETE CASCADE,
  title       text NOT NULL,
  description text
);

CREATE TABLE IF NOT EXISTS discussion_post (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  topic_id    uuid NOT NULL REFERENCES discussion_topic(id) ON DELETE CASCADE,
  parent_id   uuid REFERENCES discussion_post(id) ON DELETE CASCADE,
  author_id   uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  body        text NOT NULL,
  is_pinned   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_post_topic ON discussion_post(topic_id);

-- ============================================================================
-- STANDARDS & INTEGRATIONS  (LTI 1.3, OneRoster, SCORM, xAPI)
-- ============================================================================
CREATE TABLE IF NOT EXISTS lti_registration (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  issuer        text NOT NULL,
  client_id     text NOT NULL,
  auth_login_url   text NOT NULL,
  auth_token_url   text NOT NULL,
  jwks_url      text NOT NULL,
  -- Whether we act as platform (hosting tools) or tool (embedded elsewhere).
  role          text NOT NULL DEFAULT 'platform' CHECK (role IN ('platform','tool')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (issuer, client_id)
);

CREATE TABLE IF NOT EXISTS lti_deployment (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  registration_id uuid NOT NULL REFERENCES lti_registration(id) ON DELETE CASCADE,
  deployment_id   text NOT NULL,
  org_unit_id     uuid REFERENCES org_unit(id) ON DELETE CASCADE,
  UNIQUE (registration_id, deployment_id)
);

CREATE TABLE IF NOT EXISTS sis_sync (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  source      text NOT NULL CHECK (source IN ('oneroster_csv','oneroster_rest','lis2','d2l_csv','ellucian_ilp')),
  status      text NOT NULL DEFAULT 'idle' CHECK (status IN ('idle','running','succeeded','failed')),
  last_run_at timestamptz,
  stats       jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS scorm_package (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  topic_id    uuid REFERENCES content_topic(id) ON DELETE CASCADE,
  version     text NOT NULL DEFAULT '2004' CHECK (version IN ('1.2','2004')),
  manifest    jsonb NOT NULL DEFAULT '{}'::jsonb,
  blob_url    text NOT NULL
);

-- xAPI / SCORM runtime tracking (learner state).
CREATE TABLE IF NOT EXISTS xapi_statement (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  actor_id    uuid REFERENCES app_user(id) ON DELETE SET NULL,
  verb        text NOT NULL,
  object_id   text NOT NULL,
  result      jsonb,
  stored_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_xapi_actor ON xapi_statement(tenant_id, actor_id);

-- ============================================================================
-- AUTOMATION  (Intelligent Agents, Release Conditions)
-- ============================================================================
CREATE TABLE IF NOT EXISTS release_condition (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  course_id   uuid NOT NULL REFERENCES course(id) ON DELETE CASCADE,
  target_type text NOT NULL,         -- e.g. 'content_topic','quiz'
  target_id   uuid NOT NULL,
  expression  jsonb NOT NULL,        -- boolean tree of conditions
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS intelligent_agent (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  course_id   uuid NOT NULL REFERENCES course(id) ON DELETE CASCADE,
  name        text NOT NULL,
  criteria    jsonb NOT NULL,        -- trigger (e.g. login inactivity, grade < x)
  action      jsonb NOT NULL,        -- email template, enrollment change, etc.
  schedule    text,                  -- cron-like
  is_enabled  boolean NOT NULL DEFAULT true
);

-- ============================================================================
-- AUDIT & EVENTING  (transactional outbox → Distributed Event Framework)
-- ============================================================================
CREATE TABLE IF NOT EXISTS audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  actor_id    uuid REFERENCES app_user(id) ON DELETE SET NULL,
  action      text NOT NULL,
  target_type text,
  target_id   uuid,
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_address  inet,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_audit_tenant_time ON audit_log(tenant_id, created_at DESC);

-- Outbox row is written in the same tx as the domain change; a relay publishes
-- it to the event transport, then marks it published.
CREATE TABLE IF NOT EXISTS event_outbox (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  type         text NOT NULL,
  actor_id     uuid,
  org_unit_id  uuid,
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);
CREATE INDEX IF NOT EXISTS ix_outbox_unpublished
  ON event_outbox(occurred_at) WHERE published_at IS NULL;

-- Inbox guarantees exactly-once consumption (dedupe by message id per consumer).
CREATE TABLE IF NOT EXISTS event_inbox (
  consumer     text NOT NULL,
  message_id   uuid NOT NULL,
  tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer, message_id)
);

-- Idempotency keys for mutating APIs (submissions, payments).
CREATE TABLE IF NOT EXISTS idempotency_key (
  tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  key          text NOT NULL,
  request_hash text NOT NULL,
  response     jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key)
);

-- ============================================================================
-- ACADEMIC SESSIONS  (OneRoster academicSessions: terms, grading periods)
-- ============================================================================
CREATE TABLE IF NOT EXISTS academic_session (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  parent_id   uuid REFERENCES academic_session(id) ON DELETE CASCADE,
  title       text NOT NULL,
  kind        text NOT NULL DEFAULT 'term'
                 CHECK (kind IN ('schoolYear','term','semester','gradingPeriod')),
  start_date  date,
  end_date    date,
  source_id   text                  -- OneRoster sourcedId
);
CREATE INDEX IF NOT EXISTS ix_session_tenant ON academic_session(tenant_id);

-- ============================================================================
-- ANNOUNCEMENTS & CALENDAR
-- ============================================================================
CREATE TABLE IF NOT EXISTS announcement (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  org_unit_id uuid NOT NULL REFERENCES org_unit(id) ON DELETE CASCADE,
  author_id   uuid REFERENCES app_user(id) ON DELETE SET NULL,
  title       text NOT NULL,
  body        text NOT NULL,
  publish_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_announcement_ou ON announcement(org_unit_id, publish_at DESC);

CREATE TABLE IF NOT EXISTS calendar_event (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  org_unit_id uuid REFERENCES org_unit(id) ON DELETE CASCADE,
  title       text NOT NULL,
  description text,
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz,
  all_day     boolean NOT NULL DEFAULT false,
  -- Optional link to a source activity (assignment due date, quiz window).
  source_type text CHECK (source_type IN ('assignment','quiz','manual')),
  source_id   uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_calendar_ou_time ON calendar_event(org_unit_id, starts_at);

-- ============================================================================
-- TIMETABLE & CLASS SCHEDULING
-- ============================================================================
-- A bell schedule defines the rhythm of a school day (named periods + times);
-- timetable entries slot sections into periods with a room and instructor.
CREATE TABLE IF NOT EXISTS bell_schedule (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  org_unit_id uuid NOT NULL REFERENCES org_unit(id) ON DELETE CASCADE,
  name        text NOT NULL,
  timezone    text NOT NULL DEFAULT 'UTC',
  is_default  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_unit_id, name)
);
CREATE INDEX IF NOT EXISTS ix_bell_schedule_ou ON bell_schedule(org_unit_id);

-- Ordered named periods within a bell schedule (e.g. 'Period 1', 'Homeroom').
CREATE TABLE IF NOT EXISTS schedule_period (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  bell_schedule_id uuid NOT NULL REFERENCES bell_schedule(id) ON DELETE CASCADE,
  name             text NOT NULL,
  sort_order       int  NOT NULL DEFAULT 0,
  start_time       time NOT NULL,
  end_time         time NOT NULL,
  day_pattern      text NOT NULL DEFAULT 'daily',  -- 'daily','A','B','MWF','TR', etc.
  UNIQUE (bell_schedule_id, name, day_pattern)
);
CREATE INDEX IF NOT EXISTS ix_schedule_period_bs ON schedule_period(bell_schedule_id, sort_order);

-- A recurring class meeting: a section meets in a period, room and (optionally)
-- on a specific weekday, taught by an instructor, within an academic session.
CREATE TABLE IF NOT EXISTS timetable_entry (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  org_unit_id         uuid NOT NULL REFERENCES org_unit(id) ON DELETE CASCADE,
  period_id           uuid NOT NULL REFERENCES schedule_period(id) ON DELETE CASCADE,
  academic_session_id uuid REFERENCES academic_session(id) ON DELETE SET NULL,
  instructor_id       uuid REFERENCES app_user(id) ON DELETE SET NULL,
  room                text,
  day_of_week         int CHECK (day_of_week BETWEEN 0 AND 6),  -- 0=Sunday; null => use period day_pattern
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_unit_id, period_id, day_of_week)
);
CREATE INDEX IF NOT EXISTS ix_timetable_entry_ou ON timetable_entry(org_unit_id);
CREATE INDEX IF NOT EXISTS ix_timetable_entry_period ON timetable_entry(period_id);
CREATE INDEX IF NOT EXISTS ix_timetable_entry_instructor ON timetable_entry(instructor_id);

-- ============================================================================
-- ATTENDANCE & PARTICIPATION
-- ============================================================================
-- Per-tenant attendance vocabulary; each code maps to a reporting category.
CREATE TABLE IF NOT EXISTS attendance_code (
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  code        text NOT NULL,             -- e.g. 'P','A','T','EX','RL'
  label       text NOT NULL,
  category    text NOT NULL CHECK (category IN ('present','absent','tardy','excused')),
  is_default  boolean NOT NULL DEFAULT false,
  PRIMARY KEY (tenant_id, code)
);

-- One attendance-taking event for a section on a date/period.
CREATE TABLE IF NOT EXISTS attendance_session (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  org_unit_id        uuid NOT NULL REFERENCES org_unit(id) ON DELETE CASCADE,
  timetable_entry_id uuid REFERENCES timetable_entry(id) ON DELETE SET NULL,
  meeting_date       date NOT NULL,
  period_label       text,
  status             text NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open','finalized')),
  taken_by           uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_unit_id, meeting_date, period_label)
);
CREATE INDEX IF NOT EXISTS ix_attendance_session_ou
  ON attendance_session(org_unit_id, meeting_date);
CREATE TRIGGER trg_attendance_session_updated BEFORE UPDATE ON attendance_session
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Per-student status within an attendance session (one row per student).
CREATE TABLE IF NOT EXISTS attendance_record (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  session_id   uuid NOT NULL REFERENCES attendance_session(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  code         text NOT NULL,
  minutes_late int,
  comment      text,
  recorded_by  uuid REFERENCES app_user(id) ON DELETE SET NULL,
  recorded_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, code) REFERENCES attendance_code(tenant_id, code),
  UNIQUE (session_id, user_id)
);
CREATE INDEX IF NOT EXISTS ix_attendance_record_user
  ON attendance_record(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS ix_attendance_record_session
  ON attendance_record(session_id);

-- ============================================================================
-- NOTIFICATIONS  (multi-channel)
-- ============================================================================
CREATE TABLE IF NOT EXISTS notification_preference (
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  channel     text NOT NULL CHECK (channel IN ('email','sms','push','in_app')),
  category    text NOT NULL,         -- e.g. 'grades','announcements','discussions'
  is_enabled  boolean NOT NULL DEFAULT true,
  PRIMARY KEY (user_id, channel, category)
);

CREATE TABLE IF NOT EXISTS notification (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  category    text NOT NULL,
  channel     text NOT NULL CHECK (channel IN ('email','sms','push','in_app')),
  title       text NOT NULL,
  body        text,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  status      text NOT NULL DEFAULT 'queued'
                 CHECK (status IN ('queued','sent','delivered','failed','read')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  read_at     timestamptz
);
CREATE INDEX IF NOT EXISTS ix_notification_user
  ON notification(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_notification_unread
  ON notification(user_id) WHERE read_at IS NULL;

-- ============================================================================
-- VIDEO  (upload -> transcode -> CDN)
-- ============================================================================
CREATE TABLE IF NOT EXISTS video_asset (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  owner_id     uuid REFERENCES app_user(id) ON DELETE SET NULL,
  title        text NOT NULL,
  source_blob_url text NOT NULL,
  status       text NOT NULL DEFAULT 'uploaded'
                 CHECK (status IN ('uploaded','transcoding','ready','failed')),
  -- Rendition manifests (HLS/DASH) and caption tracks.
  renditions   jsonb NOT NULL DEFAULT '[]'::jsonb,
  captions     jsonb NOT NULL DEFAULT '[]'::jsonb,
  duration_seconds integer,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_video_tenant ON video_asset(tenant_id);

-- ============================================================================
-- AI / LUMI  (RAG chat history + content embeddings)
-- ============================================================================
-- pgvector enables tenant-scoped semantic retrieval (security-trimmed).
CREATE EXTENSION IF NOT EXISTS "vector";

CREATE TABLE IF NOT EXISTS ai_embedding (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  course_id   uuid REFERENCES course(id) ON DELETE CASCADE,
  source_type text NOT NULL,         -- 'content_topic','assignment', etc.
  source_id   uuid NOT NULL,
  chunk       text NOT NULL,
  embedding   vector(1024),          -- dimension depends on embedding model
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_ai_embedding_tenant ON ai_embedding(tenant_id, course_id);

CREATE TABLE IF NOT EXISTS ai_chat (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  course_id   uuid REFERENCES course(id) ON DELETE SET NULL,
  feature     text NOT NULL,         -- 'tutor','feedback','qgen', etc.
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_message (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  chat_id     uuid NOT NULL REFERENCES ai_chat(id) ON DELETE CASCADE,
  role        text NOT NULL CHECK (role IN ('system','user','assistant','tool')),
  content     text NOT NULL,
  citations   jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_ai_message_chat ON ai_message(chat_id, created_at);

-- ============================================================================
-- ANALYTICS  (Caliper/xAPI Learning Record Store + read models)
-- ============================================================================
-- Append-only event store; partition by month in production (see partitions/).
CREATE TABLE IF NOT EXISTS caliper_event (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  actor_id    uuid,
  type        text NOT NULL,         -- Caliper event type, e.g. 'AssessmentEvent'
  action      text NOT NULL,         -- e.g. 'Submitted'
  object_type text NOT NULL,
  object_id   text NOT NULL,
  org_unit_id uuid,
  event_time  timestamptz NOT NULL DEFAULT now(),
  envelope    jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS ix_caliper_tenant_time
  ON caliper_event(tenant_id, event_time DESC);
CREATE INDEX IF NOT EXISTS ix_caliper_actor ON caliper_event(tenant_id, actor_id);

-- Materialised CQRS read model: per-learner engagement & at-risk signal.
CREATE TABLE IF NOT EXISTS engagement_summary (
  tenant_id      uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  course_id      uuid NOT NULL REFERENCES course(id) ON DELETE CASCADE,
  last_access    timestamptz,
  logins_7d      integer NOT NULL DEFAULT 0,
  content_views_7d integer NOT NULL DEFAULT 0,
  submissions_7d integer NOT NULL DEFAULT 0,
  current_grade  numeric(6,2),
  at_risk        boolean NOT NULL DEFAULT false,
  risk_score     numeric(5,4),
  computed_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, course_id)
);

-- ============================================================================
-- SIS INTEGRATION  (OneRoster sourcedId mapping)
-- ============================================================================
CREATE TABLE IF NOT EXISTS sis_id_map (
  tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  entity_type  text NOT NULL CHECK (entity_type IN ('org','user','class','course','enrollment','academicSession')),
  source_id    text NOT NULL,        -- external OneRoster sourcedId
  internal_id  uuid NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, entity_type, source_id)
);

-- ============================================================================
-- BILLING  (invoices + usage metering)
-- ============================================================================
CREATE TABLE IF NOT EXISTS invoice (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  subscription_id uuid REFERENCES subscription(id) ON DELETE SET NULL,
  number        text NOT NULL,
  status        text NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft','open','paid','void','uncollectible')),
  amount_cents  integer NOT NULL DEFAULT 0,
  currency      text NOT NULL DEFAULT 'USD',
  period_start  timestamptz,
  period_end    timestamptz,
  issued_at     timestamptz,
  paid_at       timestamptz,
  UNIQUE (tenant_id, number)
);

CREATE TABLE IF NOT EXISTS usage_meter (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  metric      text NOT NULL,         -- 'active_users','ai_tokens','storage_gb'
  quantity    numeric(16,4) NOT NULL DEFAULT 0,
  window_start timestamptz NOT NULL,
  window_end   timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_usage_tenant_metric
  ON usage_meter(tenant_id, metric, window_start);

-- ============================================================================
-- TAMPER-EVIDENT AUDIT EXTENSION  (hash-chained ledger)
-- ============================================================================
-- Adds a per-tenant hash chain on top of audit_log for FERPA-grade evidence.
-- Each row stores the hash of (prev_hash || row payload); a break reveals
-- tampering. (Postgres analogue of Azure SQL Ledger.)
ALTER TABLE audit_log
  ADD COLUMN IF NOT EXISTS prev_hash bytea,
  ADD COLUMN IF NOT EXISTS row_hash  bytea;
