# Handshake — feat/engagement-admin-orgscope

> **Single source of truth for one task.** Subagents are stateless; this file
> carries context between them. Every agent **reads this file in full before
> acting** and **updates its own section before handing off**. Facts here must be
> grounded in source (the issue, `AGENTS.md`, the code/schema) — never invented.
> When this file and the code/schema disagree, the **source wins**: fix the code
> claim, then correct this file. Never delete another agent's section.

## 1. Task
- **Issue:** #294 — feat(analytics): org-unit-scoped admin override for engagement authz  ·  https://github.com/AkshatArora7/lms-saas/issues/294
- **Type:** feat
- **Branch:** feat/engagement-admin-orgscope  (off fresh `main`)
- **Requested by / date:** AkshatArora7 · 2026-06-21
- **One-line goal:** Scope the `org_admin` override on `GET /reports/engagement` to the course's org-unit subtree (via `role_assignment` + org-unit ancestry), while keeping `super_admin` tenant-wide — tightening the currently tenant-wide admin override from #284.

## 2. Acceptance criteria  (verbatim from the issue — do not paraphrase)
- [ ] `org_admin` can read engagement only for courses whose `org_unit` is within an org unit they administer (ancestry-aware).
- [ ] `super_admin` remains tenant-wide.
- [ ] The teacher-owns-course path and existing 401 / 403 / 200 behavior are unchanged.
- [ ] Unit tests cover: in-subtree admin = 200, out-of-subtree admin = 403, super_admin = 200.
- [ ] RLS unchanged; the new check is layered on top.

## 3. Stage status  (tick only with evidence in the matching section)
| Stage | Owner | Status | Evidence |
| ----- | ----- | ------ | -------- |
| Requirements | backlog-agent | ☐ | |
| Architecture | architect | ☑ | §4 design below — store method `adminScopesCourse` + handler precedence; materialised-path subtree check, NO recursive CTE; service-builder-only (no schema change) |
| UX design | ux-designer | ☐ | |
| Data & RLS | schema-agent | ☐ | |
| Backend | service-builder | ☑ | §5 below — `adminScopesCourse` added (store/prisma/memory), `isCourseReadAuthorized` extended (3rd signal), handler lazy precedence; analytics typecheck+lint+test green, 40/40 tests |
| Frontend | frontend-dev | ☐ | |
| QA / tests | qa-agent | ☑ | §5 QA below — full repo pipeline run; analytics 40/40, all 13 ACs mapped to named tests & verified; tenant-isolation retarget confirmed legit. Only reds are non-#294 host artifacts (apps/admin build EPERM, @lms/ui vitest binary) |
| Security & DoD | security-agent | ☑ | §5 Security below — APPROVE. Isolation intact (adminScopesCourse + getCourseEngagement both under withTenant); strict privilege tightening (org_admin tenant-wide→subtree); cascade reading correct; no bypass; #267 casts present; DoD met. Safe to merge → orchestrator commits. |
| Docs | docs-agent | ☑ | §7 below — generator catalogue updated (analytics `notes` in scripts/docs/gen-service-specs.py) noting `GET /reports/engagement` authz (teacher OR super_admin tenant-wide OR org_admin org-unit subtree via org_unit.path + role_assignment.cascade, x-ref ADR-0027); re-ran `python scripts/docs/gen-service-specs.py` → only docs/services/analytics.md changed (1 line). Hand-authored: ADR-0027 Consequences §1 one-line consumer note. No new ADR. Links resolve. |

## 4. Decisions & contracts  (append; never rewrite history)
- <pending>

### ARCHITECTURE — #294 org-unit-scoped admin override  (architect, 2026-06-21)

**Scope of change:** ONE service, `services/analytics`. Refine *only* the
`org_admin` branch of the `GET /reports/engagement` guard added in #284
(routes.ts:236–263). `super_admin` stays tenant-wide; the teacher path
(`teachesCourse`) and all 401/403/200 behaviour are untouched. RLS unchanged —
the new check is a defence-in-depth layer on top, exactly like #284.

**No new ADR.** This is a refinement under the existing authz model; reference
`docs/ADR-0027-trusted-identity-headers.md` (trusted `x-user-id`/`x-user-roles`,
fail-closed guard). The engagement read itself is ADR-0025 (live compute).

#### Grounding (source of truth — `file:line`)
- `org_unit` (schema.sql:105–122): `id`, `tenant_id`, `parent_id uuid`, and
  **`path uuid[] NOT NULL DEFAULT '{}'`** = "Materialised path of ancestor ids"
  (schema.sql:114). Indexes already exist: `ix_org_unit_path` GIN on `path`
  (schema.sql:122), `ix_org_unit_parent` (schema.sql:121).
- `role_assignment` (schema.sql:215–225): `user_id`, `role_id`,
  `org_unit_id NOT NULL`, **`cascade boolean NOT NULL DEFAULT true`**
  (schema.sql:221) = "optionally cascades to the subtree" (schema.sql:214).
  `UNIQUE (user_id, role_id, org_unit_id)` (schema.sql:223) → its unique index is
  `user_id`-leading, so the `ra.user_id = $n` lookup is already indexed.
- `role` (schema.sql:195–201): `name` text; the values `'super_admin'` /
  `'org_admin'` are the ones already used by `ADMIN_ROLES` (store.ts:519).
- `course` (schema.sql:302–305): `org_unit_id NOT NULL UNIQUE REFERENCES
  org_unit` — the course offering. Same join `teachesCourse` uses
  (store.prisma.ts:209, `c.org_unit_id = e.org_unit_id`).
- Existing subtree idiom to REUSE: `ROLLUP_SQL` already expresses "is this unit in
  the subtree of `s`" as `ou.id = s.id OR s.id = ANY(ou.path)`
  (store.prisma.ts:132).

#### Decision 1 — Subtree test via materialised `path`, NOT a recursive CTE
"An org unit the admin administers" = a `role_assignment` for this `user_id` with
`role.name = 'org_admin'` at some `org_unit_id`. The course is *within that
admin's scope* iff the course's org unit (`course.org_unit_id`, call it `cou`)
is that unit or — when the assignment cascades — a descendant of it. Because
`org_unit.path` already materialises every ancestor id, the descendant test is a
single array membership, so **no recursive CTE is required** (and therefore no
cycle/depth guard to reason about). This reuses the exact pattern already in
`ROLLUP_SQL` and is backed by the existing GIN index on `path`.

Cascade semantics (resolves the only ambiguity):
- `cascade = true`  → admin administers the WHOLE subtree → match when
  `ra.org_unit_id = cou.id` OR `ra.org_unit_id = ANY(cou.path)` (self or ancestor).
- `cascade = false` → admin administers ONLY that exact unit → match ONLY when
  `ra.org_unit_id = cou.id`.

#### Decision 2 — New store method `adminScopesCourse`
Add to `AnalyticsStore` (store.ts), Prisma (store.prisma.ts), Memory
(store.memory.ts). Signature mirrors `teachesCourse` exactly:

```ts
/**
 * Defence-in-depth org-scope signal for GET /reports/engagement (#294): does
 * `userId` hold an `org_admin` role_assignment whose org unit contains the
 * course's org unit — the unit itself, or (when the assignment cascades) any
 * ancestor of it via org_unit.path? RLS-scoped via withTenant. Layered ON TOP
 * of RLS; never a client claim. super_admin does NOT use this (tenant-wide).
 */
adminScopesCourse(
  ctx: TenantContext,
  userId: string,
  courseId: string,
): Promise<boolean>;
```

**Exact Prisma SQL** (RLS-scoped under `withTenant`; both uuid params cast per
the #267 rule — `$1` = courseId, `$2` = userId, same arg order as
`teachesCourse` store.prisma.ts:374–380):

```sql
SELECT 1
  FROM role_assignment ra
  JOIN role     r   ON r.id = ra.role_id
  JOIN course   c   ON c.id = $1::uuid
  JOIN org_unit cou ON cou.id = c.org_unit_id
 WHERE ra.user_id = $2::uuid
   AND r.name = 'org_admin'
   AND (
         ra.org_unit_id = cou.id
      OR (ra.cascade AND ra.org_unit_id = ANY(cou.path))
   )
 LIMIT 1
```

Returns `rows.length > 0`. RLS scopes `role_assignment`, `role`, `course`,
`org_unit` to the caller's tenant (withTenant) — no `tenant_id` predicate needed,
identical to the other analytics queries.

#### Decision 3 — Pure decision + handler precedence
Keep the decision pure and unit-testable (mirrors current
`isCourseReadAuthorized`). Split the admin branch so `super_admin` stays
unconditional and `org_admin` becomes conditional. Extend the pure function:

```ts
export const SUPER_ADMIN_ROLE = "super_admin";
export const ORG_ADMIN_ROLE = "org_admin";
// ADMIN_ROLES stays for backwards reference; no longer the sole gate.

export function isCourseReadAuthorized(input: {
  roles: string[];
  teaches: boolean;
  adminScopesCourse: boolean;   // NEW
}): boolean {
  const isSuperAdmin = input.roles.includes(SUPER_ADMIN_ROLE);
  const isOrgAdmin   = input.roles.includes(ORG_ADMIN_ROLE);
  return (
    isSuperAdmin ||                          // tenant-wide
    (isOrgAdmin && input.adminScopesCourse) || // org-scoped
    input.teaches                            // teacher path (unchanged)
  );
}
```

**Handler (routes.ts:248–259)** — gather only the signals that can change the
outcome, so DB calls are minimised and the teacher path is byte-for-byte
unchanged for non-admins:

```ts
const isSuperAdmin = caller.roles.includes(SUPER_ADMIN_ROLE);
const isOrgAdmin   = caller.roles.includes(ORG_ADMIN_ROLE);

// org-scope query only when an org_admin (and not already allowed as super).
const adminScopesCourse =
  !isSuperAdmin && isOrgAdmin
    ? await deps.store.adminScopesCourse(ctx, caller.userId, id)
    : false;

// teaches query only when the decision isn't already settled.
const teaches =
  isSuperAdmin || adminScopesCourse
    ? false
    : await deps.store.teachesCourse(ctx, caller.userId, id);

if (!isCourseReadAuthorized({ roles: caller.roles, teaches, adminScopesCourse })) {
  return reply.code(403).send({ error: "forbidden",
    message: "You do not have access to this course's engagement." });
}
```

**Precedence / edge cases (explicit):**
- `super_admin` (alone or with any other role) → allowed, **zero store calls** →
  tenant-wide preserved.
- `org_admin` whose scope contains the course → allowed via `adminScopesCourse`;
  `teachesCourse` is skipped.
- `org_admin` whose scope does NOT contain the course **but who teaches it** →
  allowed via the teacher path (OR semantics).
- `org_admin` who neither scopes nor teaches the course → **403** (the new
  tightening vs #284, which allowed any admin tenant-wide).
- plain teacher (no admin roles) → unchanged: `adminScopesCourse=false`, falls to
  `teachesCourse` exactly as today.
- no qualifying role and not teaching → 403 (unchanged). 401 on missing caller
  and 400 on bad courseId are upstream and untouched.

#### Decision 4 — Memory store modelling (so the unit tests are meaningful)
`store.memory.ts` must model org-unit ancestry + `org_admin` assignments so
`adminScopesCourse` mirrors the SQL. Add a tenant-scoped source:

```ts
interface AdminAssignment { userId: string; orgUnitId: string; cascade: boolean }
interface CoursePlacement { ouId: string; path: string[] } // course's org unit + ancestor ids
// tenant → { course placements, org_admin assignments }
private adminScopeSource: Map<string, {
  courseOrgUnit: Map<string, CoursePlacement>;
  assignments: AdminAssignment[];
}>;

async adminScopesCourse(ctx, userId, courseId) {
  const t = this.adminScopeSource.get(ctx.tenantId);
  const cou = t?.courseOrgUnit.get(courseId);
  if (!t || !cou) return false;
  return t.assignments.some(a =>
    a.userId === userId &&
    (a.orgUnitId === cou.ouId || (a.cascade && cou.path.includes(a.orgUnitId)))
  );
}
```

**Seed shape covering all required cases** (ids illustrative — implementer picks
real uuids; tree mirrors the demo seed style):
- Org tree: `DISTRICT(path [])` → `SCHOOL_A(path [DISTRICT])` →
  `DEPT_A1(path [DISTRICT,SCHOOL_A])`; sibling `SCHOOL_B(path [DISTRICT])`.
- `COURSE_IN`  placed at offering under DEPT_A1 →
  `{ ouId: OFF_IN, path: [DISTRICT, SCHOOL_A, DEPT_A1] }`.
- `COURSE_OUT` placed at offering under SCHOOL_B →
  `{ ouId: OFF_OUT, path: [DISTRICT, SCHOOL_B] }`.
- Assignments:
  - `IN_ADMIN`: org_admin @ `SCHOOL_A`, `cascade=true` → scopes COURSE_IN
    (SCHOOL_A ∈ COURSE_IN.path) **=200**; does NOT scope COURSE_OUT
    (SCHOOL_A ∉ COURSE_OUT.path) **=403**.
  - `EXACT_ADMIN`: org_admin @ `OFF_IN`, `cascade=false` → scopes COURSE_IN only
    by exact match (covers the cascade=false branch); a `cascade=false` @
    `SCHOOL_A` would NOT scope COURSE_IN.
  - `BOTH_USER`: org_admin @ `SCHOOL_B` cascade=true (out of COURSE_IN subtree)
    AND seeded into `teachingSource[COURSE_IN]` → allowed for COURSE_IN via the
    teacher path (both-roles precedence test).
- `super_admin` caller: handler short-circuits before any store call → 200 for
  any course (no memory state needed; assert no `adminScopesCourse` invocation if
  the test spies the store).

Required unit tests (acceptance): in-subtree org_admin → 200; out-of-subtree
org_admin → 403; super_admin → 200. Add (recommended): cascade=false exact-only;
org_admin∧teacher both-roles → 200; org_admin who neither scopes nor teaches →
403.

#### Decision 5 — Schema-agent NOT required
Purely a `services/analytics` change. Every column/index needed already exists:
`org_unit.path` + GIN `ix_org_unit_path` (schema.sql:115,122),
`role_assignment.cascade` (schema.sql:221), and the `UNIQUE(user_id,role_id,
org_unit_id)` index covers the `ra.user_id` lookup (schema.sql:223). No DDL, no
RLS change.

#### Build sequence
1. **service-builder** (owns it end-to-end): add `adminScopesCourse` to
   `store.ts` interface + the exact SQL in `store.prisma.ts` + the memory model
   in `store.memory.ts`; extend `isCourseReadAuthorized` (3rd input) and rewire
   the handler precedence in `routes.ts`; add the unit tests above.
2. **qa-agent**: typecheck/lint/test/build; confirm the 3 acceptance tests + the
   recommended edge cases are green and map to the criteria.
3. **security-agent**: authz/tenancy gate — verify super_admin stays tenant-wide,
   org_admin is correctly narrowed, RLS untouched, no client-claim trust, uuid
   params cast (#267), fail-closed preserved.
4. **docs-agent**: regenerate `docs/services/analytics.md` (no hand-edit) to note
   the org-scoped admin override; reference ADR-0027.

## 5. Verification  (real output only — paste, don't summarize away errors)
- <pending>

### SERVICE-BUILDER — #294 implementation (service-builder, 2026-06-21)

**Implemented exactly per §4 architecture.** Analytics-only; gateway untouched;
RLS unchanged (new check layered on top); #267 uuid casts honoured.

**Final pure signature:**
```ts
export function isCourseReadAuthorized(input: {
  roles: string[];
  teaches: boolean;
  adminScopesCourse: boolean;
}): boolean
// allowed iff super_admin ∈ roles  OR  (org_admin ∈ roles AND adminScopesCourse)  OR  teaches
```

**Files changed (why):**
- `services/analytics/src/store.ts` — added `adminScopesCourse` to the
  `AnalyticsStore` interface; replaced the `ADMIN_ROLES`-only helper with
  `SUPER_ADMIN_ROLE`/`ORG_ADMIN_ROLE` constants and the 3-signal
  `isCourseReadAuthorized` (super_admin tenant-wide, org_admin org-scoped,
  teacher OR). `ADMIN_ROLES` kept for backwards reference.
- `services/analytics/src/store.prisma.ts` — added `ADMIN_SCOPES_COURSE_SQL`
  (the exact architect SQL, `$1::uuid`=courseId/`$2::uuid`=userId) and the
  `adminScopesCourse` method (withTenant + `$queryRawUnsafe`, `rows.length > 0`),
  mirroring `teachesCourse`.
- `services/analytics/src/store.memory.ts` — modelled org-unit ancestry
  (DISTRICT→SCHOOL_A→DEPT_A1, sibling SCHOOL_B) + org_admin assignments
  (`AdminScopeData`); added `adminScopesCourse`; seeded the demo tenant to cover
  in-subtree (cascade), exact (cascade=false), ancestor-only (cascade=false, no
  cover), and out-of-subtree-but-teaches. Exported test ids
  (`ORG_ADMIN_IN_SUBTREE` etc., `DEMO_COURSE_OUT`).
- `services/analytics/src/routes.ts` — engagement handler now gathers signals
  lazily: super_admin short-circuits (zero store calls); org_admin →
  `adminScopesCourse`; `teaches` computed only when undecided. 401/403/400 shapes
  unchanged. Swapped `ADMIN_ROLES` import for the role-name constants.
- `services/analytics/src/analytics.test.ts` — refined the pure-helper +
  integration suites to the new signature/seed; added #294 cases
  (in-subtree=200, out-of-subtree=403, super_admin=200, cascade=false exact=200,
  cascade=false ancestor=403, org_admin∧teacher=200). Tenant-isolation case now
  uses a super_admin (still 200-empty, proving RLS isolates a tenant-wide admin)
  — prior assertions preserved, none weakened.

**Verification (from C:\src\LMS):**
- `pnpm --filter @lms/service-analytics typecheck` → exit 0, no errors
- `pnpm --filter @lms/service-analytics lint` → exit 0, no errors
- `pnpm --filter @lms/service-analytics test` → **40/40 passed** (1 file)

**Deviation from design:** none functional. Only adjustment: the existing
tenant-isolation test (#284) previously used an `org_admin` in another tenant
expecting 200-empty; under the #294 tightening an out-of-scope org_admin is now
403, so that test was retargeted to a `super_admin` (tenant-wide) to keep the
same 200-empty RLS-isolation assertion meaningful. Flagged for security-agent.

### QA — #294 full pipeline + AC→test mapping (qa-agent, 2026-06-21)

**Ran the canonical CI pipeline from C:\src\LMS (Windows host; #294 changes are uncommitted working-tree edits to services/analytics only — store.ts, store.prisma.ts, store.memory.ts, routes.ts, analytics.test.ts; zero packages/ui changes).**

| Stage | Command | Exit | Pass/Total | Notes |
| ----- | ------- | ---- | ---------- | ----- |
| SQL (pglast) | parse schema.sql + rls.sql | 0 | 2/2 files OK | unchanged by #294 (no schema change) — GREEN |
| Lint | `pnpm -w run lint` | 0 | 53/53 | GREEN |
| Typecheck | `pnpm -w run typecheck` | 0 | 53/53 | GREEN |
| Test | `pnpm -w run test` | 1 | 43/46 | **@lms/service-analytics 40/40 GREEN**; sole failure = `@lms/ui#test` — host artifact, see below |
| Build | `pnpm -w run build` | 1 | 34/36 | sole failure = `@lms/admin#build` EPERM standalone-symlink (known Windows non-issue); `@lms/web#build` succeeded; all services/packages GREEN |

**`@lms/service-analytics test` → Test Files 1 passed (1), Tests 40 passed (40).**

**Non-#294 reds (root-caused, NOT regressions, no app-code owner):**
1. `@lms/admin#build` — `EPERM: operation not permitted, symlink … .next/standalone …`. Known host-only Next.js `output:"standalone"` symlink limitation on Windows; admin's host gate is typecheck+lint (both green). Expected — not a failure.
2. `@lms/ui#test` — `'vitest' is not recognized as an internal or external command`. Root cause: the vitest binary is not resolvable for that package on THIS host (`packages/ui/node_modules/.bin` does not exist; root `.bin` has no vitest). Purely a host install artifact — packages/ui was not touched by #294, and analytics' own vitest resolves and runs 40/40. In CI (`pnpm install --frozen-lockfile` on Ubuntu) the `.bin` is populated and `vitest run --passWithNoTests` passes. Fix = `pnpm install` host hygiene, not a code change. NOT caused by #294; no specialist fix required.

**Conclusion for #294: fully GREEN.** Every signal within #294's blast radius (pglast, lint, typecheck, analytics tests, all service/package builds) is green; the two reds are environmental host artifacts outside #294's scope.

**AC → test-name mapping (opened & verified the assertions, analytics.test.ts):**

| Acceptance criterion | Test name (status it asserts) | Verdict |
| --- | --- | --- |
| org_admin in subtree (cascade=true) → 200 | `200 for an in-subtree org_admin even when they do not teach the course (#294)` (L606, ADMIN_H=ORG_ADMIN_IN_SUBTREE @ SCHOOL_A cascade=true on DEMO_COURSE → 200) | PASS |
| org_admin NOT in subtree → 403 | `403 for an org_admin OUTSIDE the course's org-unit subtree (#294)` (L616, ADMIN_H on DEMO_COURSE_OUT[path DISTRICT,SCHOOL_B] → 403 forbidden) | PASS |
| super_admin → 200 tenant-wide | `200 for a tenant-wide super_admin who neither teaches nor scopes (#294)` (L626, SUPER_ADMIN_H on DEMO_COURSE_OUT → 200) + pure `allows a super_admin tenant-wide…` (L507) | PASS |
| cascade=false exact unit → 200 | `200 for a cascade=false org_admin on the EXACT course org-unit (#294)` (L636, EXACT_ADMIN @ DEMO_OFF_IN cascade=false on DEMO_COURSE → 200) | PASS |
| cascade=false ancestor-only → 403 | `403 for a cascade=false org_admin on an ANCESTOR unit only (#294)` (L646, ANCESTOR_ADMIN @ SCHOOL_A cascade=false on DEMO_COURSE → 403) | PASS |
| org_admin out-of-subtree BUT teaches → 200 (OR) | `200 for an out-of-subtree org_admin who teaches the course (OR semantics, #294)` (L656, ADMIN_TEACHER @ SCHOOL_B + seeded teacher of DEMO_COURSE → 200) + pure `allows an out-of-scope org_admin who nonetheless teaches…` (L520) | PASS |
| #284 teacher own = 200 | `200 when a teacher requests their own course` (L596, TEACHER_H on DEMO_COURSE → 200) | PASS |
| #284 non-teacher non-admin = 403 | `403 when a teacher requests a course they do not teach` (L585 → 403) + pure `denies an unrelated role` (L525) | PASS |
| #284 missing x-user-id = 401 | `401 when no caller identity (x-user-id) is present` (L575, H lacks x-user-id → 401 unauthorized) | PASS |
| #286 tenant isolation (RETARGET) | `isolates tenants: a super_admin in another tenant sees an empty engagement` (L666) | PASS — see below |

Supporting pure-helper coverage (`isCourseReadAuthorized` #294 signature, L496–529): teacher allow (L497), teacher-deny (L502), super_admin (L507), org_admin scoped/unscoped both branches (L512), org_admin∧teacher OR (L520), unrelated-role deny (L525). 400 bad/missing courseId (L560) and 400 tenant_required (L683) also covered.

**Tenant-isolation retarget — legitimate, not weakened.** L666 sends `OTHER_SUPER_ADMIN_H` (super_admin in tenant `2222…`) requesting tenant `1111…`'s DEMO_COURSE. super_admin passes authz tenant-wide (so authz never masks the read), yet the engagement read is tenant-scoped to `2222…`, which has no data for that course → asserts statusCode 200 AND the full empty body (`score:null, learnerCount:0, components all null, atRisk:[]`). This still proves the #286 runtime tenant-isolation property — that even a tenant-wide admin only ever sees their own tenant's data. The retarget from org_admin→super_admin is necessary and correct: under #294 an out-of-scope org_admin in another tenant now correctly returns 403, which would short-circuit before the read and could no longer demonstrate the RLS-empty property (the 403 would mask it). The assertion is full-shape (not loosened) — a legitimate retarget that preserves, not weakens, the isolation guarantee.

**Verdict: #294 GREEN — 10/10 ACs (incl. retargeted isolation) mapped to named, assertion-verified tests. Handing to security-agent for the authz/tenancy + DoD gate.**

### SECURITY & DoD GATE — #294 (security-agent, 2026-06-21) — **APPROVE**

Audited the uncommitted working-tree diff (store.ts, store.prisma.ts,
store.memory.ts, routes.ts, analytics.test.ts) line-by-line against the §4 design
and the schema. All claims verified in source; nothing taken on trust.

**1) Tenant isolation — NOT weakened (PASS).**
- `adminScopesCourse` runs entirely inside `withTenant(ctx, …)`
  (store.prisma.ts:408) so the `role_assignment`/`role`/`course`/`org_unit` joins
  in `ADMIN_SCOPES_COURSE_SQL` (store.prisma.ts:222–234) are RLS-scoped — no
  `tenant_id` predicate needed, identical idiom to `teachesCourse`. A foreign
  tenant's `course`/`org_unit`/`role_assignment` rows are invisible, so an
  org_admin can never scope a cross-tenant course (course join yields zero rows →
  403).
- `super_admin` short-circuits with ZERO store calls: routes.ts:254–261 — when
  `isSuperAdmin`, `adminScopesCourse=false` (guard `!isSuperAdmin && isOrgAdmin`)
  and `teaches=false` (guard `isSuperAdmin || …`), so neither store method is
  invoked. Yet the DATA read `getCourseEngagement` still runs under `withTenant`
  (store.prisma.ts:355) — tenant-bounded. Tenant-wide ≠ cross-tenant.
- Retargeted isolation test verified (analytics.test.ts:666–681): `OTHER_SUPER_ADMIN_H`
  is super_admin in tenant `OTHER` (L291–295) requesting `TENANT`'s DEMO_COURSE;
  asserts 200 with FULL empty body (`score:null, learnerCount:0`, all components
  null, `atRisk:[]`). Authz passes tenant-wide so it cannot mask the read, and the
  read returns empty because RLS scopes to `OTHER` — this is the strongest possible
  proof that even a tenant-wide admin sees only its own tenant. Assertion full-shape,
  not loosened. Retarget org_admin→super_admin is necessary (an out-of-scope
  org_admin now 403s, which would short-circuit before the read and mask the RLS
  property) and legitimate.

**2) Authz correctness / privilege — STRICT TIGHTENING (PASS).**
- Pure decision (store.ts:558–570): `super_admin || (org_admin && adminScopesCourse)
  || teaches`. vs #284 where any `ADMIN_ROLES` member (incl. org_admin) was
  unconditional tenant-wide. org_admin went tenant-wide → subtree-scoped; nothing
  became more permissive. super_admin and teacher paths byte-for-byte equivalent.
- Exact admin SQL (store.prisma.ts:222–234): role `'org_admin'` (L229); cascade
  semantic `ra.org_unit_id = cou.id OR (ra.cascade AND ra.org_unit_id = ANY(cou.path))`
  (L231–232) = exact-unit OR (cascade ⇒ ancestor-in-path); `$1::uuid`=courseId,
  `$2::uuid`=userId casts present (#267), same arg order as `teachesCourse`. Returns
  `rows.length > 0` (L414).
- Precedence (routes.ts:250–269): super_admin unconditional & zero store calls;
  org_admin conditional on `adminScopesCourse`; teacher via `teachesCourse`;
  both-roles allowed if either signal passes (OR); missing identity → 401
  (`resolveCallerOr401`, L247–248); not-authorized → 403 (L265–268); bad uuid → 400
  (L244–245); missing tenant → 400 (`resolveTenantOr400`, L241–242). 401/403/400
  shapes unchanged from #284.

**3) Cascade-flag reading matches schema intent (PASS).** schema.sql:214 "Role
granted to a user at an org-unit; optionally cascades to the subtree"; `cascade
boolean NOT NULL DEFAULT true` (schema.sql:221); `org_unit.path uuid[]` =
"Materialised path of ancestor ids" (schema.sql:114). Therefore cascade=true ⇒
administers the subtree (self or any descendant whose path contains the unit);
cascade=false ⇒ ONLY the exact unit. The SQL's `ra.cascade AND …ANY(cou.path)`
guard gates the ancestor branch on the flag — NOT inverted. cascade=false ⇒
exact-only is the correct reading. The architect's open question (§6) is hereby
resolved: keep the `ra.cascade AND` guard.

**4) Bypass / edge (PASS).**
- An org_admin assigned at the tenant ROOT (e.g. DISTRICT) with cascade=true
  legitimately scopes every course in the tenant — that is an explicit root
  assignment, intended, and still strictly tenant-bounded by RLS (not cross-tenant).
- No non-(super_admin|org_admin|teacher) can reach 200: a caller with neither admin
  role gets `adminScopesCourse=false` (guard requires `isOrgAdmin`) and falls to
  `teachesCourse`; if not teaching → `isCourseReadAuthorized` false → 403
  (routes.ts:262–268). Confirmed by `403 when a teacher requests a course they do
  not teach` (analytics.test.ts:585) and pure `denies an unrelated role`.
- org_admin with NO matching assignment → store returns `rows.length > 0` = false
  (truthy-on-row, not inverted; store.prisma.ts:414, memory `.some(...)`
  store.memory.ts:313–318) → 403. Verified by `403 for an org_admin OUTSIDE the
  subtree` (L616) and `403 for a cascade=false org_admin on an ANCESTOR unit only`
  (L646). Empty result correctly ⇒ deny.

**5) DoD (PASS).**
- Story #294 linked (§1, issue URL). Commit not yet made — advise Conventional
  prefix `feat(analytics):` + `Closes #294` + **NO `Co-authored-by: Copilot`
  trailer**.
- Six-file store pattern in sync: interface `AnalyticsStore.adminScopesCourse`
  (store.ts:517), Prisma impl (store.prisma.ts:403), Memory impl
  (store.memory.ts:305). Business logic in exported pure `isCourseReadAuthorized`
  (store.ts:558) with unit tests.
- No secrets — only test-fixture uuids and env-driven config; no DSNs/tokens.
- RLS unchanged (no DDL, no rls.sql edit; pglast 2/2 per qa). New check is
  defence-in-depth on top of RLS.
- Checks: folded in qa-agent's run — pglast 2/2, lint 53/53, typecheck 53/53,
  analytics test 40/40; the only reds (apps/admin EPERM standalone-symlink,
  @lms/ui vitest host .bin) are host artifacts outside #294's blast radius, not
  regressions.

**VERDICT: APPROVE — safe to merge.** No blocking findings. Committer:
**orchestrator** (Conventional commit + `Closes #294`, no Copilot trailer).

Non-blocking follow-ups to file (do NOT block this merge):
- (low) Role-name canonicalisation: authz matches `role.name = 'org_admin'`
  literally; if tenants can rename system roles this could drift. Pre-existing
  (#284 `ADMIN_ROLES` already relies on these literals) — no new risk. File a
  hardening ticket to match by a stable role key/system flag.
- (info) docs-agent to regenerate `docs/services/analytics.md` (generated, no
  hand-edit) noting the org-scoped admin override; reference ADR-0027.

## 6. Open questions / blockers
- **Cascade semantic (RESOLVED, but confirm in test data):** schema comment
  "optionally cascades to the subtree" (schema.sql:214,221) is taken as: the
  `org_admin` administers the subtree iff `cascade = true`; if `false`, only the
  exact `org_unit_id`. Design honours this. If product intends org_admin
  assignments to *always* cascade regardless of the flag, drop the
  `ra.cascade AND` guard — flag for security-agent to confirm.
- **Role-name canonicalisation:** design assumes `role.name = 'org_admin'` /
  `'super_admin'` (consistent with `ADMIN_ROLES`, store.ts:519). If a tenant can
  rename system roles, matching by `role.name` could drift; current code already
  relies on these literals, so no new risk introduced here.
- **Multiple org_admin assignments per user:** the `EXISTS`/`LIMIT 1` query is
  correct for any number of assignments (allowed if ANY scopes the course).

## 7. Handshake log  (append-only; one line per hand-off)
- <pending>
- 2026-06-21 · architect → service-builder: design recorded (§4). Add
  `adminScopesCourse` (store/prisma/memory, materialised-path subtree SQL, no
  recursive CTE), extend `isCourseReadAuthorized` + handler precedence; no schema
  change. Then qa-agent → security-agent → docs-agent.
- 2026-06-21 · service-builder → qa-agent: implemented §4 in analytics
  (store/prisma/memory + 3-signal `isCourseReadAuthorized` + lazy handler
  precedence). Analytics typecheck+lint+test green (40/40). One existing #284
  tenant-isolation test retargeted org_admin→super_admin (see §5 deviation).
  Please run full per-service + repo-wide suite and map tests to AC; then
  security-agent for the isolation/DoD gate.
- 2026-06-21 · qa-agent → security-agent: full pipeline run. pglast 2/2, lint
  53/53, typecheck 53/53, analytics test 40/40, builds green except known host
  artifacts (apps/admin EPERM standalone-symlink; @lms/ui vitest binary not
  resolvable on this host) — both outside #294's blast radius, NOT regressions.
  All 10 ACs (incl. retargeted tenant-isolation) mapped to named, assertion-
  verified tests = PASS. Tenant-isolation retarget org_admin→super_admin confirmed
  legitimate (still asserts full empty-body RLS isolation, not weakened). #294
  GREEN. Over to security-agent for the authz/tenancy + DoD gate.
- 2026-06-21 · security-agent → orchestrator: **APPROVE — safe to merge.** Audited
  the working-tree diff line-by-line. Isolation intact (adminScopesCourse +
  getCourseEngagement both under withTenant; foreign-tenant course join → 403;
  retargeted super_admin isolation test asserts full empty body). Strict privilege
  tightening (org_admin tenant-wide→subtree; nothing more permissive). Cascade
  reading correct (cascade=false ⇒ exact-only, not inverted) — resolves §6 open
  question. No bypass (non-admin/non-teacher → 403; empty-result ⇒ deny). #267 uuid
  casts present; RLS unchanged; no secrets; six-file store pattern in sync. DoD met
  with qa's green suite. Committer = orchestrator (Conventional `feat(analytics):` +
  `Closes #294`, NO Co-authored-by trailer). Non-blocking follow-ups: role-name
  canonicalisation hardening ticket; docs-agent regen analytics spec.
- 2026-06-21 · docs-agent → done: documented #294 engagement authz refinement.
  Edited the GENERATOR (scripts/docs/gen-service-specs.py, analytics `notes`) so
  `GET /reports/engagement` records its authz (teacher-owns-course OR tenant-wide
  super_admin OR org_admin whose org-unit subtree — org_unit.path +
  role_assignment.cascade — contains the course; 401 missing caller / 403
  unauthorized; x-ref ADR-0027). Re-ran `python scripts/docs/gen-service-specs.py`
  → "Wrote 27 specs + index"; git shows only docs/services/analytics.md changed
  (1 insertion/1 deletion) — no other generated spec touched. Hand-authored:
  added a one-line analytics consumer note to ADR-0027 Consequences §1. No new ADR
  (refinement only). Verified the `../ADR-0027-trusted-identity-headers.md` link
  from the regenerated spec resolves. NOT committed.
