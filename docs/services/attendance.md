# attendance service

- **Port (dev):** 4025
- **Data shape:** Postgres
- **Layer:** API (Fastify) -> application -> domain -> infrastructure (Prisma + RLS) -> Postgres

## Responsibility

Class attendance and participation: per-tenant attendance codes, attendance sessions (one per section meeting), per-student records, and summaries/exports for compliance and SIS.

## Owned tables

`attendance_code`, `attendance_session`, `attendance_record`

## Key endpoints

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/codes` | Define/seed per-tenant attendance codes and categories. |
| `POST` | `/sessions` | Open an attendance session for a section meeting (roster from enrollment/timetable). |
| `PUT` | `/sessions/{id}/records` | Mark each student present/absent/tardy/excused; edit until finalized. |
| `POST` | `/sessions/{id}/finalize` | Finalize a session (locks records); emits attendance.flagged per absent/tardy. |
| `GET` | `/sections/{id}/attendance/summary` | Attendance rates and chronic-absence flags. |
| `GET` | `/users/{id}/attendance` | A student's attendance history. |
| `GET` | `/guardian/children` | Guardian-scoped: list the authenticated guardian's authorized children (ids + relationship). The guardian is the trusted `x-user-id` caller (never a client-supplied param); 401 if absent. An empty set is a valid 200 `{children:[]}`. |
| `GET` | `/guardian/children/{studentId}/attendance` | Guardian-scoped: that child's attendance history, only if the child is in the caller's authorized set; otherwise 404 `not_found` (deny-by-default — cross-family / non-linked / revoked / non-consented are indistinguishable and no history read is attempted). 401 when `x-user-id` is absent; 400 on a non-uuid studentId. |

## Events published

- `attendance.marked`
- `attendance.session.finalized`
- `attendance.flagged`

## Events consumed

- `enrollment.created`
- `timetable.entry.scheduled`

## Dependencies

- enrollment (roster)
- calendar (timetable)
- notification (absence alerts)
- reporting (exports)
- user-org (guardian->child relationship + consent gate, via the injectable GuardianChildrenResolver port)

## Notes

Attendance codes are tenant-owned (per-tenant policy); records are RLS-isolated. Marking emits events for notifications and analytics. Guardian-scoped read surface (#190): the `/guardian/children*` endpoints let a guardian read attendance ONLY for their linked, active, consent-permitted children. Attendance remains the single reader of its own `attendance_record` data, but the guardian->child relationship + consent gate are authoritative in user-org, so attendance consumes them through an injectable `GuardianChildrenResolver` port (prod = HTTP to user-org's `GET /guardians/:guardianId/children/authorized` forwarding `x-tenant-id`; tests = in-memory fake). The port returns ONLY active + consented children; attendance does NOT re-derive consent and treats "not in the resolved set" as deny. Identity is server-authoritative: the guardian is the trusted `x-user-id` caller (ADR-0027), never a client-supplied param, so there is no route shape to name "which guardian I am" (fail-closed 401 if absent). A non-authorized studentId yields 404 (not 403) so a guardian cannot probe another family's students, and no `userHistory` read is attempted for it. Tenant isolation is double-scoped: the port call forwards the tenant and the attendance read runs under `withTenant` RLS. The HTTP resolver fails closed (empty set on any non-2xx/unreachable upstream).

## Cross-cutting

Writes a transactional **outbox** row (`event_outbox`) in the same DB transaction as each state change; consumes via **inbox** (`event_inbox`) with `idempotency_key` dedupe. All tenant-scoped tables are protected by Postgres RLS keyed on `app.tenant_id`.
