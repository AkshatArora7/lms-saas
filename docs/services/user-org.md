# user-org service

- **Port (dev):** 4003
- **Data shape:** Postgres (read-heavy)
- **Layer:** API (Fastify) -> application -> domain -> infrastructure (Prisma + RLS) -> Postgres

## Responsibility

User profiles and the org-unit hierarchy (district/school/department/section) per OneRoster orgs/users; academic sessions; COPPA/age-appropriate parental consent for minors; guardian/parent relationships with consent-gated read-only access to a child's scoped data.

## Owned tables

`app_user`, `org_unit`, `academic_session`, `parental_consent`, `guardian_relationship`

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
| `GET` | `/users` | List users (filter by status, orgUnitId); each item is the enriched UserProfile with `memberships: [{assignmentId, roleId, roleName, orgUnitId, cascade}]`, the same shape as GET /users/{id}. |
| `GET` | `/users/{id}` | Profile + org-unit role memberships. |
| `PATCH` | `/users/{id}` | Update profile/status (emits user.updated/deactivated). |
| `POST` | `/users/{id}/roles` | Assign a per-tenant role at an org unit. |
| `DELETE` | `/users/{id}/roles/{assignmentId}` | Revoke a role assignment. |
| `POST` | `/compliance/consents` | Capture/upsert parental consent for a (subject, category). |
| `POST` | `/compliance/consents/{id}/revoke` | Revoke a consent. |
| `GET` | `/compliance/subjects/{userId}/consents` | A subject's consent ledger. |
| `GET` | `/compliance/subjects/{userId}/data-policy` | Age-gated data-collection decision for a category. |
| `POST` | `/guardians` | Link a guardian to a student (starts status='pending'; emits guardian.linked). |
| `GET` | `/students/{studentId}/guardians` | List a student's guardians (all statuses). |
| `GET` | `/students/{studentId}/guardians/authorized` | A student's ACTIVE + consent-satisfied guardians only -> {guardians:[{guardianUserId, relationship}]} (the student->guardians inverse of /guardians/authorize). Consent is re-derived live; deny-by-default -> [] when the gating consent is unsatisfied. Backs the attendance notification fan-out (#101). |
| `GET` | `/guardians/{guardianId}/students` | List a guardian's students (all statuses, not consent-filtered). |
| `GET` | `/guardians/{guardianId}/children/authorized` | List a guardian's *authorized* children: active links whose gating consent (directory_information) is currently satisfied. Excludes pending/revoked links and non-consented minors; consent is re-derived live per request. Returns `{children:[{studentUserId, relationship}]}`. The consent-filtered read other services (e.g. attendance's guardian-scoped view) depend on. |
| `POST` | `/guardians/{id}/activate` | Activate a pending link after re-checking the student's consent gate (emits guardian.linked). |
| `POST` | `/guardians/{id}/revoke` | Soft-revoke a guardian link (emits guardian.revoked). |
| `GET` | `/guardians/authorize` | Read-only predicate: is this guardian an active, consent-satisfied guardian of this student? Consent is re-derived live. |

## Events published

- `user.created`
- `user.updated`
- `user.deactivated`
- `orgunit.created`
- `guardian.linked`
- `guardian.revoked`

## Events consumed

- `sis.user.upserted`
- `sis.org.upserted`

## Dependencies

- identity (claims)
- sis (rostering source of truth when SIS-driven)

## Notes

Read-heavy; backed by materialised membership views. OneRoster `users`/`orgs` map here. COPPA: age stored as a coarse band (not DOB); under-13 data handling is gated on verifiable parental consent (see docs/compliance/coppa-data-flows.md). Guardian links are read-only and consent-gated: `/guardians/authorize` re-derives the consent decision live, so a consent revoke denies access immediately (no separate guardian write path). The student->guardians read direction is served by `GET /students/:studentId/guardians/authorized` (#101): it filters `/students/:studentId/guardians` to `status='active'` then applies the SAME live consent gate (`GUARDIAN_CONSENT_CATEGORY = 'directory_information'`) once per student — deny-by-default returns `[]` when consent is unsatisfied, so a later consent/relationship revoke drops a guardian from the result immediately. The attendance service consumes this endpoint (over the gateway, forwarding `x-tenant-id`) to fan absence/tardy notifications out to a student's consented guardians; consent is never re-derived outside this service. The guardian->children direction is served by `GET /guardians/:guardianId/children/authorized` (#190), the consent-filtered, batch authorized-children read other services depend on (e.g. the attendance guardian-scoped view): it filters links to status='active' then re-derives each child's gating consent (directory_information) live, returning only the children currently permitted — unlike `/guardians/:guardianId/students`, which returns all statuses and is NOT consent-filtered.

## Cross-cutting

Writes a transactional **outbox** row (`event_outbox`) in the same DB transaction as each state change; consumes via **inbox** (`event_inbox`) with `idempotency_key` dedupe. All tenant-scoped tables are protected by Postgres RLS keyed on `app.tenant_id`.
