# identity service

- **Port (dev):** 4001
- **Data shape:** Postgres
- **Layer:** API (Fastify) -> application -> domain -> infrastructure (Prisma + RLS) -> Postgres

## Responsibility

Auth orchestration and federation (OIDC/SAML/LTI), session/claims issuance, RBAC authorization (roles, permissions, assignments). Delegates credential storage to external CIAM.

## Owned tables

`identity_provider`, `user_identity`, `role`, `permission`, `role_permission`, `role_assignment`

## Key endpoints

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/oauth/token` | Exchange auth-code/PKCE or client-credentials for tokens. |
| `GET` | `/.well-known/jwks.json` | Publish signing keys for gateway/services. |
| `POST` | `/sso/{provider}/callback` | Handle OIDC/SAML federated login -> link user_identity. |
| `GET` | `/authz/check` | Evaluate permission for (subject, action, resource) via role_assignment. |

## Events published

- `identity.user.authenticated`
- `identity.role.assigned`
- `identity.role.revoked`

## Events consumed

- `user.created (auto-provision identity link)`

## Dependencies

- External CIAM (WorkOS/Auth0)
- tenant (provider config)
- Upstash Redis (sessions)

## Notes

RBAC is tenant-scoped (RLS). LTI 1.3 login handshakes are delegated to the `lti` service which calls back here for claims.

## Cross-cutting

Writes a transactional **outbox** row (`event_outbox`) in the same DB transaction as each state change; consumes via **inbox** (`event_inbox`) with `idempotency_key` dedupe. All tenant-scoped tables are protected by Postgres RLS keyed on `app.tenant_id`.
