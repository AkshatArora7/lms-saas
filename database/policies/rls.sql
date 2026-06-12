-- ============================================================================
-- Row-Level Security — POOL tenant isolation
-- ============================================================================
-- Applied to the shared (pool) database. Every tenant-owned table only exposes
-- rows whose tenant_id matches the request-scoped GUC `app.tenant_id`, set by
-- @lms/db.withTenant() inside each transaction.
--
-- Silo databases hold a single tenant, so RLS is optional there — but keeping
-- the same policies makes pool↔silo migration a no-op.
--
-- Run AFTER schema.sql. The application connects as a NON-superuser role
-- (BYPASSRLS must NOT be set) for policies to take effect.
-- ============================================================================

DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'org_unit','app_user','identity_provider','user_identity','role',
    'role_assignment','course','content_module','content_topic',
    'content_completion','enrollment','question_library','question','quiz',
    'quiz_section','quiz_question','quiz_attempt','quiz_response','assignment',
    'submission','grade_scheme','grade_category','grade_item','grade','rubric',
    'rubric_criterion','rubric_level','competency','learning_objective',
    'objective_alignment','discussion_forum','discussion_topic',
    'discussion_post','lti_registration','lti_deployment','sis_sync',
    'scorm_package','xapi_statement','release_condition','intelligent_agent',
    'audit_log','event_outbox','event_inbox','idempotency_key','subscription',
    'academic_session','announcement','calendar_event','notification',
    'notification_preference','video_asset','ai_embedding','ai_chat',
    'ai_message','caliper_event','engagement_summary','sis_id_map','invoice',
    'usage_meter'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);

    -- Drop existing to keep this script idempotent.
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I;', t);

    -- SELECT/UPDATE/DELETE: only rows for the current tenant.
    -- INSERT: rows must be stamped with the current tenant.
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING (tenant_id = current_tenant_id())
        WITH CHECK (tenant_id = current_tenant_id());
    $f$, t);
  END LOOP;
END
$$;
