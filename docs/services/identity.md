# identity service

- **Port (dev):** 4001
- **Data shape:** Postgres
- **Layer:** API (Fastify) -> application -> domain -> infrastructure (Prisma + RLS) -> Postgres

## Responsibility

First-party auth and token issuance (local password login, rotating refresh tokens with token-family reuse detection, access-token introspection), plus federation (OIDC/SAML/LTI) and RBAC authorization (roles, permissions, assignments). External CIAM federation is optional/roadmap.

## Owned tables

`app_user (credential join)`, `user_credential`, `refresh_token`, `identity_provider`, `user_identity`, `role`, `permission`, `role_permission`, `role_assignment`

## Key endpoints

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/auth/login` | Verify email+password; issue an access token and a rotating refresh token. |
| `POST` | `/auth/refresh` | Rotate a refresh token; reuse of a revoked token revokes the whole family. |
| `POST` | `/auth/logout` | Revoke the presented token's family (idempotent). |
| `GET` | `/auth/me` | Introspect the bearer access token -> subject, tenant, roles, scopes. |
| `POST` | `/sso/{provider}/callback` | Handle OIDC/SAML federated login -> link user_identity. |
| `GET` | `/authz/check` | Evaluate permission for (subject, action, resource) via role_assignment. |
| `GET` | `/permissions` | List the permission catalog roles can be built from. |
| `POST` | `/roles` | Create a custom role (is_system=false). |
| `GET` | `/roles` | List the tenant's roles (system + custom). |
| `GET` | `/roles/{id}` | Role detail + its permission keys. |
| `PATCH` | `/roles/{id}` | Rename a custom role (system roles are read-only). |
| `DELETE` | `/roles/{id}` | Delete a custom role. |
| `PUT` | `/roles/{id}/permissions` | Replace a role's permission set (catalog-validated). |

## Events published

- `identity.user.authenticated`
- `identity.role.assigned`
- `identity.role.revoked`
- `role.created`
- `role.updated`
- `role.deleted`

## Events consumed

- `user.created (auto-provision identity link)`

## Dependencies

- tenant (provider config)
- External CIAM (WorkOS/Auth0, optional)
- Upstash Redis (sessions)

## Notes

RBAC is tenant-scoped (RLS). LTI 1.3 login handshakes are delegated to the `lti` service which calls back here for claims.

## Cross-cutting

Writes a transactional **outbox** row (`event_outbox`) in the same DB transaction as each state change; consumes via **inbox** (`event_inbox`) with `idempotency_key` dedupe. All tenant-scoped tables are protected by Postgres RLS keyed on `app.tenant_id`.
