# ADR-0031 — Course/enrollment-scoped video streaming: `video_asset.course_id` + an injectable `CourseAccessPolicy` read gate

- **Status:** Accepted · 2026-06-22
- **Issue:** #319 — feat(video): course/enrollment-scoped streaming access control (follow-up of #67)
- **Owning scope:** `services/video` (bounded context) + `database/schema.sql` (column only)
- **Author:** Architect agent

## Context

The `video` service (#67, ADR-0029) treats **reads as tenant-member**: `GET
/videos` and `GET /videos/:id` resolve a `TenantContext` and return any row RLS
lets through (`services/video/src/routes.ts:206-219`). Playback is **URL-based** —
`toResponse` returns the stored `sourceBlobUrl` / `renditions` / `captions` URLs
served from Blob/CDN, never proxied (`services/video/src/routes.ts:109-122`,
`main.ts:1-9`). `blob.ts` only signs **upload** URLs (`services/video/src/blob.ts:32-34`);
there is no separate signed-playback endpoint. **Therefore `GET /videos/:id` (and
the list) is the playback authorization surface** — gating those endpoints gates
streaming.

#319 wants a tighter boundary for **course-associated** videos: only an enrolled
student, a teacher/TA of that course, or an admin may stream them. RLS stays
tenant-scoped; this is an **app-level authz filter layered on top of RLS**, exactly
the model analytics already uses for `GET /reports/engagement`
(`services/analytics/src/store.prisma.ts:402-432`, `routes.ts:253-269`).

### Grounded facts (course / enrollment / teaching model)

- `course(id PK, tenant_id, org_unit_id uuid NOT NULL UNIQUE -> org_unit, ...)`
  (`database/schema.sql:302-314`). The course identity used everywhere is
  **`course.id`** (it is `$1` in the analytics teaching check).
- `enrollment(user_id, org_unit_id -> org_unit, role_id -> role, status CHECK IN
  ('active','inactive','completed','withdrawn'), UNIQUE(user_id, org_unit_id))`
  (`database/schema.sql:395-405`). **A learner/teacher enrolls against an
  `org_unit_id`, not against `course.id`.**
- Analytics resolves "who is on this course" by joining
  **`enrollment e JOIN course c ON c.org_unit_id = e.org_unit_id`** and filtering
  `c.id = $1`, `e.user_id = $2`, teaching `role.name`s,
  `e.status IN ('active','completed')` (`services/analytics/src/store.prisma.ts:218-227`).
  This is the **canonical join** that bridges `course.id` → `course.org_unit_id` →
  `enrollment.org_unit_id`.
- Admin org-scope is via `role_assignment` cascade over `org_unit.path`
  (`store.prisma.ts:236-248`). The video service already treats `super_admin` +
  `org_admin` (`ADMIN_ROLES`) as tenant-wide admins for its write routes via a
  header-role `isAdmin` check (`services/video/src/routes.ts:105-107,231,250`).
- `video_asset` has **no `course_id`** today (`database/schema.sql:1098-1112`) and
  sits in the generic `tenant_tables` loop that creates the single
  `tenant_isolation` policy (`database/policies/rls.sql:32`).
- `withTenant` scopes every video query (`services/video/src/store.prisma.ts:70-148`);
  `uuid` params are cast `$n::uuid` (#267).

## Decision

### A) Read-authz reads enrollment/course **directly** under the video RLS connection (no HTTP)

The read check runs the enrollment/course join **in-process inside the video
service's existing `withTenant` RLS connection** — it does **not** call the
enrollment service over HTTP.

- **Why:** it mirrors the analytics precedent exactly (`store.prisma.ts:402-432`),
  is **offline-tractable** (no network in CI), and adds **no new runtime
  dependency / failure mode** to the request path. RLS already scopes `enrollment`,
  `course`, `role`, `role_assignment` to the caller's tenant, so reading them under
  `withTenant` is safe and tenant-correct.
- **Rejected — HTTP call to the enrollment service:** introduces a synchronous
  cross-service dependency on the read path (latency, partial-failure handling) and
  **breaks key-free offline tests**, for no isolation benefit (the tables are already
  RLS-scoped locally). Rejected.

### B) The injectable seam — `CourseAccessPolicy`

A new seam file `services/video/src/access.ts`, mirroring the
`Transcoder`/`Captioner`/`BlobSigner` seam style (production default + deterministic
Fake), injected through `BuildAppOptions`/`VideoRouteDeps` like the other seams
(`services/video/src/main.ts:40-51,104-136`).

```ts
// services/video/src/access.ts
export interface Principal { userId: string; roles: string[]; }

export interface CourseAccessPolicy {
  /** May this principal read a video associated with `courseId`, within `ctx`'s tenant? */
  canRead(ctx: TenantContext, courseId: string, principal: Principal): Promise<boolean>;
  /** The subset of `courseIds` the principal may read (batch helper for list filtering). */
  visibleCourseIds(ctx: TenantContext, courseIds: string[], principal: Principal): Promise<Set<string>>;
}
```

- **Production default — `DbCourseAccessPolicy`** (under `withTenant`):
  1. if `principal.roles` intersects `ADMIN_ROLES` (`super_admin`/`org_admin`) → `true`
     (no DB hit; consistent with the service's existing `isAdmin`,
     `routes.ts:105-107`);
  2. else run the enrollment EXISTS query (predicate in **C**) → `rows.length > 0`.
- **Offline Fake — `FakeCourseAccessPolicy`**: seeded
  `tenant → courseId → Set<userId>` map plus the same `ADMIN_ROLES` short-circuit —
  mirrors analytics' in-memory `teachingSource`
  (`services/analytics/src/store.memory.ts:199-303`). Lets tests assert
  enrolled-OK / non-enrolled-denied / teacher-OK / admin-OK / null-course-unaffected
  with **no DB and no network**.

Wired in `main.ts`: `options.courseAccessPolicy ?? new DbCourseAccessPolicy()`,
threaded into `registerVideoRoutes` as `deps.courseAccessPolicy`.

### C) Exact `course_id` referent + the read predicate

**`video_asset.course_id` references `course.id`** (the course PK), nullable:

```sql
ALTER TABLE video_asset
  ADD COLUMN course_id uuid REFERENCES course(id) ON DELETE SET NULL;  -- nullable
CREATE INDEX IF NOT EXISTS ix_video_course ON video_asset(course_id);
```

`course.id` is the **only** correct referent: the access decision must reach
`enrollment` via the **same** `course.org_unit_id = enrollment.org_unit_id` bridge
analytics uses. Storing `course_id` as `course.id` and reusing that exact join means
video and analytics resolve course membership **identically**, which is precisely
what avoids the #323-style granularity mismatch — we do **not** point `course_id` at
a section/offering `org_unit` id and re-derive the join (that is what diverges).

**The predicate the service evaluates** (a video with `course_id = $1`, principal
`{userId:$2, roles}`):

```
allow  ⇔  roles ∩ {super_admin, org_admin} ≠ ∅                      -- (iii) admin, by role
     OR  EXISTS (                                                    -- (i)+(ii) enrolled OR teaches/TA
            SELECT 1
              FROM enrollment e
              JOIN course c ON c.org_unit_id = e.org_unit_id
             WHERE c.id = $1::uuid
               AND e.user_id = $2::uuid
               AND e.status IN ('active','completed')
             LIMIT 1
          )
```

One enrollment EXISTS covers **both** student (i) and teacher/TA (ii): teachers/TAs
hold `enrollment` rows on the course's org unit (the exact assumption analytics'
`teachesCourse` makes, `store.prisma.ts:218-227`); a role-agnostic enrollment check
therefore admits students *and* teaching staff. We deliberately do **not** add a
`role.name` filter (analytics needed one because it gates a *teacher-only* report;
#319 admits students too). `status IN ('active','completed')` matches the analytics
precedent (active or finished course → access retained; `inactive`/`withdrawn` → no).

### D) Deny contract — **404, not 403**

An authenticated tenant member who is **not** enrolled/teaching/admin requesting a
course-scoped `GET /videos/:id` gets **`404 not_found`**, identical to a
non-existent or foreign-tenant video (RLS already returns 404 cross-tenant,
`routes.ts:217`).

- **Why 404:** a 403 leaks that *this course has a video with this id* to someone
  with no relationship to the course — an existence/enumeration signal. 404 makes a
  forbidden course-scoped video **indistinguishable from "does not exist"**,
  consistent with the existing cross-tenant 404 boundary (AC5). The missing-`x-user-id`
  case still fails closed at **401** via `resolveCaller` (`routes.ts:74-88`); a
  caller with `course_id = NULL` videos is unaffected.
- **List (`GET /videos`):** course-scoped videos the caller can't read are simply
  **omitted** (no error); `course_id IS NULL` videos remain listed for any tenant
  member.

**Filtering is done DB-side**, not post-fetch, for correctness and to avoid paging
artefacts. `listVideos` gains a principal-aware path:

```sql
-- non-admin caller:
SELECT <VIDEO_COLS> FROM video_asset v
 WHERE v.course_id IS NULL
    OR EXISTS (SELECT 1 FROM enrollment e JOIN course c ON c.org_unit_id = e.org_unit_id
                WHERE c.id = v.course_id AND e.user_id = $1::uuid
                  AND e.status IN ('active','completed'))
 ORDER BY v.created_at DESC
-- admin caller: existing unfiltered listVideos (ADMIN_ROLES short-circuit in routes)
```

(`course_id IS NULL` preserves AC3 no-regression; the EXISTS is the same bridge as
the single-read predicate, so list and detail never disagree.)

### E) RLS is unchanged — `course_id` is **not** a new RLS axis

`video_asset` keeps the single `tenant_isolation` policy from the `tenant_tables`
loop (`database/policies/rls.sql:32`). `course_id` is an **application authz
filter**, evaluated in service code over RLS-scoped tables — **not** a row-security
predicate. **schema-agent must NOT add a second policy** for `video_asset`; the only
schema change is the nullable column + its index. pglast must still validate.

## Consequences

- **Positive:** mirrors a validated precedent (analytics `teachesCourse`); offline,
  key-free, network-free tests; no new service dependency; RLS surface untouched;
  one join shared by detail + list so they cannot diverge; existence-hiding 404.
- **Trade-offs:** the list EXISTS sub-select adds per-row cost on large tenants —
  acceptable (correctness first; `ix_video_course` + the existing enrollment indexes
  `ix_enrollment_ou`/`ix_enrollment_user` bound it; revisit with a materialised
  visibility view only if profiling demands). Teachers assigned purely via
  `role_assignment` *without* an `enrollment` row are not admitted by the enrollment
  predicate — this is **intentional parity** with analytics; if a future need arises,
  add a `role_assignment` branch behind the same seam (no contract change).
- **Follow-ups:** `POST /videos` should accept an optional `courseId` (uploader
  roles) to populate the column — service-builder owns the exact request-shape
  addition; not a new ADR.

## Build sequence

1. **schema-agent** — `database/schema.sql:1098`: add nullable
   `course_id uuid REFERENCES course(id) ON DELETE SET NULL` + `ix_video_course`
   index to `video_asset`. Confirm **no** RLS change (single `tenant_isolation`
   stays). Validate with pglast.
2. **service-builder** — `services/video/src/*`:
   - new `access.ts` (the `CourseAccessPolicy` seam + `DbCourseAccessPolicy` +
     `FakeCourseAccessPolicy`);
   - `store.ts` / `store.prisma.ts` / `store.memory.ts`: surface `courseId` on
     `VideoRecord`/`NewVideoInput`, add the principal-aware list path (DB-side WHERE
     in prisma; equivalent filter in memory);
   - `routes.ts`: gate `GET /videos/:id` (404 on deny) and filter `GET /videos`;
     accept optional `courseId` on `POST /videos`;
   - `main.ts`: wire `courseAccessPolicy` default + `BuildAppOptions` override;
   - `main.test.ts`: offline cases per AC6 using the Fake + memory store.
3. **qa-agent** — typecheck / lint / test / pglast green; map tests → AC1–AC6.
4. **security-agent** — confirm tenant isolation intact, 404 existence-hiding, no
   client-supplied tenant/course trust, DoD.
