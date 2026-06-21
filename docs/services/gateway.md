# gateway service

- **Port (dev):** 4000
- **Data shape:** stateless
- **Layer:** API (Fastify) -> application -> domain -> infrastructure (Prisma + RLS) -> Postgres

## Responsibility

Edge authentication, JWT validation, per-tenant rate limiting, request routing and tenant resolution (slug/host -> tenant_id).

## Owned tables

_None_ (stateless or operates on derived/index data only).

## Key endpoints

| Method | Path | Description |
| --- | --- | --- |
| `ANY` | `/* (reverse proxy)` | Validate JWT, resolve tenant, enforce rate limit, forward to the owning service. |
| `GET` | `/health` | Liveness/readiness. |

## Events published

_None_

## Events consumed

_None_

## Dependencies

- identity (JWKS)
- tenant (routing table)
- Upstash Redis (rate-limit buckets)

## Notes

Stateless; horizontally scalable. The single trust boundary: validates the JWT and stamps trusted identity headers downstream from the VERIFIED claims, stripping any client-supplied copies first (anti-spoof) -- `x-tenant-id` (tenant), plus `x-user-id` (= `claims.sub`) and `x-user-roles` (= `claims.roles.join(",")`, comma-separated). Backend services treat these as trusted ONLY because the gateway guarantees them, and layer per-resource authorization ON TOP of tenant RLS (first consumer: analytics `GET /reports/engagement`). The web BFF forwards the same identity headers from its server session when it calls a service directly. See [ADR-0027](../ADR-0027-trusted-identity-headers.md). Also adds trace headers downstream.

## Cross-cutting

Writes a transactional **outbox** row (`event_outbox`) in the same DB transaction as each state change; consumes via **inbox** (`event_inbox`) with `idempotency_key` dedupe. All tenant-scoped tables are protected by Postgres RLS keyed on `app.tenant_id`.
