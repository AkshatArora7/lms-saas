# Handshake — feat/wire-admin-live (#269 Wave 2)

> **Single source of truth for one task.** Subagents are stateless; this file
> carries context between them. Every agent **reads this file in full before
> acting** and **updates its own section before handing off**.

## 1. Task
- **Issue:** #269 — Replace hardcoded demo data with live microservice data (BFF) · https://github.com/AkshatArora7/lms-saas/issues/269
- **Type:** feat
- **Branch:** feat/wire-admin-live  (off fresh `main` @ 9d44ec3)
- **Requested by / date:** repo owner · 2026-06-20
- **One-line goal:** Wire the admin console (apps/admin) /users, /users/[id], /org-units to LIVE user-org service data via the BFF server-fetch pattern (Wave 2), removing demo constants.

## 2. Acceptance criteria
- [x] /users renders seeded users (Demo Teacher / admin@demo.school, Demo Student / student@demo.school) from user-org `GET /users` (+ enrichment).
- [x] /users/[userId] renders the seeded user from `GET /users/:id`; demo lookup removed.
- [x] /org-units renders the seeded hierarchy (Demo School → Intro to the Demo Platform (Section A)) from `GET /org-units`; DEMO_TREE removed.
- [x] `tenantId === '111…111'` demo gating + DEMO_USERS/DEMO_TREE removed; graceful offline state on service error (no demo fallback).
- [x] `USER_ORG_SERVICE_URL` + `depends_on: user-org` added to the `admin` service in docker-compose.yml.
- [x] Old demo strings ("Amelia Stone", "Demo Unified District", "South Academy") absent; Playwright seeded-data evidence captured.

## 3. Stage status
| Stage | Owner | Status | Evidence |
| ----- | ----- | ------ | -------- |
| Requirements | backlog-agent | ☑ done | #269 (Wave 2 scope) |
| Architecture | architect | ☑ done | endpoints in services/user-org/src/routes.ts |
| Frontend | frontend-dev | ☑ done | §4 + §5 (Playwright seeded-data evidence) |
| QA / tests | qa-agent | ◐ wip | typecheck/lint green; ad-hoc Playwright green (§5) |

## 4. Decisions & contracts
- **Implementation (frontend-dev):**
  - New BFF client: `apps/admin/app/lib/user-org-api.ts` — `listUsers`, `getUser`, `listOrgUnits` forwarding `x-tenant-id` to `USER_ORG_SERVICE_URL` (default http://localhost:4003), discriminated results.
  - `apps/admin/app/lib/directory.ts` — rewritten: `getDirectory` (list + per-user enrich for roles/org-unit + org-unit name map; returns `null` on offline), `getDirectoryUserDetail` (ok/not_found/offline). DEMO_USERS removed.
  - `apps/admin/app/lib/org-units.ts` — rewritten: `getOrgUnits` builds tree from flat `GET /org-units` via `parentId`; returns `null` on offline. DEMO_TREE + fabricated `memberCount` removed; type labels updated to real org-unit types.
  - Pages: `app/users/page.tsx`, `app/users/[userId]/page.tsx`, `app/org-units/page.tsx` — now async, live data + offline state. Status enum aligned to service (active/invited/inactive).
  - `docker-compose.yml` admin service: `USER_ORG_SERVICE_URL: http://user-org:4003` + `depends_on: user-org (service_healthy)`.
  - Note: `GET /org-units` returns the full flat set, so `GET /org-units/:id/subtree` was not needed for the tree render.

## 5. Verification
- **typecheck:** `pnpm --filter @lms/admin typecheck` → PASS (0 errors).
- **lint:** `pnpm --filter @lms/admin lint` → PASS (0 errors).
- **Runtime (Docker `lms` stack, admin image rebuilt; ad-hoc Playwright @ :3001, login admin@demo.school/password123):**
  - /users: found "Demo Student", "student@demo.school", "Demo Teacher", "admin@demo.school"; old strings "Amelia Stone"/"Priya Natarajan"/"Daniel Okoro" ABSENT.
  - /users/d0000000-00a1-0000-0000-000000000001: "Demo Teacher" + "admin@demo.school" + roles instructor/org_admin.
  - /org-units: "Demo School" + "Intro to the Demo Platform (Section A)"; old strings "Demo Unified District"/"North High School"/"South Academy" ABSENT.
  - Responsive: no horizontal overflow at 360 / 768 / 1280 on /users and /org-units (scrollWidth == innerWidth).

## 6. Open questions / blockers
- The `/users` list endpoint omits roles/org-unit; enriched via per-user `GET /users/:id` (small N, acceptable for the demo tenant). If user volume grows, add a list-with-memberships endpoint (follow-up for service-builder).

## 7. Handshake log
- 2026-06-20 23:50 · frontend-dev · wired admin /users, /users/[id], /org-units to user-org live data; removed demo constants; compose env added · **next owner → qa-agent**
