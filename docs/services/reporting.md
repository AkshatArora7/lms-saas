# reporting service

- **Port (dev):** 4016
- **Data shape:** read replicas
- **Layer:** API (Fastify) -> application -> domain -> infrastructure (Prisma + RLS) -> Postgres

## Responsibility

Scheduled and ad-hoc exports (CSV/PDF/OneRoster bulk), compliance and accreditation reports.

## Owned tables

_None_ (stateless or operates on derived/index data only).

## Key endpoints

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/reports` | Request a report (async job). |
| `GET` | `/reports/{id}` | Job status + download link (Blob). |
| `GET` | `/oneroster/bulk` | OneRoster bulk CSV export. |

## Events published

- `report.completed`

## Events consumed

- `report.requested`

## Dependencies

- Neon read replica
- Vercel Blob (output)
- all domains (read-only)

## Notes

Reads from replicas to avoid load on write paths; outputs to Blob with signed URLs.

## Cross-cutting

Writes a transactional **outbox** row (`event_outbox`) in the same DB transaction as each state change; consumes via **inbox** (`event_inbox`) with `idempotency_key` dedupe. All tenant-scoped tables are protected by Postgres RLS keyed on `app.tenant_id`.
