# sis service

- **Port (dev):** 4019
- **Data shape:** Postgres
- **Layer:** API (Fastify) -> application -> domain -> infrastructure (Prisma + RLS) -> Postgres

## Responsibility

OneRoster 1.2 consumer/provider, sourcedId mapping, delta/rostering sync with school SIS.

## Owned tables

`sis_sync`, `sis_id_map`

## Key endpoints

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/sync/runs` | Trigger a rostering sync (full/delta). |
| `GET` | `/oneroster/{resource}` | OneRoster provider endpoints (orgs/users/classes/enrollments). |
| `GET` | `/id-map` | Resolve external sourcedId <-> internal id. |

## Events published

- `sis.user.upserted`
- `sis.org.upserted`
- `sis.class.upserted`
- `sis.enrollment.upserted`

## Events consumed

- `user.updated (provider mode export)`

## Dependencies

- user-org
- course
- enrollment
- external SIS (OneRoster REST/CSV)

## Notes

Bidirectional. Idempotent upserts keyed on sourcedId via sis_id_map; delta sync tracked in sis_sync.

## Cross-cutting

Writes a transactional **outbox** row (`event_outbox`) in the same DB transaction as each state change; consumes via **inbox** (`event_inbox`) with `idempotency_key` dedupe. All tenant-scoped tables are protected by Postgres RLS keyed on `app.tenant_id`.
