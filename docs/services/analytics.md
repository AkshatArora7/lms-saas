# analytics service

- **Port (dev):** 4015
- **Data shape:** Postgres
- **Layer:** API (Fastify) -> application -> domain -> infrastructure (Prisma + RLS) -> Postgres

## Responsibility

Learning Record Store (Caliper/xAPI), engagement metrics, at-risk/predictive read models (event-sourced).

## Owned tables

`caliper_event`, `engagement_summary`, `xapi_statement`

## Key endpoints

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/analytics/events` | Ingest a Caliper event to the LRS (+ transactional outbox row). |
| `POST` | `/analytics/xapi` | Ingest an xAPI statement to the LRS. |
| `GET` | `/analytics/events` | List captured events (filter by type/action/time). |
| `GET` | `/analytics/aggregate` | De-identified aggregate counts (safe to pool cross-tenant). |
| `GET` | `/courses/{id}/engagement` | Engagement summary read model. |
| `GET` | `/courses/{id}/at-risk` | At-risk learner predictions. |

## Events published

- `learning.event_captured`
- `analytics.atrisk.flagged`
- `engagement.summary.updated`

## Events consumed

- `content.viewed`
- `content.completed`
- `quiz.attempt.submitted`
- `discussion.post.created`
- `submission.created`

## Dependencies

- notification (at-risk alerts -> intelligent agents)
- reporting (feeds exports)

## Notes

Event-sourced; builds materialised read models. Pure consumer of domain events; emits derived signals. `GET /reports/engagement` layers defence-in-depth course authorization ON TOP of tenant RLS (#284, refined #294): an instructor who teaches the course, a tenant-wide `super_admin`, or an `org_admin` whose administered org-unit subtree (`org_unit.path` + `role_assignment.cascade`) contains the course's org unit may read it; a missing trusted caller -> 401, an unauthorized caller -> 403. See [ADR-0027](../ADR-0027-trusted-identity-headers.md).

## Cross-cutting

Writes a transactional **outbox** row (`event_outbox`) in the same DB transaction as each state change; consumes via **inbox** (`event_inbox`) with `idempotency_key` dedupe. All tenant-scoped tables are protected by Postgres RLS keyed on `app.tenant_id`.
