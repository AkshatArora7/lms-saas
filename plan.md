
## Course domain service (local commit d639906, NOT pushed; branch ahead 2) - epic #25 / story #26
- Turned the course scaffold into a real RLS-scoped domain service behind the gateway, mirroring identity's store-abstraction pattern.
- store.ts (CourseStore boundary) + store.prisma.ts (withTenant; createCourse inserts a 'course_offering' org_unit then the course row) + store.memory.ts (demo seed, COURSE_STORE=memory dev mode, tenant-filtered).
- routes.ts: GET/POST /courses, GET /courses/:id, POST /courses/:id/publish; input validation + tenant-required 400. main.ts: buildApp({config,store,resolveTenant}) with x-tenant-id resolver.
- 10 new tests. Verified repo-wide: typecheck 41/41, lint 41/41, test 32/32, build 35/35. No co-author trailer; awaiting go-ahead to push.
- Next options: per-tenant rate limiting at the gateway, or wire course behind the gateway proxy with a real SERVICE_URL_COURSE.

## Scheduling (calendar service) - local commit 8ea1946, NOT pushed; branch ahead 3 - epic #57 / stories #94,#95,#96
- Built the calendar service's timetable/class-scheduling surface (it owns bell_schedule, schedule_period, timetable_entry per docs/services/calendar.md), mirroring the course service pattern.
- store.ts (SchedulingStore + CreateTimetableResult conflict discriminated union) + store.prisma.ts (withTenant; conflict checks via day_of_week IS NOT DISTINCT FROM) + store.memory.ts (identical conflict logic, demo seed, CALENDAR_STORE=memory).
- routes.ts: POST/GET /schedules, GET /schedules/:id, POST /timetable (409 on slot/room/instructor conflict), GET /users/:id/timetable, GET /org-units/:id/timetable.
- 13 tests. Verified repo-wide: typecheck 41/41, lint 41/41, test 32/32, build 35/35. No co-author; awaiting push approval.
- Domain services now real: identity (SSO), gateway, course, calendar(scheduling). Next candidates: attendance service, enrollment, or wire services behind gateway proxy (SERVICE_URL_*).

## PRs auto-completed + attendance service (MERGED to main)
- PR #106 squash-merged to main: branding(#105), OIDC SSO(#11), Vercel deploy, gateway(#6), course(#26), calendar scheduling(#94,#95,#96).
- Built attendance service (codes/sessions/records/finalize/summaries) on feat/attendance-service -> PR #107 squash-merged to main. Stories #98,#99,#100 (epic #97); #101 covered by GET /users/:id/attendance.
- Closed all shipped issues manually (#6,#26,#94,#95,#96,#99,#100,#105) since GitHub only auto-closes the first issue after each 'Closes' keyword. #11,#98 auto-closed.
- main verified green: typecheck 41/41, lint 41/41, test 32/32, build 35/35. No open PRs. Merged feature branches deleted locally.
- Real domain services now on main: identity(SSO+password), gateway(auth/tenant/proxy), course, calendar(scheduling), attendance. Next: enrollment/grading services, or wire services behind the gateway proxy with real SERVICE_URL_*.

## Enrollment service (MERGED to main - PR #108, story #34)
- Built enrollment service (enroll with per-tenant role, drop/complete lifecycle, active section roster, per-user listing) on feat/enrollment-service -> PR #108 squash-merged. Issue #34 auto-closed.
- Prisma store resolves role name -> role_id via per-tenant role table; ON CONFLICT(user_id,org_unit_id) enforces one-enrollment-per-section. Provides the roster the attendance service consumes.
- 10 tests. main green: typecheck 41/41, lint 41/41, test 32/32, build 35/35. No open PRs. Branch deleted.
- Domain services on main: identity(SSO+password), gateway(auth/tenant/proxy), course, calendar(scheduling), attendance, enrollment.
- Next: grading service, or wire services behind the gateway proxy with real SERVICE_URL_* for a full end-to-end demo.
