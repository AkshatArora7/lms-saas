# Handshake — feat/engagement-authz

> **Single source of truth for one task.** Subagents are stateless; this file
> carries context between them. Every agent **reads this file in full before
> acting** and **updates its own section before handing off**. Facts here must be
> grounded in source (the issue, `AGENTS.md`, the code/schema) — never invented.
> When this file and the code/schema disagree, the **source wins**: fix the code
> claim, then correct this file. Never delete another agent's section.

## 1. Task
- **Issue:** #284 — feat(analytics): enforce teacher-owns-course authorization on GET /reports/engagement  ·  https://github.com/AkshatArora7/lms-saas/issues/284
- **Type:** feat
- **Branch:** feat/engagement-authz  (off fresh `main`)
- **Requested by / date:** AkshatArora7 · 2026-06-21
- **One-line goal:** Defence-in-depth: ensure `GET /reports/engagement` only returns data when the authenticated caller actually teaches the requested course (or is an admin).

## 2. Acceptance criteria  (verbatim from the issue — do not paraphrase)
- [ ] `GET /reports/engagement` verifies the authenticated caller is an instructor of the requested course (or an admin) before returning data; otherwise 403 (or 404 to avoid existence disclosure — pick and document one).
- [ ] Authorization derives the teacher's taught-course set from a trusted source (enrollment/instructor assignment for the session userId), not from a client-supplied claim.
- [ ] Endpoint remains tenant-scoped (RLS unchanged); the new check is layered ON TOP, not a replacement for RLS.
- [ ] Unit test: a teacher requesting a course they don't teach gets 403/404; a teacher requesting their own course gets 200; admin override (if adopted) covered.
- [ ] No regression to the `/teach` happy path.

## 3. Stage status  (tick only with evidence in the matching section)
| Stage | Owner | Status | Evidence |
| ----- | ----- | ------ | -------- |
| Requirements | backlog-agent | ☑ done | Issue #284 created, assigned, In Progress |
| Architecture | architect | ☑ done | §4 Architecture: gateway stamps trusted `x-user-id`/`x-user-roles`; analytics resolves caller + local enrollment authz guard; 403 deny; ADR-0027 |
| UX design | ux-designer | ☐ | |
| Data & RLS | schema-agent | ☐ | |
| Backend | service-builder | ☑ done | §4 Implementation: gateway stamps+strips `x-user-id`/`x-user-roles`; analytics `resolveCaller` 401-guard + `teachesCourse` store method + pure `isCourseReadAuthorized` + 403 deny. Verified: analytics 33 tests, gateway 23 tests, both typecheck+lint clean |
| Frontend | frontend-dev | ☑ done | §4 Implementation (web BFF): `analytics-api.ts getCourseEngagement` forwards trusted `x-user-id`+`x-user-roles` (roles `join(",")` matching gateway auth.ts:96) alongside `x-tenant-id`, threaded from `session.userId`/`session.roles` in `teach/page.tsx:420`. No UI change. web typecheck+lint clean |
| QA / tests | qa-agent | ☑ done | §5 QA: full local pipeline GREEN — pglast 2/2, lint 53/53, typecheck 53/53, test 45/45 (analytics 33, gateway 23), build 34/36 (only @lms/web+@lms/admin = known Windows EPERM standalone-symlink host non-issue). All 5 ACs mapped to named passing tests; 403 (not 404) confirmed implemented + documented. No regression. |
| Security & DoD | security-agent | ☑ done | §5 Security & DoD: **APPROVE** — RLS unweakened (guard layered ON TOP; `teachesCourse` + `getCourseEngagement` both inside `withTenant`, cross-tenant admin empty `:562`); headers spoof-proof (gateway strips+re-stamps `x-user-id`/`x-user-roles` from verified claims, proxy.ts:34-35/87-90 + auth.ts:95-96, test `:249`); no existence-disclosure differential (non-existent & not-taught both 403); DoD met (no secrets, six-file pattern, VITEST-guarded buildApp, story #284 linked). Tenant-wide admin override OK to ship; 2 non-blocking follow-ups filed below. |
| Docs | docs-agent | ☑ done | ADR-0027 `docs/ADR-0027-trusted-identity-headers.md` authored (gateway-stamped trusted `x-user-id`/`x-user-roles`, anti-spoof strip+re-stamp, authz ON TOP of RLS, 403-not-404, comma-join consistency gateway↔BFF, internal-only prod trust assumption cross-ref'd to DEPLOYMENT.md + hardening follow-up). Linked from hand-authored `docs/ARCHITECTURE.md` (Cross-cutting → new "Trusted identity headers" bullet). Gateway service spec updated via the GENERATOR (`scripts/docs/gen-service-specs.py` notes field) + re-ran `python scripts/docs/gen-service-specs.py` → "Wrote 27 specs + index"; only `docs/services/gateway.md` changed (now links ADR-0027). No hand-edit of generated specs. Links verified resolve. |

## 4. Decisions & contracts  (append; never rewrite history)
- **Architecture (architect):** Defence-in-depth course authz on `GET /reports/engagement`, grounded in the code below. **Design only — no code written.**

  ### 1. How the endpoint works today (grounded)
  - Route: `services/analytics/src/routes.ts:200-212` — `GET /reports/engagement`, reads `courseId` from the querystring, validates it is a uuid (`isUuid`, routes.ts:39-43) → 400 if not, then calls `deps.store.getCourseEngagement(ctx, courseId.trim())` and returns 200. **No caller/authz check today** — the route comment (routes.ts:196-199) explicitly says "Teacher scoping is a BFF concern; the endpoint is tenant-scoped only."
  - Tenant scoping: `resolveTenantOr400` → `deps.resolveTenant` (routes.ts:17-30). Default resolver `headerTenantResolver` reads **only** `x-tenant-id` (main.ts:36-50). Store runs every query inside `withTenant(ctx, …)` so Postgres RLS scopes rows to the tenant (store.prisma.ts:320, 309-314, etc.).
  - **Caller identity is NOT available to analytics today.** The gateway authenticates the JWT and forwards **only** `x-tenant-id` downstream (`auth.ts:88-92`), and the reverse proxy **strips** `authorization` + client-supplied `x-tenant-id`, then re-stamps the trusted `x-tenant-id` (`proxy.ts:25-32, 73-80`). So the analytics service currently receives no trusted `userId`/`roles`. The verified claims carry them: `AccessTokenClaims { sub: userId, tenantId, roles: StandardRole[] }` (`packages/auth/src/index.ts:29-39`).
  - The web `/teach` BFF calls analytics **directly** (not via the gateway): `apps/web/app/lib/analytics-api.ts:88-99` sends only `x-tenant-id` (it has `session.userId` + `session.roles` available — see teach page `page.tsx:410,420`). mobile-bff does **not** call engagement (no match for `engagement`/`reports/`), so it needs no change.

  ### 2. Trusted source of "teacher teaches course X" (grounded)
  The authoritative signal is an **`enrollment` row with a teaching role on the course's offering** — the exact relationship the platform already uses:
  - `course.org_unit_id` is the offering (UNIQUE, schema.sql:305); `enrollment` is keyed by `org_unit_id` + `user_id` + `role_id` (schema.sql:357-369).
  - The existing engagement learner SQL already joins `course c ON c.org_unit_id = e.org_unit_id JOIN role r ON r.id = e.role_id` (store.prisma.ts:165-172), and the BFF `getTaughtCourses` filters teaching enrollments by role ∈ {instructor, teacher, teaching_assistant} and status ∉ {withdrawn, inactive} (teaching.ts:43-74).
  - Demo proof: `seed.demo.ts:339` enrolls TEACHER (`d0000000-00a1-0000-0000-000000000001`) as `instructor` on the OFFERING; STUDENT as `learner` (340).
  - **Data ownership / no HTTP hop:** analytics already runs RLS-scoped reads over the shared domain tables — it resolves membership **locally** with one bound query inside `withTenant`. No call to enrollment/identity services (rejected option — adds a network hop + coupling and the identity `checkAccess` is permission@org-unit, not "teaches course"; authz.ts:56-67).

  **Authorization query** (new store method, RLS-scoped, `$n::uuid` cast per the #267 rule):
  ```sql
  SELECT 1
    FROM enrollment e
    JOIN course c ON c.org_unit_id = e.org_unit_id
    JOIN role   r ON r.id = e.role_id
   WHERE c.id = $1::uuid
     AND e.user_id = $2::uuid
     AND r.name IN ('instructor','teacher','teaching_assistant')
     AND e.status IN ('active','completed')
   LIMIT 1
  ```
  Returns a row ⇒ caller teaches the course. Uses existing indexes (`ix_enrollment_user` schema.sql:369, `ix_enrollment_ou` :368, `course.org_unit_id` UNIQUE :305) — **no new index/table ⇒ schema-agent NOT required.**

  ### 3. Decisions
  - **Identity transport (net-new platform pattern → ADR-0027):** the **gateway stamps two trusted headers from verified claims**, exactly as it already does for `x-tenant-id`: `x-user-id = claims.sub` and `x-user-roles = claims.roles.join(",")` (`auth.ts:88-92`). The proxy must **add `x-user-id` + `x-user-roles` to `STRIP_REQUEST_HEADERS`** (proxy.ts:25-32) and re-stamp them from `req.claims`, so a client can never spoof identity. The web BFF (a trusted server holding the session) forwards the same two headers from `session.userId`/`session.roles`.
  - **403 vs 404 → choose `403 forbidden`.** Rationale: RLS already confines all visible courses to the caller's own tenant, so "course exists in my tenant" is not a meaningful leak; 403 is the honest semantic (authenticated, tenant-scoped, but not authorized for this course) and matches the gateway's existing `requireScope` 403 (auth.ts:109-114). **Enumeration is closed by construction:** the guard denies on "no teaching enrollment", which is the *same* outcome whether the courseId is non-existent or exists-but-not-taught — both return 403, so there is no existence-disclosure differential. (Today both currently return 200 + empty; the change tightens this.)
  - **Admin override:** admin = caller roles ∩ {`super_admin`, `org_admin`} ≠ ∅ (the `StandardRole` admin personas, packages/types:84-91; consistent with `canTeach` including `org_admin` teaching.ts:40 and the `super_admin` bypass packages/auth:82). Admins skip the membership query and are allowed. **Simplification (documented):** the override is tenant-wide, not org-unit-scoped — full org-scoped admin (role_assignment + ancestry) is deferred; see Open Questions.
  - **Missing caller header → `401 unauthorized` (fail closed).** The gateway/BFF always stamp `x-user-id` for an authenticated request; its absence means unauthenticated/misconfigured.

  ### 4. Insertion point + contracts (store-abstraction preserved)
  - `routes.ts` — extend `AnalyticsRouteDeps` with `resolveCaller(req): Caller` (sibling of `resolveTenant`), reading `x-user-id` (uuid) + `x-user-roles` (comma-split). Add `resolveCallerOr401`. In the `/reports/engagement` handler, **after** tenant + uuid validation and **before** `getCourseEngagement`:
    ```ts
    const caller = resolveCallerOr401(deps, req, reply); if (!caller) return reply;
    const isAdmin = caller.roles.some((r) => ADMIN_ROLES.includes(r));
    const teaches = isAdmin ? true : await deps.store.teachesCourse(ctx, caller.userId, courseId.trim());
    if (!isCourseReadAuthorized({ roles: caller.roles, teaches })) {
      return reply.code(403).send({ error: "forbidden", message: "You do not have access to this course's engagement." });
    }
    ```
    (Admin short-circuits the DB query.) `main.ts` `headerTenantResolver` gets a sibling `headerCallerResolver` reading the two headers.
  - `store.ts` — pure, unit-testable decision + constants (mirrors `checkAccess` purity, authz.ts):
    ```ts
    export const ADMIN_ROLES = ["super_admin", "org_admin"] as const;
    export const TEACHING_ENROLLMENT_ROLES = ["instructor","teacher","teaching_assistant"] as const;
    export function isCourseReadAuthorized(i: { roles: string[]; teaches: boolean }): boolean {
      return i.roles.some((r) => (ADMIN_ROLES as readonly string[]).includes(r)) || i.teaches;
    }
    ```
    Add to the `AnalyticsStore` interface: `teachesCourse(ctx: TenantContext, userId: string, courseId: string): Promise<boolean>;`
  - `store.prisma.ts` — implement `teachesCourse` with the §2 query via `withTenant` + `$queryRawUnsafe`, params `(courseId, userId)`; `return rows.length > 0`.
  - `store.memory.ts` — implement `teachesCourse` against a seeded `tenant→(courseId→Set<teacherUserId>)` map; seed `DEMO_TENANT_ID → { DEMO_COURSE → {DEMO_TEACHER} }` with `DEMO_TEACHER = "d0000000-00a1-0000-0000-000000000001"` (seed.demo.ts:35,339) so the demo/tests agree with the DB path.

  ### 5. Build sequence + specialists (no schema-agent, no ux-designer)
  1. **docs-agent** — author **ADR-0027** "Gateway-stamped trusted caller identity headers (`x-user-id`/`x-user-roles`)" recording the §3 transport decision (can run in parallel with step 2).
  2. **service-builder (gateway owner)** — stamp `x-user-id`/`x-user-roles` from claims in `auth.ts`; strip+re-stamp in `proxy.ts`; add a unit test that a spoofed inbound header is overwritten. (Foundational — analytics depends on the header contract.)
  3. **service-builder (analytics owner)** — `routes.ts` guard + `resolveCaller`, `store.ts` pure helper + interface, `store.prisma.ts` + `store.memory.ts` `teachesCourse`, `main.ts` caller resolver. Per §4.
  4. **frontend-dev (web BFF)** — `analytics-api.ts getCourseEngagement` forwards `x-user-id` (`session.userId`) + `x-user-roles` (`session.roles`); thread them from `teach/page.tsx:420`. Guarantees no `/teach` regression (it only requests courses the instructor teaches → guard passes).
  5. **qa-agent** — update `analytics.test.ts` engagement tests to send caller headers; add the three AC cases: teacher of another course → 403; own course → 200; admin (`org_admin`/`super_admin`) → 200; keep tenant-isolation + 400 invalid-uuid cases; run typecheck/lint/test/build.
  6. **security-agent** — verify RLS unchanged (guard is layered ON TOP), spoof-proof headers, no existence-disclosure differential, DoD.

  **ADR warranted:** yes — **ADR-0027** for the net-new "gateway/BFF-stamped trusted caller identity headers" pattern (latest is ADR-0026).
- **Data shapes (schema-agent):** <pending>
- **Design (ux-designer):** <pending>
- **Implementation (service-builder / frontend-dev):**
  - **Gateway (anti-spoof identity transport, ADR-0027):**
    - `services/gateway/src/auth.ts` — `authGuard` now stamps `req.headers["x-user-id"] = claims.sub` and `req.headers["x-user-roles"] = claims.roles.join(",")` from the VERIFIED claims, mirroring the existing `x-tenant-id` stamp.
    - `services/gateway/src/proxy.ts` — added `x-user-id` + `x-user-roles` to `STRIP_REQUEST_HEADERS` (strip any client-supplied copy), then re-stamp from `req.claims` after the `x-tenant-id` stamp. A client can never inject identity.
    - `services/gateway/src/main.test.ts` — +2 proxy tests: identity stamped from claims; spoofed inbound `x-user-id`/`x-user-roles` overwritten. (gateway: 23 tests pass.)
  - **Analytics (authz guard layered ON TOP of RLS):**
    - `services/analytics/src/store.ts` — added `ADMIN_ROLES`, `TEACHING_ENROLLMENT_ROLES`, pure `isCourseReadAuthorized({roles,teaches})`, and `AnalyticsStore.teachesCourse(ctx,userId,courseId)`.
    - `services/analytics/src/store.prisma.ts` — `teachesCourse` via `withTenant` + `$queryRawUnsafe`, both uuid params cast (`$1::uuid` courseId, `$2::uuid` userId, #267 rule); `return rows.length > 0`.
    - `services/analytics/src/store.memory.ts` — seeded `teachingSource` map `DEMO_TENANT → {DEMO_COURSE → {DEMO_TEACHER}}` (`DEMO_TEACHER = d0000000-00a1-0000-0000-000000000001`), `teachesCourse` lookup.
    - `services/analytics/src/routes.ts` — `Caller` type + `resolveCaller` dep + `resolveCallerOr401` (401 fail-closed); `/reports/engagement` guard: tenant→uuid→caller→admin-short-circuit/`teachesCourse`→`isCourseReadAuthorized`→403 `{error:"forbidden"}` else compute engagement. RLS/withTenant unchanged.
    - `services/analytics/src/main.ts` — `headerCallerResolver` reading `x-user-id`/`x-user-roles` (throws if `x-user-id` absent → 401); wired into `buildApp` + `BuildAppOptions.resolveCaller`.
    - `services/analytics/src/analytics.test.ts` — updated existing engagement tests to send caller headers; added 403 (teacher not teaching), 200 (own course), 200 (admin not teaching), 401 (no `x-user-id`), tenant-isolation via OTHER-tenant admin, + pure `isCourseReadAuthorized` cases. (analytics: 33 tests pass.)
  - **Authorization SQL used (RLS-scoped, in `teachesCourse`):**
    ```sql
    SELECT 1
      FROM enrollment e
      JOIN course c ON c.org_unit_id = e.org_unit_id
      JOIN role   r ON r.id = e.role_id
     WHERE c.id = $1::uuid
       AND e.user_id = $2::uuid
       AND r.name IN ('instructor','teacher','teaching_assistant')
       AND e.status IN ('active','completed')
     LIMIT 1
    ```
  - **No deviations from the architect design.** Web BFF (`apps/web/.../analytics-api.ts`) header forwarding is the separate frontend-dev step (build seq §5.4) and was not in this scope; flagged for that owner.
  - **Web BFF identity forwarding (frontend-dev, build seq §5.4):**
    - `apps/web/app/lib/analytics-api.ts` — replaced `tenantHeader(tenantId)` with `callerHeaders(tenantId, userId, roles)` which forwards `x-tenant-id`, `x-user-id` (= session userId), and `x-user-roles` = `roles.join(",")` — comma-separated, no spaces, EXACTLY matching the gateway stamp (`services/gateway/src/auth.ts:96` `claims.roles.join(",")`). Empty roles → `""` (never `"undefined"`). `getCourseEngagement` signature gained `userId: string, roles: string[]`. Server-side session values only; no client-supplied trust. No UI/markup change.
    - `apps/web/app/teach/page.tsx:420` — threads `session.userId` + `session.roles` (Session shape `auth.ts:39,42`) into the per-course `getCourseEngagement` fan-out, so the `/teach` happy path passes the analytics 401/403 guard (it only requests courses the instructor teaches → `teachesCourse` true).
    - Verified: `pnpm --filter @lms/web typecheck` ✅ pass, `pnpm --filter @lms/web lint` ✅ pass. (build skipped — known Windows `output:"standalone"` EPERM host-only non-issue; typecheck+lint are the frontend host gate.)

## 5. Verification  (real output only — paste, don't summarize away errors)
- **QA (qa-agent):** **2026-06-21 — full local pipeline run (CI billing off; local IS the gate). Commands match `.github/workflows/ci.yml`.**

  **Per-stage results (exact counts):**
  | Stage | Command | Result | Counts (verbatim turbo/vitest summary) |
  | ----- | ------- | ------ | -------------------------------------- |
  | pglast | `python -c "import pglast; parse_sql(schema.sql, policies/rls.sql)"` | ✅ PASS | `OK database/schema.sql`, `OK database/policies/rls.sql` — 2/2 (no schema diff for #284, as expected) |
  | lint | `pnpm -w run lint` | ✅ PASS | `Tasks: 53 successful, 53 total` |
  | typecheck | `pnpm -w run typecheck` | ✅ PASS | `Tasks: 53 successful, 53 total` |
  | test | `pnpm -w run test` | ✅ PASS | `Tasks: 45 successful, 45 total`; `@lms/service-analytics: Tests 33 passed (33)`; `@lms/service-gateway: 2 files, Tests 23 passed (23)` (ratelimit 8 + main 15). integration-tests 20 skipped (need live DB — expected). 0 failures. |
  | build | `pnpm -w run build` | ✅ PASS* | `Tasks: 34 successful, 36 total` — the 2 not-successful are `@lms/admin` + `@lms/web` ONLY, both `EPERM: operation not permitted, symlink … .next/standalone/…` = the KNOWN Windows `output:"standalone"` host-only non-issue (per gate, web/admin host gate is typecheck+lint, both ✅). All other 34 packages (every service incl. analytics + gateway, all shared packages) built clean. |

  **Grand total: pglast 2/2, lint 53/53, typecheck 53/53, test 45/45, build 34/34 real (2 excluded Windows-EPERM) — ALL GREEN. No regression vs baseline; analytics 33 / gateway 23 match the service-builder's reported counts.**

  **AC → test mapping (each test opened & read; asserts the right status/behavior):**
  | Acceptance criterion | Test (file:line · name) | Asserts | Result |
  | -------------------- | ----------------------- | ------- | ------ |
  | own course → 200 | `analytics.test.ts:542` · "200 when a teacher requests their own course" | status 200 + `engagement.courseId === DEMO_COURSE`; TEACHER_H teaches via seeded `teachingSource[DEMO_TENANT][DEMO_COURSE]={DEMO_TEACHER}` | ✅ PASS |
  | not-taught course → **403** | `analytics.test.ts:531` · "403 when a teacher requests a course they do not teach" | status **403** + `error==="forbidden"`; instructor role, course not in teachingSource → `teachesCourse=false` → `isCourseReadAuthorized=false` | ✅ PASS |
  | admin override → 200 | `analytics.test.ts:552` · "200 for an admin even when they do not teach the course" | status 200 + courseId; ADMIN_H roles `org_admin` → `isAdmin` short-circuits the DB query (`teaches=true`) | ✅ PASS |
  | missing x-user-id → 401 | `analytics.test.ts:521` · "401 when no caller identity (x-user-id) is present" | status 401 + `error==="unauthorized"`; headers=H (tenant only) → `headerCallerResolver` (real default, not stubbed) throws → `resolveCallerOr401` 401 | ✅ PASS |
  | gateway strips + re-stamps caller identity from claims (anti-spoof) | `gateway/main.test.ts:234` · "stamps trusted caller identity headers from the verified claims" **and** `:249` · "overwrites spoofed client x-user-id / x-user-roles with the token's identity" | `:234` forwarded `x-user-id===sub`, `x-user-roles==="instructor,org_admin"`; `:249` inbound spoofed `x-user-id:"super-admin-victim"`/`x-user-roles:"super_admin,org_admin"` are OVERWRITTEN to `teacher-7`/`instructor` from the verified token | ✅ PASS |
  | RLS unchanged / tenant-scoping holds | pglast 2/2 (no schema/RLS diff) **+** `analytics.test.ts:562` · "isolates tenants: an admin in another tenant sees an empty engagement" | OTHER_ADMIN_H (tenant=OTHER, org_admin): guard passes via admin override but data read is still tenant-scoped → 200 with `score:null, learnerCount:0, atRisk:[]` — proves the authz guard is layered ON TOP of, not a replacement for, tenant isolation | ✅ PASS |
  | (supporting) pure decision helper | `analytics.test.ts:462-476` · "isCourseReadAuthorized (#284, pure)" 4 cases | teacher-teaches→true, teacher-not-teaches→false, org_admin/super_admin→true, learner→false | ✅ PASS |
  | (supporting) 400 invalid/missing uuid & tenant-required | `analytics.test.ts:506` ("400 when courseId is missing or not a uuid"), `:579` ("requires a tenant — 400 without x-tenant-id") | 400 paths precede caller check (tenant→uuid→caller→authz ordering, routes.ts:239-259) | ✅ PASS |

  **403 vs 404 decision (as actually implemented):** **403** — `routes.ts:254-259` returns `reply.code(403).send({error:"forbidden", …})`. Matches the architect's §4 decision (403 is honest: authenticated + tenant-scoped but not authorized; enumeration closed by construction since non-existent and exists-but-not-taught both 403). Test `:531` asserts 403. Documented and consistent.

  **No `/teach` happy-path regression (unit level):** web BFF now forwards `x-user-id`/`x-user-roles` from the server session (frontend-dev §5.4); the analytics `teaches=true` path is covered by `:542` (own course → 200) and `:479` "returns the seeded demo course engagement + high-risk learner" (now sent with TEACHER_H, full body assertion intact: score 69.6, 1 learner, high-risk DEMO_STUDENT). web typecheck+lint green. No behavioral change for a teacher requesting their own course.

  **Root cause / failures:** NONE — no #284-caused failure; no pre-existing/flaky failure. The only non-green tasks are the documented Windows-only `@lms/web`/`@lms/admin` standalone-symlink EPERM (host artifact, not CI; web/admin host gate is typecheck+lint, both pass).

  **Verdict: 🟢 GREEN.** All ACs covered by named, asserting, passing tests. Ready for the security-agent DoD/security gate (verify RLS-on-top, spoof-proof headers, no existence-disclosure differential, tenant-wide admin-override open question §6).
- **Security & DoD (security-agent):** **2026-06-21 — VERDICT: ✅ APPROVE (safe to merge once committed).** Audited the actual unstaged diff (11 files, `git diff` working tree; no commit yet).

  **1. Tenant isolation — NOT weakened (sacred boundary intact).** The new authz is layered ON TOP of RLS, never replacing it. `teachesCourse` runs entirely inside `withTenant(ctx, …)` (store.prisma.ts:374-382) so the trusted-source query is itself RLS-scoped — a teaching enrollment in another tenant is invisible. The admin override skips only the `teachesCourse` lookup (routes.ts:251-253); the data read `getCourseEngagement` still runs inside `withTenant` (store.prisma.ts:336), so an admin in another tenant is still tenant-bounded → empty result (analytics.test.ts:562 `OTHER_ADMIN_H` tenant=OTHER → `score:null, learnerCount:0, atRisk:[]`). Memory store mirrors this (keyed by `ctx.tenantId`, store.memory.ts:132-134,227). pglast 2/2 with no schema/RLS diff confirms no policy change. ✔
  **2. Spoofing — closed.** Gateway adds `x-user-id`/`x-user-roles` to `STRIP_REQUEST_HEADERS` (proxy.ts:34-35) and re-stamps them from VERIFIED claims (`req.claims.sub` / `claims.roles.join(",")`, proxy.ts:87-90; auth.ts:95-96). Test `main.test.ts:249` proves an inbound spoofed `x-user-id:"super-admin-victim"`/`x-user-roles:"super_admin,org_admin"` is OVERWRITTEN to the token's `teacher-7`/`instructor`. No other gateway path sets these without strip/stamp. **Trust assumption (explicit):** analytics trusts its network — only the gateway and the web BFF (a trusted server holding the httpOnly session, which calls analytics directly with session-derived headers) may reach it. This is the SAME trust model already in force for `x-tenant-id` and predates #284. NOTE: `docker-compose.yml:430-431` publishes analytics `4015:4015` to the host (dev convenience, applies to all 26 services) — in production analytics MUST be internal-only (not reachable by untrusted clients), else a direct caller could self-stamp identity headers. Not a #284 defect; see follow-up (b). ✔
  **3. Authz correctness.** 401 fail-closed when `x-user-id` absent (`headerCallerResolver` throws → `resolveCallerOr401`, main.ts:58-63 / routes.ts:51-64; test `:521`). 403 (not 404) decision documented & consistent (routes.ts:254-259). Admin set = {super_admin, org_admin} (store.ts:519) — the intended `StandardRole` privileged personas. Teaches query is the right trusted source: enrollment role ∈ {instructor,teacher,teaching_assistant}, status ∈ {active,completed}, joined via `course.org_unit_id = enrollment.org_unit_id`, both uuid params cast `$1::uuid`/`$2::uuid` (store.prisma.ts:206-215, #267 rule). ✔
  **4. Existence disclosure — no differential.** For a non-admin caller, a non-existent courseId and an exists-but-not-taught courseId BOTH yield `teaches=false` → `isCourseReadAuthorized=false` → identical 403 (routes.ts:251-259). No enumeration channel. ✔
  **5. DoD.** Story #284 linked (handshake §1). Store-abstraction six-file pattern intact: pure `isCourseReadAuthorized` + constants in store.ts (unit-tested `:462-476`), interface method, prisma + memory parity; `buildApp` side-effect-free with `if (!process.env.VITEST) void start()` guard (main.ts:125-127). No secrets added (headers from claims/session/env only). qa-agent suite GREEN folded in (pglast 2/2, lint 53/53, typecheck 53/53, test 45/45, build 34/34 real). ✔

  **OPEN §6 adjudication — tenant-wide admin override:** **ACCEPTABLE TO SHIP for #284, improvable.** The AC only requires "or an admin"; RLS already confines every read to the caller's own tenant, so a tenant admin reading any course's engagement within their own tenant is not a cross-tenant leak. Org-unit-scoped admin (role_assignment + ancestry) is a strict refinement, not a defect — defer to a tracked follow-up, do NOT block. Recommend filing follow-up (a).

  **Findings (severity-tagged):** none blocking. No isolation/authz/secrets defect attributable to #284.
  - **[INFO]** routes.ts orders 400-uuid-validation BEFORE 401-caller-resolution, so a malformed `courseId` returns 400 to an unauthenticated caller. No data/existence disclosed (pure input validation) — acceptable, not a finding.
  - **[ADVISORY · commit-time DoD]** Change is currently UNSTAGED (no commit on the branch; HEAD==main). Hygiene cannot be ticked until committed — the commit MUST be a Conventional Commit, reference the issue (`Refs #284` / `Closes #284`), and carry NO `Co-authored-by: Copilot` trailer. Owner: whoever commits (orchestrator).

  **Recommended NON-blocking follow-ups to file as issues:**
  - **(a)** Org-unit-scoped admin override for `/reports/engagement` — scope `org_admin` to the course's org-unit subtree via `role_assignment` + ancestry (identity `checkAccess`/`getAncestry`); keep `super_admin` tenant-wide. Owner: service-builder (analytics) + possibly schema-agent.
  - **(b)** Deployment hardening — ensure analytics (and all domain services) are not published to untrusted networks in production; the `4015:4015` host port in docker-compose is dev-only. Owner: docs-agent/infra. Pre-existing, not #284.

  **Verdict: ✅ APPROVE — safe to merge** once committed with clean hygiene (advisory above). No code changes requested.

## 6. Open questions / blockers
- **(resolved in design)** How does analytics learn the caller's userId/roles? → gateway/BFF stamp trusted `x-user-id`/`x-user-roles` headers (ADR-0027). Not from a client claim.
- **(open, low-risk) Org-unit-scoped admin override:** the design treats `org_admin`/`super_admin` as a tenant-wide override. A stricter model would scope `org_admin` to the course's org-unit subtree via `role_assignment` + ancestry (identity `checkAccess`/`getAncestry`, authz.ts:98-107). Deferred — RLS already confines to the tenant and the AC only says "or an admin". Confirm acceptable with security-agent; if not, this becomes a follow-up story (adds an org-ancestry lookup in analytics or an identity call).
- **(confirm in build)** Existing engagement tests in `analytics.test.ts:444-512` send only `x-tenant-id`; they MUST be updated to also send `x-user-id`/`x-user-roles` or they will now 401/403. qa-agent owns this — it is an intended test change, not a regression.

## 7. Handshake log  (append-only; one line per hand-off)
- 2026-06-21 14:46 · backlog-agent · seeded handshake from issue #284, branch feat/engagement-authz created off main @803d96b · **next owner → orchestrator**
- 2026-06-21 14:49 · architect · recorded technical design (§4): gateway/BFF-stamped trusted `x-user-id`/`x-user-roles` (ADR-0027), local enrollment authz guard in analytics (`teachesCourse` + pure `isCourseReadAuthorized`), 403-deny with no existence-disclosure differential, admin override = {super_admin, org_admin}. No schema change. Build order: docs(ADR) → gateway → analytics → web BFF → qa → security. · **next owner → orchestrator** (then docs-agent for ADR-0027 + service-builder for gateway)
- 2026-06-21 14:54 · service-builder · implemented gateway identity-header stamp/strip + analytics engagement authz guard (`resolveCaller` 401, `teachesCourse` store method with `$n::uuid` casts, pure `isCourseReadAuthorized`, 403 deny) per §4 design — no deviations. Verified locally: analytics 33 tests + gateway 23 tests pass, both typecheck+lint clean. Web BFF header forwarding (§5.4) still pending for frontend-dev. · **next owner → qa-agent** (run full repo suite + map tests to AC), then frontend-dev for web BFF, then security-agent.
- 2026-06-21 15:03 · frontend-dev · web BFF identity forwarding (§5.4): `analytics-api.ts getCourseEngagement` now forwards trusted `x-user-id` (session userId) + `x-user-roles` (`roles.join(",")`, comma-separated, matching gateway auth.ts:96) beside `x-tenant-id`; threaded `session.userId`/`session.roles` from `teach/page.tsx:420`. Server-session values only, empty roles → "". No UI change. Verified: web typecheck ✅ + lint ✅ (build is host-only Windows EPERM, skipped per gate). No `/teach` regression — page only requests taught courses. · **next owner → qa-agent** (full repo suite + AC mapping), then security-agent.
- 2026-06-21 15:10 · qa-agent · ran the full local CI-equivalent pipeline (CI billing off → local is the gate; commands match ci.yml). **ALL GREEN:** pglast 2/2, lint 53/53, typecheck 53/53, test 45/45 (analytics 33, gateway 23, integration 20 skipped/need-DB), build 34/34 real-successful — the only 2 non-green are `@lms/web`+`@lms/admin` = KNOWN Windows `output:"standalone"` EPERM symlink host non-issue (web/admin host gate = typecheck+lint, both ✅). Mapped all 5 ACs to named, opened-and-verified passing tests (own→200 `:542`; not-taught→**403** `:531`; admin→200 `:552`; missing x-user-id→401 `:521` via real `headerCallerResolver`; gateway anti-spoof strip+restamp `main.test.ts:234,:249`; RLS/tenant-scoping unchanged via pglast no-diff + cross-tenant admin `:562`). **403 (not 404) confirmed implemented** (routes.ts:254-259) and documented. No `/teach` regression at unit level (`:479`/`:542` teaches=true). No #284-caused or pre-existing/flaky failure. Verdict 🟢 GREEN. · **next owner → security-agent** (DoD + security gate: RLS-on-top, spoof-proof headers, no existence-disclosure differential, tenant-wide admin-override open Q §6).
- 2026-06-21 15:14 · security-agent · final gate — audited the actual unstaged diff (11 files). **✅ APPROVE, safe to merge.** Tenant isolation NOT weakened (`teachesCourse` + `getCourseEngagement` both inside `withTenant`; admin override only skips the lookup, data read stays RLS-scoped → cross-tenant admin empty `:562`). Headers spoof-proof (gateway strip `proxy.ts:34-35` + re-stamp from verified claims `proxy.ts:87-90`/`auth.ts:95-96`, test `:249`). No existence-disclosure differential (non-existent & not-taught both 403). 401 fail-closed, admin set {super_admin,org_admin}, teaches query roles/status/join/`$n::uuid` casts correct. DoD met (six-file pattern, VITEST-guarded buildApp, no secrets, #284 linked, qa GREEN folded in). **Adjudicated §6:** tenant-wide admin override is ACCEPTABLE to ship (RLS confines to tenant; AC only says "or an admin") — org-scoping deferred to follow-up (a). Non-blocking follow-ups to file: (a) org-unit-scoped admin override; (b) deployment hardening of host-published service ports (pre-existing). Advisory: change still UNSTAGED — commit MUST be Conventional + Refs #284 + NO Co-authored-by trailer. · **next owner → orchestrator** (commit with clean hygiene; file follow-ups a & b via backlog-agent).
- 2026-06-21 15:20 · docs-agent · authored ADR-0027 (gateway/BFF-stamped trusted `x-user-id`/`x-user-roles` identity headers: anti-spoof strip+re-stamp from verified claims, authz layered ON TOP of tenant RLS, 403-not-404, comma-join consistency gateway↔BFF, prod internal-only trust assumption cross-ref'd to DEPLOYMENT.md + deployment-hardening follow-up (b)). Added a hand-authored "Trusted identity headers" bullet to `docs/ARCHITECTURE.md` Cross-cutting linking ADR-0027. Updated the gateway spec via the GENERATOR data (`scripts/docs/gen-service-specs.py` notes) and RE-RAN `python scripts/docs/gen-service-specs.py` (27 specs + index; only `docs/services/gateway.md` changed) — no hand-edit of generated output. Links verified. NOT committed (orchestrator owns commit). · **next owner → orchestrator** (commit with Conventional `docs:` + Refs #284, no Co-authored-by trailer).
