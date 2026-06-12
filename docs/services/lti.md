# lti service

- **Port (dev):** 4018
- **Data shape:** Postgres + Redis
- **Layer:** API (Fastify) -> application -> domain -> infrastructure (Prisma + RLS) -> Postgres

## Responsibility

LTI 1.3 Platform + Tool: OIDC login, AGS, NRPS, Deep Linking, Dynamic Registration.

## Owned tables

`lti_registration`, `lti_deployment`

## Key endpoints

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/lti/login` | OIDC third-party login initiation. |
| `POST` | `/lti/launch` | Validate id_token launch, mint session. |
| `POST` | `/lti/register` | Dynamic Registration of a tool. |
| `GET` | `/lti/nrps/contextmemberships` | Names and Role Provisioning Service. |

## Events published

- `lti.tool.launched`
- `lti.deeplink.created`

## Events consumed

- `grading.graded (AGS score passback)`

## Dependencies

- identity (claims)
- grading (AGS)
- user-org (NRPS roster)
- Upstash Redis (nonce/state)

## Notes

Acts as both Platform (embed external tools) and Tool (be embedded in a school portal/VLE). Key to portal integration.

## Cross-cutting

Writes a transactional **outbox** row (`event_outbox`) in the same DB transaction as each state change; consumes via **inbox** (`event_inbox`) with `idempotency_key` dedupe. All tenant-scoped tables are protected by Postgres RLS keyed on `app.tenant_id`.
