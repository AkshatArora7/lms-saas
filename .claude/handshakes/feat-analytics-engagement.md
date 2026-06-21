# Handshake — feat/analytics-engagement (#277)

> **Single source of truth for one task.** Subagents are stateless; this file
> carries context between them. Every agent **reads this file in full before
> acting** and **updates its own section before handing off**. Facts here must be
> grounded in source (the issue, `AGENTS.md`, the code/schema) — never invented.
> When this file and the code/schema disagree, the **source wins**: fix the code
> claim, then correct this file. Never delete another agent's section.

## 1. Task
- **Issue:** #277 — feat(analytics): engagement + at-risk learner read endpoint for /teach  ·  https://github.com/AkshatArora7/lms-saas/issues/277
- **Type:** feat
- **Branch:** feat/analytics-engagement  (off fresh `main`)
- **Requested by / date:** @AkshatArora7 · 2026-06-21
- **One-line goal:** Issue #277: analytics engagement + at-risk learner read endpoint for /teach

## 2. Acceptance criteria  (verbatim from the issue — do not paraphrase)
- [ ] Analytics service exposes a tenant-scoped endpoint returning per-course engagement score + at-risk learners (id, reason, risk level), computed from real enrollment/activity/grade/attendance data.
- [ ] Endpoint is RLS-enforced via `withTenant`.
- [ ] `/teach` consumes it via a BFF client; NO hardcoded fallback remains.
- [ ] Implemented using the store-abstraction pattern.
- [ ] Unit + integration tests cover the endpoint and the BFF wiring.

## 3. Stage status  (tick only with evidence in the matching section)
| Stage | Owner | Status | Evidence |
| ----- | ----- | ------ | -------- |
| Requirements | backlog-agent | ☑ done | Issue #277 has Context + AC |
| Architecture | architect | ☑ done | §4 Architecture below + ADR-277 |
| UX design | ux-designer | ☐ (optional) | Restoring prior shipped elements; see §4.4 |
| Data & RLS | schema-agent | ☑ n/a | No schema change — compute live (ADR-277) |
| Backend | service-builder | ☑ done | §4 Implementation; analytics typecheck+lint+test green (25/25) |
| Frontend | frontend-dev | ☑ done | §4 Implementation (frontend); web typecheck+lint green |
| QA / tests | qa-agent | ☐ | |
| Security & DoD | security-agent | ☐ | |
| Docs | docs-agent | ☐ | |

- **Data shapes (schema-agent):** N/A — no schema change (see ADR-277).
- **Design (ux-designer):** optional; restore the elements documented in `page.tsx:24-34`.
- **Implementation (service-builder / frontend-dev):** TBD (frontend).

### Implementation (service-builder) — #277 backend

**Endpoint:** `GET /reports/engagement?courseId=<uuid>` (analytics, 4015). Tenant via
`x-tenant-id`/`resolveTenant`; 400 on missing/non-uuid `courseId`; computed LIVE under
`withTenant`/RLS (engagement_summary intentionally unused per ADR-277).

**Response shape implemented (matches contract):**
```jsonc
{
  "engagement": {
    "courseId": "<uuid>",
    "score": <0-100 1dp | null>,        // equal-weighted mean of non-null components
    "learnerCount": <int>,
    "components": {
      "attendanceRate": <0-100 1dp | null>,
      "submissionRate": <0-100 1dp | null>,
      "gradeAverage":  <0-100 1dp | null>
    }
  },
  "atRisk": [
    { "learnerId": "<uuid>", "displayName": null,
      "riskLevel": "high" | "medium",
      "reasons": [ { "code": "low_attendance"|"missing_submissions"|"low_grades",
                     "metric": <number>, "threshold": <number> } ] }
  ]
}
```
Thresholds as named constants in `store.ts`: `LOW_ATTENDANCE_THRESHOLD=80`,
`SUBMISSION_RATE_THRESHOLD=70`, `LOW_GRADE_THRESHOLD=60`, `HIGH_RISK_MIN_REASONS=2`.
At-risk sorted high→medium, then reason-count desc, then learnerId asc.

**Files changed:**
- `services/analytics/src/store.ts` — types (`RiskReason*`/`AtRiskLearner`/
  `EngagementComponents`/`CourseEngagement`/`CourseEngagementResult`/
  `EngagementSourceData`) + named threshold consts + pure `buildCourseEngagement(courseId, data)`
  + `AnalyticsStore.getCourseEngagement`.
- `services/analytics/src/store.memory.ts` — seeded demo engagement source (course
  `d0000000-0003-…001`, 1 learner) + `getCourseEngagement` delegating to the pure builder.
- `services/analytics/src/store.prisma.ts` — five fully-bound sub-queries
  (`ENGAGEMENT_LEARNERS/ASSIGNMENTS/ATTENDANCE/SUBMISSIONS/GRADES_SQL`, `$1::uuid` only)
  inside one `withTenant` tx → same pure builder.
- `services/analytics/src/routes.ts` — `GET /reports/engagement` + `isUuid` validator.
- `services/analytics/src/analytics.test.ts` — +11 tests (8 pure-builder + 4 route incl.
  tenant-isolation + 400s) → 25 tests total, all green.

**Column-name confirmations vs design (all verified in `database/schema.sql`):**
- attendance "present" enum value = `attendance_code.category = 'present'` (schema.sql:933,
  seed.demo.ts:521) — as architect stated. ✓
- released grade column = `grade.is_released` (schema.sql:602). ✓
- submission counted statuses = `('submitted','resubmitted','returned')` (schema.sql:517;
  'draft' excluded). ✓
- learner identification = `enrollment` JOIN `role.name = 'learner'`, status `IN
  ('active','completed')` (role keyed by `(tenant_id,name)`, schema.sql:200; enrollment
  status CHECK schema.sql:364). Course→offering via `course.org_unit_id = enrollment.org_unit_id`. ✓
No design corrections were needed; no schema change.

**Verification:** `pnpm --filter @lms/service-analytics` typecheck ✓ · lint ✓ · test ✓ (25/25).

### Implementation (frontend-dev) — #277 /teach wiring

**BFF client (new):** `apps/web/app/lib/analytics-api.ts` — mirrors `attendance.ts`
(discriminated union, `x-tenant-id`, `cache:"no-store"`, never throws).
- `getCourseEngagement(courseId: string, tenantId?: string): Promise<CourseEngagementResult>`
  where `CourseEngagementResult = { ok: true; report: CourseEngagementReport } | { ok: false; error: string }`.
  Non-200 → `{ ok:false, error }`; network throw → `{ ok:false, error: UNREACHABLE }`.
- Typed payload: `CourseEngagementReport { engagement: CourseEngagement; atRisk: AtRiskLearner[] }`
  matching the service contract exactly (`score:number|null`, `components.{attendanceRate,
  submissionRate,gradeAverage}:number|null`, `riskLevel:"high"|"medium"`, reason codes).
- Display helpers (text-first, colour never the only signal): `RISK_LEVEL_DISPLAY`
  (high→danger "High risk", medium→warning "Medium risk"), `RISK_REASON_DISPLAY`
  (low_attendance→"Low attendance", missing_submissions→"Missing work", low_grades→"Low grades"),
  and `learnerLabel(id)` → `"Learner <uuid-head>"` (NO fabricated names; displayName is
  rendered when non-null, else this id-derived label — pending #278/#279).

**`apps/web/app/teach/page.tsx`:** after `getTaughtCourses`, fan out
`getCourseEngagement` per course in PARALLEL (`Promise.all`, alongside the existing
roster fetch). Restored the three dropped elements:
1. **Engagement score** (`CourseEngagementPanel`): labelled `ProgressBar` (aria-label
   "Engagement score N percent" + visible `N%` text — not colour/value-only) plus the
   three component sub-metrics (Attendance/Submissions/Grade avg). `score === null` →
   "Not enough data yet" (NOT 0%, NOT a fake number). `ok:false` → "Engagement insights
   are unavailable."
2. **At-risk list** (`CourseAtRiskPanel`): per-learner id-derived label, text risk-level
   Badge (high/medium), reason codes as human-readable Chips. Empty `atRisk` → "No at-risk
   learners 🎉"; `ok:false` → "At-risk insights are unavailable."
3. **At-risk count stat**: third summary-band stat = Σ `atRisk.length` over courses whose
   read succeeded (errored/no-data courses contribute 0 — never fabricated), warning-tinted
   only when > 0.

**Responsive/a11y (one pass, all breakpoints):** reused the existing `/teach` token-driven
CSS (`var(--lms-*)`); engagement/components/reasons rows are flex-wrap + `min-width:0`,
risk items `overflow-wrap:anywhere`; no fixed widths → no horizontal overflow at 360px;
reflows 1-up (phone) → grid (tablet/desktop). Risk carried by text pill + label, not colour.

**Compose:** web service was MISSING `ANALYTICS_SERVICE_URL` → added
`ANALYTICS_SERVICE_URL: http://analytics:4015` to the web env + `analytics: { condition:
service_healthy }` to web `depends_on` (admin already had it from #276).

**Verification:** `pnpm --filter @lms/web` typecheck ✓ · lint ✓ (host gate; standalone build
EPERMs on Windows host — Docker/Linux image build is qa-agent's bar). displayName shows
id-derived label pending #278/#279.

### Architecture (architect) — #277 engagement + at-risk read endpoint

**Grounding (file:line)**
- Reference pattern (a tenant-scoped aggregate read): `services/analytics/src/store.ts:280`
  `listOrgUnitRollups` + pure builder `:181 buildOrgUnitRollups`; Prisma
  `store.prisma.ts:122 ROLLUP_SQL` + `:248 listOrgUnitRollups` (withTenant, RLS);
  route `routes.ts:180 GET /reports/org-units`; memory `store.memory.ts:165`.
- `withTenant` sets the `app.tenant_id` GUC inside a tx → RLS enforced (used throughout
  `store.prisma.ts`, e.g. `:162`, `:249`).
- Signal tables, all in the FORCE-RLS list (`database/policies/rls.sql:18-43`,
  `ENABLE`+`FORCE` + `tenant_isolation` policy): `course` (schema.sql:302 — carries both
  `id` and the offering `org_unit_id`), `enrollment` (:357, keyed by `org_unit_id`,
  `role_id`, `status`), `attendance_session` (:939, `org_unit_id`) + `attendance_record`
  (:959, `code`) + `attendance_code` (:929, `category`), `assignment` (:494, `course_id`),
  `submission` (:509, `assignment_id`, `user_id`, `status`, `is_late`), `grade` (:595,
  `points`, `is_released`) + `grade_item` (:579, `course_id`, `max_points`).
- `engagement_summary` table EXISTS (schema.sql:1113, RLS'd) but **NO service/package
  writes to it** (grep `engagement_summary` over `services/`+`packages/` → 0 hits): a
  defined-but-unpopulated CQRS read model → using it yields no honest data.
- Web BFF live-fetch pattern: `apps/web/app/lib/attendance.ts:56` (discriminated union,
  forwards `x-tenant-id`, `cache:"no-store"`); analytics base
  `ANALYTICS_SERVICE_URL ?? http://localhost:4015` (`apps/admin/app/lib/analytics-api.ts:15`).
  Teacher course resolution already live: `apps/web/app/lib/teaching.ts:54`.
- Consumer: `apps/web/app/teach/page.tsx` — its comment (lines 24-34) documents the
  ORIGINAL design (per-card engagement bar + at-risk list + an at-risk-count stat) dropped
  during #269; markup now renders only course count + learners.

**4.1 Endpoint contract — RECOMMENDED: per-course**
`GET /reports/engagement?courseId=<uuid>` (analytics, 4015).
- Chosen over a bulk or combined `/teach-insights` because `/teach` already resolves the
  teacher's courses and fan-out-fetches per course in parallel (it calls `getRoster` per
  course today). Per-course keeps SQL bounded + parameterized (`$1::uuid`, the #267 rule)
  and matches the AC ("per-course engagement score").
- Auth/tenant: `x-tenant-id` via existing `resolveTenant` (`routes.ts:17`). **Teacher
  scoping is a BFF concern** (page only calls for owned courses) — endpoint is tenant-scoped
  only, like `/reports/org-units`. No `userId` param. 400 when `courseId` missing.
- **200 response:**
  ```jsonc
  {
    "engagement": {
      "courseId": "<uuid>",
      "score": 72.5,            // 0-100 1dp; null when NO component has data
      "learnerCount": 24,
      "components": {
        "attendanceRate": 81.0, // null if no attendance
        "submissionRate": 64.0, // null if course has no assignments
        "gradeAverage": 70.2    // null if no released grades
      }
    },
    "atRisk": [
      { "learnerId": "<uuid>",  // app_user.id = enrollment.user_id (LIVE)
        "displayName": null,    // OMITTED until roster names (#278/#279); ids only
        "riskLevel": "high",    // "high" | "medium"
        "reasons": [ { "code": "low_attendance", "metric": 55.0, "threshold": 80 } ] }
    ]
  }
  ```
- **Live:** courseId, learnerCount, all components, atRisk learnerId/riskLevel/reasons.
  **Omitted (honest gap):** displayName (needs user-org — #278/#279 enrich later, DO NOT
  block) and recency/login (engagement_summary.logins_7d/last_access unpopulated → unused).

**4.2 Computation (only over columns that exist)**
Offering = `course.org_unit_id`; course row = `course.id`. Learners = `enrollment` on the
offering with a learner role and `status IN ('active','completed')`.
- attendanceRate = present/total `attendance_record` for the offering's sessions, %1dp;
  `present` via `attendance_code.category='present'` join on `(tenant_id,code)` (exact join
  at `store.prisma.ts:136-139`); null if none.
- submissionRate = actual/expected, expected = `count(assignment)×learnerCount`, actual =
  `count(submission)` `status IN ('submitted','resubmitted','returned')`; null if no assignments.
- gradeAverage = `avg(points/max_points*100)` over released grades (mirrors `ROLLUP_SQL:144-150`); null if none.
- engagement.score = equal-weighted mean of NON-NULL components (each 0-100), 1dp; null if all null.

At-risk = per-learner rules (each evaluated only when its signal exists):
`low_attendance` (<80%), `missing_submissions` (missing% = 100-submission% > 30, only if
course has assignments), `low_grades` (<60%). riskLevel: high if ≥2 trip, medium if 1,
omitted if 0. Thresholds = named constants in `store.ts`. Sort high→medium, then reason count desc, then learnerId.
Data ownership: all reads tenant-scoped via `withTenant`; analytics = read/reporting bounded context; no writes.

**4.3 Store-abstraction plan (six-file shape, mirrors the rollup)**
- `store.ts`: add `CourseEngagement`/`EngagementComponents`/`AtRiskLearner`/`RiskReason`
  types + pure `EngagementSourceData` + pure `buildCourseEngagement(courseId, data)`
  (reuse `round1`/`ratePct`); interface method `getCourseEngagement(ctx, courseId)`.
- `store.memory.ts`: seed demo `EngagementSourceData` for `DEMO_TENANT_ID` (empty default
  otherwise) → feed the pure builder (mirrors `DEMO_ROLLUP_SOURCE:35`).
- `store.prisma.ts`: static **bound** `ENGAGEMENT_SQL` taking `$1::uuid` for courseId
  (#267 cast; NO string interpolation), resolve offering via `course.org_unit_id`, join per
  §4.2, return per-learner rows → SAME pure builder. RLS scopes every subquery.
- `routes.ts`: `app.get<{Querystring:{courseId?:string}}>("/reports/engagement", …)` →
  resolveTenantOr400, require courseId, 200 `{ engagement, atRisk }`.

**4.4 Frontend wiring (`/teach`)**
- New web BFF client `apps/web/app/lib/analytics-api.ts` (web has none yet) mirroring
  `attendance.ts`: `getCourseEngagement(courseId, tenantId)` → discriminated union,
  base `ANALYTICS_SERVICE_URL ?? http://localhost:4015`, forward `x-tenant-id`, `cache:"no-store"`.
- `page.tsx`: after `getTaughtCourses`, fetch engagement per course in parallel; restore the
  three dropped elements — (a) per-card engagement bar (`score`), (b) per-card at-risk list
  (learnerId + risk TEXT pill + reasons; never colour-only), (c) at-risk-count stat in the
  summary band. Graceful empty (NO hardcoded fallback): `ok:false`/`score===null` → "No
  engagement data yet"; empty `atRisk` → "No at-risk learners"; show `learnerId` as label
  until #278 supplies names — do not invent names.

**4.5 Build sequence**
1. schema-agent — **SKIP** (no column/table; engagement_summary intentionally unused).
2. service-builder — store types + pure builder + memory + prisma (`$1::uuid`) + route + unit tests.
3. frontend-dev — `analytics-api.ts` BFF + restore the 3 `/teach` elements + empty states.
4. qa-agent — typecheck/lint/test/build; map tests → ACs.
5. security-agent — RLS/isolation review (uuid cast, FORCE RLS, tenant scoping).

**4.6 Test hooks**
- Unit (memory + pure builder): score (all-null→null; partial; mean), at-risk rules (each
  threshold; high vs medium; omit at 0; sort), route 200 shape + 400 on missing courseId,
  tenant-isolation assertion (mirrors `analytics.test.ts:237`).
- Live-DB RLS integration in `tests/integration` (aligns with sibling #280): seed tenant A's
  course/enrollment/attendance/submission/grade, switch to tenant B, assert empty → proves RLS.

**4.7 Risks / ADR-277**
- **ADR-277 (docs-agent to persist under docs/adr/):** *Compute teach insights live vs.
  materialize `engagement_summary`.* Decision: **compute live now** — no writer exists for
  `engagement_summary`; live read is honest + immediate and reuses the `/reports/org-units`
  pattern. Consequence: heavier per-course query (bounded by courseId; fine at current scale).
  Deferred: a caliper-event projector to populate `engagement_summary` for scale + recency.
- Formula choice (equal-weighted mean, named thresholds) is ADR-worthy; weighted/recency variant deferred with the projector.
- Names (#278): return ids now, enrich later — not a blocker. N+1: parallel fan-out (consistent
  with `getRoster`); add bulk `?courseId=…` variant later if hot. Caliper data sparse → recency NOT used in v1.

## 5. Verification  (real output only — paste, don't summarize away errors)
- **QA (qa-agent):** typecheck / lint / test / build counts; per-AC test mapping; root-cause notes for any failure.
- **Security & DoD (security-agent):** isolation/authz/secrets findings; APPROVE / CHANGES REQUESTED.

## 6. Open questions / blockers
- At-risk learner display names depend on user-org roster resolution (#278/#279).
  Resolved by design: return `learnerId` now, `displayName:null`, enrich later — NOT a blocker.
- UX: restoring previously-shipped elements per `page.tsx:24-34`; a fresh ux-designer pass is optional.

## 7. Handshake log  (append-only; one line per hand-off)
- 2026-06-21 10:08 · orchestrator-setup · branch + handshake created, #277 claimed & board In Progress · **next owner → architect**
- 2026-06-21 10:12 · architect · Recorded design: per-course `GET /reports/engagement?courseId=` (live computation over enrollment/attendance/submission/grade, store-abstraction six-file plan, /teach wiring, build sequence, ADR-277 = compute live not materialize engagement_summary). No schema change. · **next owner → service-builder** (then frontend-dev → qa-agent → security-agent)
- 2026-06-21 10:16 · service-builder · Implemented `GET /reports/engagement?courseId=` in analytics (store types + pure `buildCourseEngagement` + memory seed + prisma five bound `$1::uuid` sub-queries under withTenant + route w/ uuid validation). Confirmed schema columns (category='present', is_released, submission statuses, learner role). +11 tests → 25/25; typecheck+lint+test green. No schema change. · **next owner → frontend-dev** (then qa-agent → security-agent)
- 2026-06-21 10:24 · frontend-dev · Wired `/teach` to live analytics: new web BFF `apps/web/app/lib/analytics-api.ts` (`getCourseEngagement` discriminated union, `x-tenant-id`, no-store) + restored 3 dropped elements in `page.tsx` (engagement ProgressBar w/ aria+text + component sub-metrics, at-risk learner list w/ text risk pills + reason chips, at-risk count stat) with graceful null/empty/error states (no fabricated data). Added missing `ANALYTICS_SERVICE_URL` to web service in docker-compose.yml (+ analytics depends_on). displayName→id-derived label pending #278/#279. web typecheck+lint green. · **next owner → qa-agent** (then security-agent)
