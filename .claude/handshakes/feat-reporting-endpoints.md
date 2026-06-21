# Handshake — feat/reporting-endpoints (Wave 3a of #269)

> Single source of truth for one task. Subagents are stateless; this file carries
> context. Read in full before acting; update your own section before handing off.

## 1. Task
- **Issue:** #269 — Wire learner web + admin screens to live microservices (remove hardcoded demo data) · https://github.com/AkshatArora7/lms-saas/issues/269
- **Type:** feat
- **Branch:** feat/reporting-endpoints (off fresh `main` @ 98701892f76cf537d4161737f78ad74af66ff6cc)
- **Requested by / date:** Wave 3a backend · 2026-06-21
- **One-line goal:** Build the BACKEND read endpoints the last admin screens (/reports, /branding, /settings) need so the frontend wave can drop hardcoded demo data.

## 2. Acceptance criteria  (from the issue, scoped to Wave 3a backend)
- [ ] Admin /reports has a tenant-scoped read endpoint returning real per-school rollups (enrollment count, course count, attendance rate, average grade) for the demo tenant.
- [ ] Admin /branding + /settings have a real tenant read endpoint (or confirm an existing one suffices).
- [ ] Endpoints are tenant-scoped via withTenant + RLS; uuid params cast `$n::uuid` (#267).
- [ ] Unit tests (memory store) + Postgres integration round-trip; typecheck/lint/test/build green.

## 3. Stage status
| Stage | Owner | Status | Evidence |
| ----- | ----- | ------ | -------- |
| Requirements | backlog-agent | ☑ done | #269 |
| Architecture | architect | ☑ done | EXTEND analytics (no new reporting service) — see §4 |
| Data & RLS | schema-agent | ☑ done | no schema change — reads existing tenant-scoped tables under RLS |
| Backend | service-builder | ◐ wip | analytics rollup + verify tenant endpoints (see §4) |
| QA / tests | qa-agent | ☐ | |
| Security & DoD | security-agent | ☐ | |

## 4. Decisions & contracts
- **Architecture decision (/reports):** There is NO `reporting` service (issue text's "reporting 4016" is aspirational). The architect verified analytics only exposed `/analytics/events` + `/analytics/aggregate`. Decision: **EXTEND the analytics service** (port 4015) with a read-only, tenant-scoped rollup endpoint rather than standing up a new bounded context. Rationale: analytics IS the reporting/analytics bounded context (it already owns the cross-entity read model `engagement_summary` referencing `course`/`app_user`), all services share the one Postgres, and RLS keeps the aggregate tenant-safe. The mobile-bff compose-over-HTTP pattern is a per-user BFF with no DB and is the wrong fit for a cross-table district rollup; that approach would require new count endpoints on 4 services. The rollup reads existing tenant-scoped tables (org_unit, course, enrollment, attendance_*, grade, grade_item) directly through `withTenant` so RLS scopes every subquery.
- **New endpoint (analytics):** `GET /reports/org-units` → `{ orgUnits: OrgUnitRollup[], summary: RollupSummary }`. One rollup row per `org_unit` of `type='organization'` ("school"), aggregating across its subtree (matched via the materialised `org_unit.path` array). `OrgUnitRollup = { orgUnitId, name, code, courseCount, enrollmentCount, attendanceRate (0-100 1dp | null), averageGrade (0-100 1dp | null) }`. Attendance rate = records with `attendance_code.category='present'` ÷ total records. Average grade = mean of released `grade.points / grade_item.max_points * 100`.
- **/branding (#2) — NO new code:** tenant service already exposes `GET /tenants/:id/branding` (services/tenant/src/routes.ts:294) returning effective + override branding, backed by the `tenant_branding` table (schema.sql:243). `GET /tenants/:id` (routes.ts:160) returns name/tier/status. Frontend-only wiring.
- **/settings (#3) — NO new code:** `GET /tenants/:id` (routes.ts:160) returns tier (pool/silo)/status/plan; `GET /tenants/:id/settings` (routes.ts:211) returns effective governance settings. Frontend-only wiring.

## 7. Handshake log
- 2026-06-21 · service-builder · investigated 3 screens; only /reports needs backend; extending analytics with /reports/org-units; branding+settings already served by tenant service · next owner → qa-agent
