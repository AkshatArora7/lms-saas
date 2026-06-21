# Handshake — feat/users-enrichment

> **Single source of truth for one task.** Subagents are stateless; this file
> carries context between them. Every agent **reads this file in full before
> acting** and **updates its own section before handing off**. Facts here must be
> grounded in source (the issue, `AGENTS.md`, the code/schema) — never invented.
> When this file and the code/schema disagree, the **source wins**: fix the code
> claim, then correct this file. Never delete another agent's section.

## 1. Task
- **Issue:** #278 — Issue #278: include roles + org-unit membership in GET /users (avoid admin N+1)  ·  https://github.com/AkshatArora7/lms-saas/issues/278
- **Type:** feat
- **Branch:** feat/users-enrichment  (off fresh `main`)
- **Requested by / date:** AkshatArora7 · 2026-06-21
- **One-line goal:** Issue #278: include roles + org-unit membership in GET /users (avoid admin N+1)

## 2. Acceptance criteria  (verbatim from the issue — do not paraphrase)
- [ ] `GET /users` returns each user's roles and org-unit membership in a single tenant-scoped response (or via a bulk/expand param).
- [ ] Admin `/users` drops the per-user N+1 enrichment.
- [ ] Response is RLS-enforced.
- [ ] Tests cover the expanded response shape.

## 3. Stage status  (tick only with evidence in the matching section)
| Stage | Owner | Status | Evidence |
| ----- | ----- | ------ | -------- |
| Requirements | backlog-agent | ☑ done | Issue #278 |
| Architecture | architect | ☑ done | §4 Architecture below |
| UX design | ux-designer | ☐ (n/a — no new UI) | |
| Data & RLS | schema-agent | ☑ done | NO schema change — §4.4 |
| Backend | service-builder | ☑ done | §4 Implementation below; user-org typecheck/lint/test green (43 tests) |
| Frontend | frontend-dev | ☐ | |
| QA / tests | qa-agent | ☐ | |
| Security & DoD | security-agent | ☐ | |
| Docs | docs-agent | ☐ | |

## 4. Decisions & contracts  (append; never rewrite history)
- **Data shapes (schema-agent):** NO schema change — see §4.4.
- **Design (ux-designer):** n/a — no new UI; the admin `/users` page is unchanged, only its BFF data source.
- **Implementation (service-builder / frontend-dev):** see build sequence §4.6 and **§4.9 Implementation (service-builder)** below.

### Architecture (architect)

**Grounding (file:line):**
- `GET /users` returns bare `{ users: UserRecord[] }` — `services/user-org/src/routes.ts:222-237`; `listUsers` returns `UserRecord[]` (no memberships) — `store.ts:161`, prisma `store.prisma.ts:318-345`, memory `store.memory.ts:195-214`.
- Detail `GET /users/:id` already returns enriched `UserProfile` with `memberships: MembershipRecord[]` — `routes.ts:239-245`, `store.ts:83-85,159`, prisma membership query `store.prisma.ts:302-310`.
- `MembershipRecord` = `{ assignmentId, roleId, roleName, orgUnitId, cascade }` — `store.ts:74-80`.
- Roles are **per-org-unit**, not global: `role_assignment(id, tenant_id, user_id, role_id, org_unit_id, cascade)` UNIQUE(user_id, role_id, org_unit_id) — `schema.sql:215-224`; `role(tenant_id, name)` UNIQUE(tenant_id,name) — `schema.sql:195-201`; `org_unit` — `schema.sql:105-119`.
- RLS FORCE + `tenant_isolation` on `app_user`, `role`, `role_assignment`, `org_unit` — `rls.sql:18-43,51-54`.
- **N+1 lives in the BFF**, not the page: `apps/admin/app/lib/directory.ts:79-97` does `Promise.all(list.users.map(getUser(record.id)))` → one HTTP call + one detail query per user, plus one `listOrgUnits` for a name map. The page (`apps/admin/app/users/page.tsx:98`) just calls `getDirectory`.
- **Only consumer** of `GET /users` is the admin BFF `listUsers` — `apps/admin/app/lib/user-org-api.ts:85-99`. No web BFF / other service consumes it (grep `/users` across `apps/`). → adding fields is additive / non-breaking.
- Batched-read reference pattern (`= ANY($1::uuid[])` with `$n::uuid` casts): `store.prisma.ts:225`, `services/rubric/src/store.prisma.ts:127`, `services/relay/src/store.prisma.ts:123`.

**4.1 Response contract.** Make the list item shape **identical to the detail
shape**: each item becomes a `UserProfile` = `UserRecord` + `memberships:
MembershipRecord[]`. `GET /users` → `{ users: UserProfile[] }`.
- Because roles are per-org-unit, the per-unit role is represented by each
  `membership` carrying both `orgUnitId` and `roleName` (+ `assignmentId,
  roleId, cascade`). This preserves the role↔org-unit pairing exactly; do NOT
  flatten to a global roles array in the service.
- The BFF derives its view (deduped `roles[]`, primary `orgUnit` name) from
  `memberships` + the org-unit name map — the exact logic already in
  `directory.ts:82-87` and `getDirectoryUserDetail` at `directory.ts:137-140`.
- **Org-unit names stay in the BFF**, not the service: `membership.orgUnitId`
  only. The BFF already fetches `listOrgUnits` once (O(1)) to map id→name; reuse
  it. Keeps list and detail service contracts identical and avoids a
  cross-aggregate name join in the read.
- **Backward-compat:** additive — JSON only gains a `memberships` array per
  user; the only consumer reads `data.users` and ignores extra fields.
- **Decision: default-embed (no `expand` param).** The single consumer always
  wants enrichment and the set is tenant-bounded, so an opt-in param adds
  surface for no benefit. (ADR-worthy — §8.)

**4.2 Query strategy (kill N+1 at the DB).** In `store.prisma.ts` `listUsers`,
inside the existing single `withTenant` tx, run a **fixed 2 queries** (O(1)
round-trips, independent of user count):
1. Existing users query (`store.prisma.ts:336-342`, keep `DISTINCT`, filters,
   `ORDER BY u.display_name`) → collect `userIds`.
2. If `userIds.length > 0`, one batched membership query:
   `SELECT ra.user_id, ra.id, ra.role_id, r.name AS role_name, ra.org_unit_id,
   ra.cascade FROM role_assignment ra JOIN role r ON r.id = ra.role_id
   WHERE ra.user_id = ANY($1::uuid[]) ORDER BY ra.created_at`.
   Bind `userIds` as one `uuid[]` param (the #267 cast rule). If empty, skip the
   query and attach `memberships: []` to every user. Group rows by `user_id` in
   JS. RLS on `role_assignment`/`role` keeps it tenant-scoped automatically.
- **No per-user query loop** in the service (do not reuse `getUser` per row).

**4.3 Store-abstraction plan.**
- `store.ts`: change `listUsers` return type `Promise<UserRecord[]>` →
  `Promise<UserProfile[]>` (filter signature unchanged). Single in-repo caller is
  `routes.ts:231`.
- `store.prisma.ts`: implement the 2-query + group approach above.
- `store.memory.ts`: `listUsers` (`:195-214`) maps each surviving user to
  `{ ...user, memberships }` built from `this.assignments` filtered by
  `tenantId + userId` (same projection as `getUser` at `:189-192`).
- **Pure mapper** for testability: `groupMembershipsByUser(users, rows)` →
  `UserProfile[]`, alongside the existing `toMembership` mapper.

**4.4 Schema.** **NO schema change.** `role_assignment`, `role`, `org_unit`,
`app_user` already exist with the needed columns and carry FORCE RLS
(`rls.sql:18-43`). Enrichment is expressible with existing joins. schema-agent
not required.

**4.5 Frontend plan (`apps/admin`).**
- `lib/user-org-api.ts`: change `listUsers` to return `UserProfile[]`
  (`UsersResult.users: UserProfile[]`) — the `UserProfile` type already exists at
  `:40-42`; widen the result and the cast at `:94`.
- `lib/directory.ts` `getDirectory`: **delete the N+1** — the
  `Promise.all(list.users.map(async (record) => { const detail = await
  getUser(record.id...) ... }))` block at `:79-97`. Replace with a plain `.map`
  over `list.users` reading `record.memberships` directly (roles =
  `uniq(memberships.map(m => m.roleName))`, `orgUnit` = name of
  `memberships[0].orgUnitId` via the existing `unitName` map). Keep the single
  `listOrgUnits` call (`:74`).
- Leave `getDirectoryUserDetail` (`:114-143`) and `/users/:id` **unchanged**.
- Out of scope (do not build): the enriched list also unblocks sibling **#279**
  (roster names) and **#277**'s deferred displayName; #278 stays scoped to
  `GET /users`.

**4.6 Build sequence.**
1. ~~schema-agent~~ — skip (no schema change).
2. **service-builder** — extend `listUsers` (store.ts type + prisma 2-query +
   memory + mapper); add unit tests; verify typecheck/lint/test/build.
3. **frontend-dev** — widen BFF `listUsers` type + delete the `directory.ts`
   N+1; verify admin `/users` renders roles/org-unit/status from the single
   response at phone/tablet/desktop.
4. **qa-agent** — run suite; map tests to the 4 ACs; live-DB integration that
   `GET /users` returns memberships and stays tenant-isolated.
5. **security-agent** — confirm RLS-enforced read (no tenant leak via the
   batched `ANY` query), DoD.

**4.7 Test plan hooks (user-org).**
- memory store: user with **multiple roles across multiple org-units** →
  serializes all memberships with correct role/org pairing; user with **empty**
  memberships → `memberships: []`; status/orgUnitId filters still apply and carry
  memberships.
- **tenant isolation:** another tenant's users AND their role_assignments are
  excluded (memory filters by tenantId; prisma relies on RLS).
- Update existing `GET /users` route/store tests asserting the bare shape.
- Live-DB integration (qa): seeded tenant returns enriched list; cross-tenant
  context returns none.

**4.8 Risks / trade-offs (ADR-worthy).**
- **Embed-vs-expand (ADR):** chose default-embed for the only consumer + bounded
  set; revisit (`?expand=` or pagination) if a non-admin consumer needs a lean
  list.
- **Payload size:** `GET /users` is **not paginated today** (returns the full
  tenant set ordered by `display_name`); embedding memberships multiplies payload
  by avg assignments/user. Fine at current admin-directory scale; flag for large
  tenants.
- **Pagination interaction:** when pagination lands, the `ANY($ids)` membership
  query must batch over the **current page's** ids only — the chosen approach
  already does this naturally (feed page ids, no join rework).

**4.9 Implementation (service-builder).** Done exactly per §4.1–4.3.
- **Response contract (unchanged envelope, enriched items):** `GET /users` →
  `{ users: UserProfile[] }`, each item =
  `{ id, tenantId, email, displayName, status, locale, createdAt, memberships:
  MembershipRecord[] }` where `MembershipRecord = { assignmentId, roleId,
  roleName, orgUnitId, cascade }` — copied verbatim from the existing `getUser`
  shape (`store.ts:74-85`, prisma `toMembership` `store.prisma.ts:83-91`). No
  field-name corrections needed; the design matched the code.
- **Files changed:**
  - `services/user-org/src/store.ts` — widened `listUsers` return to
    `Promise<UserProfile[]>`; added exported `UserMembership` type +
    pure helper `groupMembershipsByUser(users, memberships)`.
  - `services/user-org/src/store.prisma.ts` — `listUsers` now runs a **fixed 2
    round-trips** inside the existing `withTenant` tx: (1) the unchanged
    `DISTINCT … ORDER BY u.display_name` users query (filters preserved), then
    (2) one batched membership read
    `SELECT ra.user_id, ra.id, ra.role_id, r.name AS role_name, ra.org_unit_id,
    ra.cascade FROM role_assignment ra JOIN role r ON r.id = ra.role_id WHERE
    ra.user_id = ANY($1::uuid[]) ORDER BY ra.created_at` (bound `userIds` uuid[]
    param, `$1::uuid[]` cast per #267; skipped entirely when 0 users). Grouped
    via the pure helper. **No per-user query loop.** Added `UserMembershipRow`
    type.
  - `services/user-org/src/store.memory.ts` — `listUsers` returns
    `UserProfile[]`, projecting memberships from in-memory `assignments` (same as
    `getUser`) through the shared helper so memory ≡ prisma.
  - `services/user-org/src/main.test.ts` — added `groupMembershipsByUser` pure
    tests (multi-role/multi-org pairing; empty → `[]`), a `GET /users` enriched
    shape test, and extended tenant-isolation to assert memberships don't leak.
  - `routes.ts` — **no change** (handler already returns `{ users }`; now
    enriched transparently).
- **Verification:** `pnpm --filter @lms/service-user-org typecheck` ✓,
  `lint` ✓, `test` ✓ — 3 files / **43 tests** pass (main.test.ts 17).
- **Out of scope / next:** admin BFF widening + N+1 deletion (`directory.ts`) is
  frontend-dev's step §4.5; full-repo build + live-DB pglast is qa-agent.

## 5. Verification  (real output only — paste, don't summarize away errors)
- **QA (qa-agent):** typecheck / lint / test / build counts; per-AC test mapping; root-cause notes for any failure.
- **Security & DoD (security-agent):** isolation/authz/secrets findings; APPROVE / CHANGES REQUESTED.

## 6. Open questions / blockers
- <question needing product or human input — list rather than guess>

## 7. Handshake log  (append-only; one line per hand-off)
- 2026-06-21 11:20 · orchestrator · Created handshake; claimed #278 (assigned AkshatArora7, board → In Progress); branch feat/users-enrichment off main @ b1274f3 · **next owner → architect**
- 2026-06-21 11:25 · architect · Recorded technical design (§4): enrich GET /users to `{ users: UserProfile[] }` via a fixed 2-query batched read (users page → `role_assignment` JOIN `role` WHERE user_id = ANY($1::uuid[])); reuse existing MembershipRecord/UserProfile shapes; NO schema change; delete the BFF N+1 in directory.ts:79-97. · **next owner → service-builder**
- 2026-06-21 11:28 · service-builder · Implemented backend (§4.9): widened `listUsers` → `UserProfile[]` across store.ts/prisma/memory; prisma now 2 round-trips (users + one `ANY($1::uuid[])` membership batch, no per-user loop); added pure helper `groupMembershipsByUser` + tests; user-org typecheck/lint/test green (43 tests). NO schema change. · **next owner → frontend-dev** (widen admin BFF `listUsers` type + delete directory.ts:79-97 N+1)
