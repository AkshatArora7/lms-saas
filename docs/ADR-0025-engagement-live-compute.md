# ADR-0025 — Compute teacher engagement & at-risk live vs. materialize `engagement_summary`

- **Status:** Accepted · 2026-06-21
- **Issue:** #277 — feat(analytics): engagement + at-risk learner read endpoint for `/teach`
- **Owning service:** `services/analytics` (reporting bounded context)
- **Author:** Architect agent (recorded by docs-agent)

## Context

`/teach` needs a per-course **engagement score** and an **at-risk learner list**
(learner id, reason, risk level). These elements were shipped previously but
were dropped during the #269 wiring because no backend endpoint existed to feed
them (the page fell back to placeholder UI — see `apps/web/app/teach/page.tsx`).

A CQRS read-model table `engagement_summary` already exists in the schema
(`database/schema.sql:1113-1126`: `last_access`, `logins_7d`,
`content_views_7d`, `submissions_7d`, `current_grade`, `at_risk`, `risk_score`,
`computed_at`). However, **no service or package writes to it** — the only
references to `engagement_summary` outside the schema are explanatory comments
stating it is intentionally unused (`services/analytics/src/store.ts:256-257`,
`services/analytics/src/routes.ts:196-197`); there is **no projector/writer**
anywhere. Reading from it today would return empty data.

The slice must stay shippable and honest: it has to surface **real** data for a
course on first request, with tenant isolation enforced.

## Decision

1. **Compute engagement + at-risk LIVE** from the existing tenant-scoped domain
   tables (`enrollment`, `attendance_*`, `submission`, `grade`, `assignment`),
   under `withTenant`/RLS, mirroring the merged `GET /reports/org-units` rollup
   pattern (`services/analytics/src/routes.ts:185`). **No schema change.**

2. **New endpoint:** `GET /reports/engagement?courseId=<uuid>` in the analytics
   service (`services/analytics/src/routes.ts:201`). Tenant-scoped only (teacher
   scoping is a BFF concern, consistent with `/reports/org-units`); returns
   `400` on a missing/invalid `courseId`.

3. **Do not use `engagement_summary`.** It has no writer; consuming it would
   return empty results. It is left in place as the documented scale path (see
   Consequences), not wired in.

### Formula (recorded)

- **Engagement score** = equal-weighted mean of the **non-null** components:
  - `attendanceRate` = present / total attendance (present =
    `attendance_code.category = 'present'`, `schema.sql:933`)
  - `submissionRate` = submissions / (assignments × learners)
    (counted submission statuses `submitted`/`resubmitted`/`returned`,
    `schema.sql:517`; `draft` excluded)
  - `gradeAverage` = average **released** grade percentage
    (`grade.is_released`, `schema.sql:602`)
  - If **all** components are null, the score is `null` (no fabricated zero).

- **At-risk rules** (each threshold is a **named constant** in
  `services/analytics/src/store.ts`):
  - `low_attendance` — `attendanceRate < 80` (`LOW_ATTENDANCE_THRESHOLD`,
    `store.ts:267`)
  - `missing_submissions` — `submissionRate < 70`, i.e. >30% missing
    (`SUBMISSION_RATE_THRESHOLD`, `store.ts:272`)
  - `low_grades` — `gradeAverage < 60` (`LOW_GRADE_THRESHOLD`, `store.ts:274`)
  - `riskLevel = high` if **≥2** rules trip (`HIGH_RISK_MIN_REASONS`,
    `store.ts:276`), `medium` if exactly 1, and the learner is **omitted** if 0.

## Consequences

- **Immediate and honest** — real data on the first request, no placeholder /
  fake values and no empty read-model.
- **Reuses the proven RLS-safe rollup pattern** of `/reports/org-units`; all
  sub-queries run inside one `withTenant` transaction over FORCE-RLS tables, so
  cross-tenant requests return empty.
- **Computed per request** — acceptable at current course sizes (queries are
  bounded by `courseId`); there is **no caching and no recency signal**.
- **`displayName` deferred** to #278/#279 — the endpoint returns learner ids
  now; names are enriched later.
- **Live-DB RLS integration test deferred** to #280.
- **Scale path:** a future Caliper-event projector can populate
  `engagement_summary` to add recency and avoid per-request compute; this ADR
  deliberately defers that until there is a writer and a load justification.

## Alternatives considered

- **(A) Materialize / populate `engagement_summary` now** — rejected: requires a
  new event-projection writer (the table has no writer today), is materially
  larger scope, and delivers no immediate value over the live computation.
- **(B) Weighted / recency-aware formula** — deferred: no recency signal is
  currently populated, so weighting would be guesswork. Revisit alongside the
  Caliper-event projector (the scale path above).
