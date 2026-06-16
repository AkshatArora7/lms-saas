# user-org service

- **Port (dev):** 4003
- **Data shape:** Postgres (read-heavy)
- **Layer:** API (Fastify) -> application -> domain -> infrastructure (Prisma + RLS) -> Postgres

## Responsibility

User profiles and the org-unit hierarchy (district/school/department/section) per OneRoster orgs/users; academic sessions.

## Owned tables

`app_user`, `org_unit`, `academic_session`

## Key endpoints

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/org-units` | Create org unit under a parent (maintains materialised path; emits orgunit.created). |
| `GET` | `/org-units` | List org units (filter by parentId, type). |
| `GET` | `/org-units/{id}` | Fetch a single org unit. |
| `GET` | `/org-units/{id}/subtree` | Descendants via the path GIN index. |
| `GET` | `/org-units/{id}/ancestors` | Ancestors, root-first. |
| `PATCH` | `/org-units/{id}` | Rename / set active state. |
| `POST` | `/users` | Invite/create a user (emits user.created). |
| `GET` | `/users` | List users (filter by status, orgUnitId). |
| `GET` | `/users/{id}` | Profile + org-unit role memberships. |
| `PATCH` | `/users/{id}` | Update profile/status (emits user.updated/deactivated). |
| `POST` | `/users/{id}/roles` | Assign a per-tenant role at an org unit. |
| `DELETE` | `/users/{id}/roles/{assignmentId}` | Revoke a role assignment. |

## Events published

- `user.created`
- `user.updated`
- `user.deactivated`
- `orgunit.created`

## Events consumed

- `sis.user.upserted`
- `sis.org.upserted`

## Dependencies

- identity (claims)
- sis (rostering source of truth when SIS-driven)

## Notes

Read-heavy; backed by materialised membership views. OneRoster `users`/`orgs` map here.

## Cross-cutting

Writes a transactional **outbox** row (`event_outbox`) in the same DB transaction as each state change; consumes via **inbox** (`event_inbox`) with `idempotency_key` dedupe. All tenant-scoped tables are protected by Postgres RLS keyed on `app.tenant_id`.
