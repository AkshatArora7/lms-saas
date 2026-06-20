# Handshake — #24 Guardian/parent relationships

> **Single source of truth for one task.** Subagents are stateless; this file
> carries context between them. Every agent **reads this file in full before
> acting** and **updates its own section before handing off**. Facts here must be
> grounded in source (the issue, `AGENTS.md`, the code/schema) — never invented.
> When this file and the code/schema disagree, the **source wins**: fix the code
> claim, then correct this file. Never delete another agent's section.

## 1. Task
- **Issue:** #24 — Guardian/parent relationships · https://github.com/AkshatArora7/lms-saas/issues/24
- **Type:** feat
- **Branch:** feat/guardian-relationships  (off fresh `main`)
- **Requested by / date:** @AkshatArora7 · 2026-06-20
- **One-line goal:** Let a guardian be linked to a child's account with read-only access to scoped data, respecting consent/age rules.
- **Epic:** #21 — Org Hierarchy & User/Roster Management · Priority P2 · 3 pts
- **Owning service:** `services/user-org` (owns app_user + org hierarchy + parental_consent).

## 2. Acceptance criteria  (verbatim from the issue — do not paraphrase)
- [ ] Guardian<->student relationship modeled
- [ ] Guardian read-only access to scoped data
- [ ] Consent/age rules respected

## 3. Stage status  (tick only with evidence in the matching section)
| Stage | Owner | Status | Evidence |
| ----- | ----- | ------ | -------- |
| Requirements | backlog-agent | ☑ done | Issue #24 already seeded with story + ACs |
| Architecture | architect | ☑ done | Design in §4 + ADR `docs/ADR-0024-guardian-relationships.md`; grounded in `schema.sql:129-141,1160-1183`, `consent.ts:113`, `store.prisma.ts`, `rls.sql:18-39` |
| UX design | ux-designer | n/a | backend-only slice |
| Data & RLS | schema-agent | ☑ done | `guardian_relationship` added to `schema.sql` (after `parental_consent`, COMPLIANCE block) + `'guardian_relationship'` in `rls.sql` `tenant_tables`; both parse with pglast (schema.sql OK / rls.sql OK) |
| Backend | service-builder | ☑ done | 6 routes + 4 store files in `services/user-org`; typecheck/lint/build green, 40 tests pass (incl. guardian suite) — see §4 Implementation + §7 |
| Frontend | frontend-dev | n/a | |
| QA / tests | qa-agent | ☑ done | typecheck 47/47, lint 47/47, user-org test 40/40 (guardian 16/16), pglast schema.sql+rls.sql OK — all 3 ACs mapped to tests (§5). Repo-wide build red is an OUT-OF-SCOPE infra change (`output:"standalone"`), not #24; relay test flaky (green on re-run) |
| Security & DoD | security-agent | ☑ done | APPROVE — own tenant_id + tenant_isolation ENABLE/FORCE in rls.sql loop; all prisma queries via withTenant + `$n::uuid` (no interpolation/SQLi); consent re-derived live per authorize; no guardian write path; events carry ids only. §5 + §7 |
| Docs | docs-agent | ☑ done | Regenerated (not hand-edited) per-service specs: edited the generator `scripts/docs/gen-service-specs.py` (user-org block: +`guardian_relationship` table, +6 guardian endpoints, +`guardian.linked`/`guardian.revoked` publishes, resp/notes), ran `python scripts/docs/gen-service-specs.py` → "Wrote 27 specs + index", regenerating `docs/services/user-org.md` + `docs/services/README.md` (event catalogue + owned-tables). Event names verified against `packages/events/src/index.ts` (`guardian.linked`/`guardian.revoked`) and routes against `guardian.routes.ts`. ADR-0024 consistent (design-level, not contradictory) → left as-is. FEATURES.md already covers parents/guardians; README.md dirty (unrelated infra) → not touched. |

## 4. Decisions & contracts  (append; never rewrite history)
- **Architecture (architect):**

  **ADR:** `docs/ADR-0024-guardian-relationships.md` (full context + options).
  Design grounded in source: `app_user` (`database/schema.sql:129-141`),
  `parental_consent` (`database/schema.sql:1160-1183`), the pure consent policy
  `dataCollectionDecision` (`services/user-org/src/consent.ts:113`) and
  `isMinor` (`consent.ts:80`), the RLS loop (`database/policies/rls.sql:18-39`),
  the store-abstraction six-file shape + `withTenant`/`$n::uuid`/`emitEvent`
  pattern (`services/user-org/src/store.prisma.ts`,
  `consent.prisma.ts`), and route-split precedent
  (`consent.routes.ts` registered alongside `routes.ts` in `main.ts:79-87`).

  ### A. DATA MODEL — new tenant-scoped table `guardian_relationship`

  Add to `database/schema.sql` near the COMPLIANCE block (after
  `parental_consent`). Follows the standard tenant-scoped pattern (own
  `tenant_id` -> standard `tenant_isolation` RLS).

  ```sql
  -- A guardian (parent/guardian app_user) linked to a student app_user, with a
  -- read-only, consent-gated relationship. consent_id is an audit/provenance
  -- pointer to the parental_consent row used to activate; live access is
  -- re-derived from parental_consent at request time (see consent rules).
  CREATE TABLE IF NOT EXISTS guardian_relationship (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        uuid NOT NULL REFERENCES tenant(id)  ON DELETE CASCADE,
    guardian_user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    student_user_id  uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    relationship     text NOT NULL DEFAULT 'guardian'
                       CHECK (relationship IN ('parent','guardian','other')),
    status           text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','active','revoked')),
    -- provenance only: the parental_consent row used to activate (NOT the live gate)
    consent_id       uuid REFERENCES parental_consent(id) ON DELETE SET NULL,
    note             text,
    created_by       uuid,                 -- admin/staff who created the link
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    revoked_at       timestamptz,
    CONSTRAINT guardian_relationship_no_self
      CHECK (guardian_user_id <> student_user_id),
    UNIQUE (tenant_id, guardian_user_id, student_user_id)
  );
  CREATE INDEX IF NOT EXISTS ix_guardian_rel_student
    ON guardian_relationship(tenant_id, student_user_id);
  CREATE INDEX IF NOT EXISTS ix_guardian_rel_guardian
    ON guardian_relationship(tenant_id, guardian_user_id);
  CREATE TRIGGER trg_guardian_relationship_updated BEFORE UPDATE
    ON guardian_relationship
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  ```

  **RLS:** add `'guardian_relationship'` to the `tenant_tables` array in
  `database/policies/rls.sql` (the loop at lines 18-39) -> it gets the standard
  `tenant_isolation` USING/WITH CHECK `(tenant_id = current_tenant_id())`. No
  join-based policy needed (it owns `tenant_id`).

  **Consent link rule (no duplication):** `parental_consent` is keyed by
  `(tenant_id, subject_user_id, consent_type)` (`schema.sql:1180`), where the
  subject is the **student**. We do NOT add guardian/consent columns. The
  relationship's `consent_id` records *which* consent row activated it
  (provenance/audit). The **live** access gate is re-computed from
  `parental_consent` at request time (see §C) so a later consent revoke denies
  immediately without mutating the relationship.

  ### B. API CONTRACT — routes to add in `services/user-org`

  Implement as a new route module `guardian.routes.ts` registered in
  `buildApp` alongside `registerConsentRoutes` (mirror `main.ts:79-87`). All
  mutation routes are **admin/staff** operations. Tenant from `x-tenant-id`
  via the existing `resolveTenant`/`resolveTenantOr400` pattern; validate uuids
  with the existing `UUID_RE`.

  **Management (admin/staff):**
  1. `POST /guardians` — create a link.
     Body `{ guardianUserId, studentUserId, relationship?, note?, createdBy? }`.
     Rules: both uuids; both `app_user` rows must exist in tenant; reject
     self-link (`guardianUserId === studentUserId` -> 400 `self_link`); unique
     -> 409 `link_exists`. Creates with `status='pending'`.
     `201 { relationship }`.
  2. `GET /students/:studentId/guardians` — list a student's guardians.
     `200 { guardians: GuardianRelationshipRecord[] }`.
  3. `GET /guardians/:guardianId/students` — list a guardian's students.
     `200 { students: GuardianRelationshipRecord[] }`.
  4. `POST /guardians/:id/activate` — activate a pending link. Server re-checks
     the consent/age rule (§C); on pass sets `status='active'` and stamps
     `consent_id`; on fail `409 consent_required` with the decision payload.
  5. `POST /guardians/:id/revoke` — soft revoke (mirrors
     `POST /compliance/consents/:id/revoke`). Sets `status='revoked'`,
     `revoked_at=now()`. `200 { relationship }`.

  **Reusable authorization predicate (the cross-service contract — read-only):**
  6. `GET /guardians/authorize?guardianUserId=&studentUserId=&category=directory_information`
     Returns `200 { decision: { allowed, reason, relationshipStatus, ageBand,
     consentSatisfied } }`. This is the single endpoint other services
     (grading, announcement) or the gateway call to answer "is G an active,
     consented guardian of S?". Read-only; never mutates.

  **READ-ONLY enforcement:** the *only* guardian-facing route is #6 (a read
  predicate). #1–5 are admin/staff. No route gives a guardian a write path to
  the child's data — enforced by construction (we add none).

  **Belongs here now vs deferred:** the link model, lifecycle, and the authz
  predicate live in `user-org` now. Guardian reads of the child's **grades** and
  **announcements** are explicitly **deferred** to the owning services (see §E
  follow-ups) — `user-org` does not own those bounded contexts.

  **Store interface (`GuardianStore`)** — new files mirroring the consent split:
  `guardian.ts` (types + interface), `guardian.memory.ts`, `guardian.prisma.ts`
  (`withTenant` + `$n::uuid` casts + `emitEvent` outbox), `guardian.routes.ts`.
  Methods: `createRelationship`, `listGuardiansForStudent`,
  `listStudentsForGuardian`, `activateRelationship(id, consentId)`,
  `revokeRelationship(id)`, `getRelationship(guardianUserId, studentUserId)`
  (for the predicate). The predicate route depends on **both** `GuardianStore`
  and the existing `ConsentStore` (reuse `getAgeBand` + `listConsents` +
  `dataCollectionDecision`) — no new consent logic.

  **Events:** on create/activate/revoke write an outbox row via the existing
  `emitEvent(...)` helper. Add `GUARDIAN_LINKED: "guardian.linked"` and
  `GUARDIAN_REVOKED: "guardian.revoked"` to `EVENT_TYPES`
  (`packages/events/src/index.ts:24`) so the `type` is canonical (current
  registry has no guardian types). Keep payload minimal:
  `{ guardianUserId, studentUserId, status }`.

  ### C. CONSENT / AGE RULES (grounded in `parental_consent` + `consent.ts`)

  Uses the real `parental_consent` columns (`age_band`, `consent_type`,
  `status`) and the existing pure policy — no new storage, no new policy logic.

  1. **Lifecycle:** a new `guardian_relationship` starts `status='pending'`.
  2. **Activation gate (POST /guardians/:id/activate):** compute the student's
     `age_band` via `ConsentStore.getAgeBand(student)` (latest recorded, else
     `'unknown'` — `consent.prisma.ts:128`).
     - **Minor (`under_13`,`13_17`) or `unknown`:** require a `parental_consent`
       row for the student with `consent_type='directory_information'` and
       `status='granted'`. Use `dataCollectionDecision({ ageBand, category:
       'directory_information', grantedConsents })` (`consent.ts:113`); activate
       only when `.allowed === true`. Stamp `consent_id` with that row's id.
       Otherwise `409 consent_required`.
     - **`adult`:** age does not consent-gate (`isMinor` false,
       `consent.ts:80`); guardian access requires explicit **student approval**,
       which is out of scope to fully build here — for this slice an adult
       student's link is activated by an admin/staff `POST .../activate` (which
       records the out-of-band approval) and stays `pending` until then. Student
       self-approval UX is a follow-up (§E).
  3. **Live access (predicate is source of truth):** `GET /guardians/authorize`
     returns `allowed=true` iff an **active** relationship `(tenant,G,S)` exists
     AND (student `age_band='adult'`) OR
     (`dataCollectionDecision(student,'directory_information').allowed === true`).
     Because consent is re-checked per request, a later
     `POST /compliance/consents/:id/revoke` (status->`revoked`) flips the
     predicate to deny **without** touching the relationship row.
  4. **Revoke relationship:** admin `POST /guardians/:id/revoke` ->
     `status='revoked'`; predicate denies.

  ### D. BUILD SEQUENCE

  1. **schema-agent** — add the `guardian_relationship` DDL above to
     `database/schema.sql` (COMPLIANCE block, after `parental_consent`), add
     `'guardian_relationship'` to `tenant_tables` in `database/policies/rls.sql`,
     keep the two indexes + the `set_updated_at` trigger, validate with pglast
     (`python -c "import pglast; pglast.parse_sql(open('database/schema.sql',encoding='utf-8').read())"`).
     Hand off the exact column/constraint names to service-builder.
  2. **service-builder (user-org)** — add `GUARDIAN_LINKED`/`GUARDIAN_REVOKED`
     to `packages/events/src/index.ts` `EVENT_TYPES`; create `guardian.ts`,
     `guardian.memory.ts`, `guardian.prisma.ts` (withTenant + `$n::uuid` +
     `emitEvent`), `guardian.routes.ts` (routes #1–6); register in
     `main.ts buildApp` + extend `BuildAppOptions`; reuse `ConsentStore` +
     `dataCollectionDecision` for §C; add tests to `main.test.ts` covering
     self-link reject, unique reject, pending->active on granted consent,
     predicate deny after consent revoke, no guardian write path.
  3. **qa-agent** — run typecheck/lint/test/build + pglast; map tests to the 3
     ACs; report pass/fail with real output.
  4. **security-agent** — audit: `tenant_isolation` on the new table, `withTenant`
     usage + `$n::uuid` casts, predicate re-checks consent (revoke denies in
     real time), no guardian write path, DoD/story linkage.

  ### E. CROSS-SERVICE CONTRACTS & FOLLOW-UP ISSUES (do NOT build here; file later)

  - **grading service:** add a guardian-scoped read of a child's grades, gated
    by calling `GET /guardians/authorize` before returning data. (follow-up)
  - **announcement service:** same, for a child's announcements. (follow-up)
  - **student self-approval** flow for `adult` students (replaces the admin
    out-of-band activation in §C.2). (follow-up)
  - **gateway/guardian claim:** optionally map a `guardian` role/claim so the
    gateway can scope guardian sessions. (follow-up, optional)
- **Data shapes (schema-agent):**

  **Table `guardian_relationship`** (tenant-scoped) — added to
  `database/schema.sql` in the COMPLIANCE block, immediately after
  `parental_consent` / its index. Built exactly to the architect's §4.A spec;
  no deviations (verified against real `app_user` `schema.sql:129-141` and
  `parental_consent` `schema.sql:1160-1183` — the FK targets `tenant(id)`,
  `app_user(id)`, and `parental_consent(id)` all exist).

  | Column | Type | Notes |
  | ------ | ---- | ----- |
  | `id` | `uuid` | PK, `DEFAULT gen_random_uuid()` |
  | `tenant_id` | `uuid` | NOT NULL, FK `tenant(id) ON DELETE CASCADE` |
  | `guardian_user_id` | `uuid` | NOT NULL, FK `app_user(id) ON DELETE CASCADE` |
  | `student_user_id` | `uuid` | NOT NULL, FK `app_user(id) ON DELETE CASCADE` |
  | `relationship` | `text` | NOT NULL DEFAULT `'guardian'`, CHECK IN (`parent`,`guardian`,`other`) |
  | `status` | `text` | NOT NULL DEFAULT `'pending'`, CHECK IN (`pending`,`active`,`revoked`) |
  | `consent_id` | `uuid` | nullable, FK `parental_consent(id) ON DELETE SET NULL` (provenance only, NOT live gate) |
  | `note` | `text` | nullable |
  | `created_by` | `uuid` | nullable (admin/staff who created link) |
  | `created_at` | `timestamptz` | NOT NULL DEFAULT `now()` |
  | `updated_at` | `timestamptz` | NOT NULL DEFAULT `now()` (maintained by `set_updated_at` trigger) |
  | `revoked_at` | `timestamptz` | nullable |

  **Constraints:** `CONSTRAINT guardian_relationship_no_self CHECK (guardian_user_id <> student_user_id)`;
  `UNIQUE (tenant_id, guardian_user_id, student_user_id)`.
  **Indexes:** `ix_guardian_rel_student (tenant_id, student_user_id)`,
  `ix_guardian_rel_guardian (tenant_id, guardian_user_id)`.
  **Trigger:** `trg_guardian_relationship_updated BEFORE UPDATE ... EXECUTE FUNCTION set_updated_at()`.

  **RLS decision:** OWN `tenant_id` column → **standard `tenant_isolation`**.
  Added `'guardian_relationship'` to the `tenant_tables` array in
  `database/policies/rls.sql:18-39`, so the loop ENABLEs+FORCEs RLS and creates
  `tenant_isolation` with `USING (tenant_id = current_tenant_id()) WITH CHECK
  (tenant_id = current_tenant_id())`. No join-based policy needed; control-plane
  `tenant` table untouched.

  **pglast result:** both files parse clean — `schema.sql OK` (exit 0),
  `rls.sql OK` (exit 0).

  **For service-builder:** target these exact column names in
  `guardian.prisma.ts` (with `$n::uuid` casts under `withTenant`). The link
  starts `status='pending'`; `activate` sets `status='active'` + stamps
  `consent_id`; `revoke` sets `status='revoked'` + `revoked_at=now()`.
- **Implementation (service-builder):**

  **Endpoints added** (new module `services/user-org/src/guardian.routes.ts`,
  registered in `buildApp` alongside consent routes):
  1. `POST /guardians` — create link (→ `status='pending'`); 400 `self_link`,
     404 `not_found` (guardian/student missing), 409 `link_exists`.
  2. `GET /students/:studentId/guardians` — list a student's guardians.
  3. `GET /guardians/:guardianId/students` — list a guardian's students.
  4. `POST /guardians/:id/activate` — admin re-checks the consent/age gate; 409
     `consent_required` (with `decision` payload) for minors/unknown without the
     granted `directory_information` consent; on pass → `status='active'` and
     stamps the granted consent's id as `consent_id` (adults activate without a
     consent row). Emits `GUARDIAN_LINKED`.
  5. `POST /guardians/:id/revoke` — soft revoke → `status='revoked'`,
     `revoked_at=now()`. Emits `GUARDIAN_REVOKED`.
  6. `GET /guardians/authorize?guardianUserId=&studentUserId=&category=` —
     READ-ONLY predicate; `allowed=true` iff an **active** relationship exists
     AND consent is currently satisfied (re-derived live via the ConsentStore +
     `evaluateGuardianConsent`/`dataCollectionDecision`), so a consent revoke or
     a relationship revoke denies immediately without mutating the row.

  **Files changed/added (paths):**
  - `services/user-org/src/guardian.ts` — types, `GuardianStore` interface,
    discriminated `CreateRelationshipResult`, exported pure helper
    `evaluateGuardianConsent` + `GUARDIAN_CONSENT_CATEGORY`.
  - `services/user-org/src/guardian.memory.ts` — `MemoryGuardianStore`
    (tenant-filtered arrays; injectable `userExists` predicate for not-found tests).
  - `services/user-org/src/guardian.prisma.ts` — `createPrismaGuardianStore`
    (`withTenant`, `$n::uuid` casts, `INSERT ... ON CONFLICT DO NOTHING`,
    `emitEvent` outbox rows). **Raw SQL only — no `packages/db/prisma/schema.prisma`
    change needed** (confirmed `store.prisma.ts`/`consent.prisma.ts` use
    `$queryRawUnsafe`).
  - `services/user-org/src/guardian.routes.ts` — `registerGuardianRoutes`.
  - `services/user-org/src/guardian.test.ts` — 16 Vitest cases (all 3 ACs).
  - `services/user-org/src/main.ts` — wired guardian store + routes into
    `buildApp`, extended `BuildAppOptions.guardianStore`, dev memory branch.
  - `packages/events/src/index.ts` — added `GUARDIAN_LINKED: "guardian.linked"`
    and `GUARDIAN_REVOKED: "guardian.revoked"` to `EVENT_TYPES`.

  **Read-only enforcement:** the only guardian-facing route is #6 (read
  predicate); #1–5 are admin/staff by construction. This service has no
  service-level role guard yet (gateway forwards `x-tenant-id`; org/role admin
  routes in `routes.ts` are likewise unguarded at this layer) — left a clear
  `TODO(#24-followup)` in `guardian.routes.ts` consistent with existing admin
  routes; did not invent a new auth mechanism.

  **Verification (real output):** `pnpm --filter @lms/service-user-org test` →
  **Test Files 3 passed (3), Tests 40 passed (40)**; `typecheck` ✅; `lint` ✅
  (no errors); `build` ✅ (after `pnpm --filter @lms/events build` so the
  compiled `@lms/events` types expose the two new keys).

### Grounding facts (orchestrator, from source)
- `services/user-org` is a fully-built service using the store-abstraction pattern: `src/main.ts`, `src/routes.ts`, `src/store.ts`, `src/store.memory.ts`, `src/store.prisma.ts`, `src/main.test.ts`. It already owns parental consent (`src/consent.ts`, `src/consent.routes.ts`).
- No `guardian` / `relationship` concept exists yet anywhere in the repo (grep confirmed).
- Existing tenant-scoped table pattern (`database/schema.sql`): `tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE`, ids `gen_random_uuid()`, indexes like `(tenant_id, user_id)`. RLS in `database/policies/rls.sql` uses `tenant_isolation` policy `USING (tenant_id = current_tenant_id()) WITH CHECK (...)`; join-only tables use an `EXISTS` form.
- `app_user` table (`database/schema.sql:129-141`) is the person/account record; students and guardians are both `app_user` rows within a tenant.
- `parental_consent` table already exists (compliance surface) — reuse for consent/age rules, do not duplicate.
- pglast validation runs in CI on `database/schema.sql` + `database/policies/rls.sql`.

## 5. Verification  (real output only — paste, don't summarize away errors)
- **QA (qa-agent):** ✅ **GREEN for #24** (one out-of-scope build breakage, see below).

  **Suite (real counts):**
  - `pnpm --filter @lms/events build` → exit 0 ✅ (compiled types expose the two new event keys).
  - `pnpm --filter @lms/service-user-org typecheck` → exit 0 ✅
  - `pnpm run typecheck` (repo-wide) → **47/47 successful** ✅
  - `pnpm run lint` (repo-wide) → **47/47 successful** ✅
  - `pnpm run test` (repo-wide) → exit 1 — **single flaky failure** in `@lms/service-relay`
    `main.test.ts › triggers a relay pass via POST /relay/run` (timed out 5000ms). **Re-ran
    `pnpm --filter @lms/service-relay test` → 9/9 pass (test 2045ms, exit 0).** `services/relay/**`
    is **untouched** by this branch (`git diff --name-only` confirms) → flaky/environmental, NOT a #24
    regression.
  - `pnpm run build` (repo-wide) → exit 1 — **`@lms/admin#build` EPERM symlink** on `.next/standalone`.
    **Root cause:** `apps/admin/next.config.js` (and `apps/web/next.config.js`) gained `output: "standalone"`
    on this branch — that triggers symlink creation under `.next/standalone/` which fails with `EPERM` on
    Windows without elevation. **This is OUT OF SCOPE for #24** — it is part of an unrelated infra/docker
    effort polluting the working tree (also `docker-compose*.yml`, `apps/*/Dockerfile`, `package.json`
    `start/stop/logs` scripts, `README.md`, `SETUP.md`, `docs/DEPLOYMENT.md`). None of #24's code
    (`guardian.*`, `user-org/src/main.ts`, `events/src/index.ts`, `schema.sql`, `rls.sql`) is involved.
  - `pnpm --filter @lms/service-user-org test` (scoped) → **Test Files 3 passed (3), Tests 40 passed (40)** ✅
    — `guardian.test.ts` **16/16 pass**.
  - **pglast:** `database/schema.sql` → **OK** (exit 0); `database/policies/rls.sql` → **OK** (exit 0).

  **AC → test mapping (`services/user-org/src/guardian.test.ts`):**
  - **AC1 — Guardian↔student relationship modeled:** `creates a pending link and lists it both directions`
    (L104–128, 201 + list by student & by guardian); `rejects a self-link (400) and a duplicate (409)`
    (L130–145, no-self + UNIQUE); `404s when a linked user does not exist` (L147–165, both `app_user`
    must exist); `validates input (400 on non-uuid)` (L167–188); `requires a tenant (400 without
    x-tenant-id)` (L190–195); `404s activating/revoking an unknown relationship` (L239–259).
  - **AC2 — Guardian read-only access to scoped data:** `authorize is true only for an active, consented
    guardian` (L262–304, the read predicate: pending→false, active+consent→true, stranger→false);
    **`exposes no guardian write path to child data (only the read predicate)` (L419–437)** — probes
    would-be write routes → 404, only the read-only predicate exists (proves **no guardian write path**);
    `isolates relationships by tenant` (L401–417, second tenant sees 0); `revoking the relationship denies
    authorize` (L346–374).
  - **AC3 — Consent/age rules respected:** `adults are never consent-gated` (L66–74) + `minors require the
    gating consent granted` (L76–93) (pure `evaluateGuardianConsent`); `blocks activation without consent
    and allows it once granted` (L198–237, minor activation gate → 409 `consent_required` then 200);
    **`revoking the student's consent denies authorize immediately` (L306–344)** — live re-check flips
    predicate to deny **without** mutating the relationship row; `activates an adult student's link without
    a consent row` (L376–398, adult age band).

  **No AC gaps** — all 3 ACs covered, including the two specifically required guardrails: a test proving
  guardians have **no write path** (L419–437) and a test proving a **consent revoke** (L306–344) **and** a
  **relationship revoke** (L346–374) make `authorize` deny immediately. No tests added (coverage already
  complete).

  **Root-cause / routing of the build red (out-of-scope, NOT #24):** the working tree carries an
  unrelated infra/docker change (`output: "standalone"` in `apps/{admin,web}/next.config.js` + docker
  compose/Dockerfile/script edits) that breaks `@lms/admin#build` on Windows (EPERM symlink). This is not
  owned by the guardian feature and has no single code owner → **route to `orchestrator`** (infra/build
  config) to either land it on its own story or strip it from this branch before merge. The relay test is
  flaky (green on re-run). **#24's deliverable is genuinely green.**
- **Security & DoD (security-agent):** ✅ **APPROVE** — grounded in the #24 diff (read-only review, no code modified).

  **1. Tenant isolation (highest severity) — PASS.**
  - `guardian_relationship` owns its own `tenant_id uuid NOT NULL REFERENCES tenant(id)` (`schema.sql:1191`) → standard isolation, no fragile join policy.
  - It is in the `tenant_tables` array (`rls.sql:38`), so the loop runs `ENABLE` + `FORCE ROW LEVEL SECURITY` and creates `tenant_isolation` `USING (tenant_id = current_tenant_id()) WITH CHECK (...)` (`rls.sql:42-54`). Control-plane `tenant` table is NOT in the loop. ✅
  - Every store method runs inside `withTenant(ctx, …)` (`guardian.prisma.ts:96,140,152,164,175,196,216`), so all statements execute under the RLS-scoped tx. The outbox insert runs in the same tx so its `WITH CHECK` passes (`guardian.prisma.ts:74-82`).
  - All params are bound, every uuid explicitly cast `$n::uuid`; **no string interpolation** of user input into SQL (the only interpolated token is the static `COLUMNS` constant). No SQL-injection surface. ✅
  - Cross-tenant resolution is impossible: the predicate's `getRelationship(guardianUserId, studentUserId)` (`guardian.prisma.ts:215-227`) is tenant-scoped via RLS, and the consent re-check (`getAgeBand`/`listConsents`, `consent.prisma.ts:118,128`) is likewise `withTenant`. A guardian in tenant A cannot resolve/authorize against a student in tenant B. List endpoints (`/students/:id/guardians`, `/guardians/:id/students`) filter under RLS. Verified by test `isolates relationships by tenant` (guardian.test.ts:401-417 — second tenant sees 0).

  **2. Authz / read-only — PASS (with a clearly-scoped, non-blocking follow-up).**
  - Read-only by construction: the only guardian-facing route is the read predicate `GET /guardians/authorize` (`guardian.routes.ts:256-321`); create/activate/revoke (#1,4,5) are admin/staff mutations against the *relationship*, never the child's data. Test `exposes no guardian write path to child data` (guardian.test.ts:419-437) proves would-be write routes 404 and only the read predicate exists.
  - **Verdict on `TODO(#24-followup)` (`guardian.routes.ts:98-100`):** ACCEPTABLE, not a shippable blocker. The service-level role guard is a **pre-existing repo-wide gap** — the sibling admin surfaces (`routes.ts` org-unit/role management, `consent.routes.ts`) are identically unguarded at this layer; the gateway authenticates and forwards `x-tenant-id`. #24 does not introduce a new hole or a new auth mechanism, and it does not widen the trust boundary (no mutation route trusts client-supplied tenant/role — tenant is re-resolved server-side via `resolveTenant`). The guard belongs to a cross-cutting follow-up, consistent with §4.E. **Recommend (non-blocking):** file the follow-up issue so the TODO is tracked.

  **3. Consent / age — PASS.** Consent is re-derived **live** per authorize request via `gateFor` → `evaluateGuardianConsent`/`dataCollectionDecision` (`guardian.routes.ts:64-85,303-309`); `consent_id` on the row is provenance only, never the gate. A consent revoke flips the predicate to deny **without** mutating the relationship (test guardian.test.ts:306-344) and a relationship revoke denies immediately (guardian.test.ts:346-374). Minors/unknown without a granted `directory_information` consent cannot be activated → `409 consent_required` (`guardian.routes.ts:220-227`; test guardian.test.ts:198-237). `adult` band is not age-gated by design (explicit out-of-band approval). No bypass found.

  **4. Secrets / PII — PASS.** No hardcoded credentials/DSNs/tokens. Event payloads carry only `{ guardianUserId, studentUserId, status }` (uuids + enum) — no names/PII (`guardian.prisma.ts:130-134,186-190,206-210`). No PII logged.

  **5. Definition of Done — PASS.** Story #24 linked (issue in §1; orchestrator enforces `Closes #24` + Conventional Commit + NO `Co-authored-by` at commit). Store-abstraction six-file shape intact (`guardian.ts` interface, `.memory`, `.prisma`, `.routes`, `.test`, wired in `main.ts:94-95`); business logic is the exported pure helper `evaluateGuardianConsent` with unit tests; `buildApp` stays side-effect-free. QA green per §5: repo typecheck 47/47, lint 47/47, user-org 40/40 (guardian 16/16), pglast schema.sql + rls.sql OK; all 3 ACs mapped to tests. The repo-wide `build` red (`output:"standalone"` EPERM) and the flaky relay test are **out of scope for #24** (no #24 file involved) — already routed to orchestrator; not a gate on this story.

  **Findings:** none blocking.
  - **[INFO / non-blocking]** `guardian.routes.ts:98-100` — service-level role guard deferred via `TODO(#24-followup)`; pre-existing repo-wide pattern, acceptable. Owner if pursued: **backlog-agent** to file the follow-up, then **service-builder** when the guard lands.
  - **[INFO / non-blocking]** `guardian.prisma.ts:174-193` — `activateRelationship` updates by id without asserting `status='pending'`, so an admin could re-activate a revoked link; harmless because activation still re-runs the live consent gate and is admin-only. No action required.

  **VERDICT: APPROVE.** Tenant isolation, authz/read-only, consent/age, secrets, and DoD all pass. Hand off to **docs-agent**; orchestrator to enforce commit hygiene at merge.

## 6. Open questions / blockers
- ~~"Read-only access to scoped data"~~ **RESOLVED (architect):** enforce
  read-only by construction — the only guardian-facing route is the read-only
  authz predicate `GET /guardians/authorize`; all link mutations are admin/staff.
  Cross-service enforcement is deferred: grading/announcement services call the
  predicate before returning a child's data (follow-up issues, §4.E). Scope for
  this slice = the relationship model + lifecycle + reusable predicate in
  `user-org`. See §4 A/B and ADR-0024.
- ~~Consent/age rules~~ **RESOLVED (architect):** reuse `parental_consent` (no
  duplication). Relationship starts `pending`; activation gated on the student's
  `directory_information` consent being `granted` for minors/unknown (via
  existing `dataCollectionDecision`, `consent.ts:113`); `adult` students require
  explicit approval (admin out-of-band for this slice; student self-approval is a
  follow-up). Live access re-checks consent per request so a consent revoke
  denies immediately without mutating the relationship. See §4.C.
- **New (architect, for service-builder):** `EVENT_TYPES` has no guardian
  entries — add `GUARDIAN_LINKED`/`GUARDIAN_REVOKED` to
  `packages/events/src/index.ts:24` before emitting outbox rows (§4.B/D).

## 7. Handshake log  (append-only; one line per hand-off)
- 2026-06-20 17:05 · orchestrator · Created handshake, claimed #24, filled task + ACs + grounding facts · **next owner → architect**
- 2026-06-20 17:10 · architect · Recorded design in §4 (table `guardian_relationship` + RLS, 6 routes incl. read-only `/guardians/authorize` predicate, consent/age rules reusing `parental_consent`+`dataCollectionDecision`, build sequence, follow-ups) + ADR-0024; resolved §6 open questions · **next owner → schema-agent**
- 2026-06-20 17:14 · schema-agent · Added `guardian_relationship` tenant-scoped table to `database/schema.sql` (COMPLIANCE block, after `parental_consent`) per architect §4.A — FKs to tenant/app_user/parental_consent, relationship+status CHECKs, no-self-link CHECK, UNIQUE(tenant_id,guardian_user_id,student_user_id), two indexes, `set_updated_at` trigger; added `'guardian_relationship'` to `tenant_tables` in `database/policies/rls.sql` (standard `tenant_isolation`, own tenant_id). Both files parse with pglast (schema.sql OK / rls.sql OK, exit 0). No deviations from spec. · **next owner → service-builder**
- 2026-06-20 17:16 · service-builder · Implemented the guardian slice in `services/user-org`: 6 routes (`guardian.routes.ts`), store split (`guardian.ts`/`.memory.ts`/`.prisma.ts` — raw SQL via `withTenant`+`$n::uuid`, `emitEvent` outbox), wired into `main.ts` (`BuildAppOptions.guardianStore`), reused `ConsentStore`+`dataCollectionDecision` for the live consent/age gate (revoke denies in real time), added `GUARDIAN_LINKED`/`GUARDIAN_REVOKED` to `EVENT_TYPES`. Read-only by construction (only `/guardians/authorize` is guardian-facing). 16 new tests; **40/40 pass**, typecheck/lint/build green (rebuilt `@lms/events`). No `database/*` or `packages/db/*` edits. · **next owner → qa-agent**
- 2026-06-20 17:26 · qa-agent · Verified #24 GREEN: repo-wide typecheck 47/47, lint 47/47; user-org scoped test 40/40 (guardian.test.ts 16/16); pglast schema.sql OK + rls.sql OK. Mapped all 3 ACs to tests (§5) incl. the no-write-path test (L419–437) and the consent-revoke (L306–344) + relationship-revoke (L346–374) deny-immediately tests — no gaps, no tests needed. Repo-wide `test` had one flaky relay timeout (services/relay untouched by branch → green 9/9 on re-run). Repo-wide `build` red is OUT-OF-SCOPE: `output:"standalone"` added to `apps/{admin,web}/next.config.js` (+ docker/Dockerfile/scripts/docs in the working tree) breaks `@lms/admin#build` with Windows EPERM symlink — not #24 code; routed to orchestrator (infra/build) to split out or strip before merge. #24 deliverable genuinely green. · **next owner → security-agent**
- 2026-06-20 17:41 · security-agent · **APPROVE** #24. Audited the changeset (read-only, no code modified): tenant isolation PASS — `guardian_relationship` owns `tenant_id` (`schema.sql:1191`) + is in the `rls.sql` `tenant_tables` loop (L38) → ENABLE/FORCE + `tenant_isolation`; control-plane `tenant` excluded; all `guardian.prisma.ts` queries run via `withTenant` with `$n::uuid` casts, no string interpolation (no SQLi); no cross-tenant resolve path. Authz/read-only PASS — only `/guardians/authorize` is guardian-facing, mutations are admin/staff; `TODO(#24-followup)` service role guard is an ACCEPTABLE pre-existing repo-wide gap (gateway authenticates; tenant re-resolved server-side), non-blocking → recommend backlog-agent file the follow-up. Consent/age PASS — re-derived live per authorize, consent/relationship revoke deny immediately without mutating the row, minors gated. Secrets PASS — events carry ids only, no PII/creds. DoD PASS — story #24 linked, six-file store-abstraction shape, pure helper + tests, QA green (47/47 typecheck+lint, 40/40 user-org, pglast OK); out-of-scope build red already routed to orchestrator. No blocking findings. · **next owner → docs-agent**
- 2026-06-20 17:44 · docs-agent · Updated the GENERATED per-service specs the correct way — edited the source generator `scripts/docs/gen-service-specs.py` (user-org entry: added `guardian_relationship` to tables, 6 guardian endpoints `POST /guardians`, `GET /students/{studentId}/guardians`, `GET /guardians/{guardianId}/students`, `POST /guardians/{id}/activate`, `POST /guardians/{id}/revoke`, `GET /guardians/authorize`; added `guardian.linked`/`guardian.revoked` to publishes; extended resp/notes) and ran `python scripts/docs/gen-service-specs.py` → "Wrote 27 specs + index" (exit 0), regenerating `docs/services/user-org.md` + `docs/services/README.md`. Verified real event names against `packages/events/src/index.ts` and real routes/paths against `services/user-org/src/guardian.routes.ts` (no hand-editing of generated output). ADR-0024 left as-is (design-level, consistent with shipped surface). No edits to clean unrelated docs (FEATURES.md already documents parents/guardians) or the dirty `README.md`. Out-of-scope build red still pending orchestrator. Did NOT commit. · **next owner → orchestrator**
