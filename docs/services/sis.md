# sis service

- **Port (dev):** 4019
- **Data shape:** Postgres
- **Layer:** API (Fastify) -> application -> domain -> infrastructure (Prisma + RLS) -> Postgres

## Responsibility

OneRoster 1.2 REST roster sync from a school SIS: idempotent ingestion of orgs/users/classes/enrollments, sourcedId <-> internal-id mapping, and full/incremental-delta sync runs with a conflict/error report.

## Owned tables

`sis_sync`, `sis_id_map`

## Key endpoints

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/sis/sync` | Trigger a OneRoster sync run (full or incremental delta); cron-callable. |
| `GET` | `/sis/sync/{runId}` | Sync run status + conflict/error report. |
| `GET` | `/sis/sync` | List sync runs for the tenant. |
| `GET` | `/sis/id-map` | Resolve external sourcedId <-> internal id (per entity type). |

## Events published

- `sis.user.upserted`
- `sis.org.upserted`
- `sis.class.upserted`
- `sis.enrollment.upserted`

## Events consumed

_None_

## Dependencies

- user-org (app_user/org_unit upserts)
- course (class upserts)
- enrollment (enrollment upserts)
- external SIS (OneRoster 1.2 REST)

## Notes

OneRoster 1.2 REST ingestion of orgs/users/classes/enrollments in dependency order. Upserts are idempotent, keyed on `sourcedId` via `sis_id_map`; the run writes domain rows (`org_unit`/`app_user`/`course`/`enrollment`) under tenant RLS. Incremental delta uses the last-successful-sync watermark on `sis_sync` (delta with no prior success falls back to full); QStash cron triggers `POST /sis/sync` on a schedule. Per-record conflicts/errors are captured in the report on `sis_sync.stats` and never fail the run — only a transport/auth failure marks a run `failed`. The OneRoster client is an injectable port (HTTP adapter in prod), so the sync engine is fully unit-testable.

## Cross-cutting

Writes a transactional **outbox** row (`event_outbox`) in the same DB transaction as each state change; consumes via **inbox** (`event_inbox`) with `idempotency_key` dedupe. All tenant-scoped tables are protected by Postgres RLS keyed on `app.tenant_id`.
