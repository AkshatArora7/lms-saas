# Handshake — chore/one-command-local

> **Single source of truth for one task.** Subagents are stateless; this file
> carries context between them. Every agent **reads this file in full before
> acting** and **updates its own section before handing off**. Facts here must be
> grounded in source (the issue, `AGENTS.md`, the code/schema) — never invented.
> When this file and the code/schema disagree, the **source wins**: fix the code
> claim, then correct this file. Never delete another agent's section.

## 1. Task
- **Issue:** #258 — One-command full-app Docker mesh (docker compose up -d)  ·  https://github.com/AkshatArora7/lms-saas/issues/258
- **Type:** chore
- **Branch:** chore/one-command-local  (off fresh `main`)
- **Requested by / date:** AkshatArora7 · 2026-06-21
- **One-line goal:** `docker compose up -d` brings up the entire LMS app (Postgres + Redis + the 26 containerized services + web on 3000 + admin on 3001) in one command, referencing owner-built ghcr images, so the whole platform can be stood up and demoed locally without hand-building images.

## 2. Acceptance criteria  (verbatim from the issue — do not paraphrase)
- [ ] One command (docker compose up -d) brings up Postgres + Redis + the 26 containerized services + web app + admin app, all wired together.
- [ ] Compose references owner-built images ghcr.io/akshatarora7/lms-saas/<service>:latest (lowercase) by default, NOT build: for the 26 services (optional commented build fallback OK).
- [ ] apps/web and apps/admin get a Dockerfile (multi-stage pnpm-workspace, Next.js standalone) - these are net-new.
- [ ] web/admin server-side *_URL env wired to compose DNS names (not localhost).
- [ ] services depend_on postgres healthy; web/admin depend_on the services they call; healthchecks present.
- [ ] No secrets committed (env via gitignored .env); tenant isolation (RLS) unaffected; Conventional Commits, no Copilot trailer.
- [ ] README + docs/DEPLOYMENT.md document the one-command full-app workflow.

## 3. Stage status  (tick only with evidence in the matching section)
| Stage | Owner | Status | Evidence |
| ----- | ----- | ------ | -------- |
| Requirements | backlog-agent | ☑ done | Issue #258 created, assigned, In Progress |
| Architecture | architect | ☐ | |
| UX design | ux-designer | ☐ | |
| Data & RLS | schema-agent | ☐ | |
| Backend | service-builder | ☑ done | docker-compose.build.yml override (29 build contexts), .env.example DB-URL fix, package.json run scripts; `docker compose ... config` ×2 exit 0 — see §4 |
| Frontend | frontend-dev | ☐ | |
| QA / tests | qa-agent | ☑ done | After service-builder's 2-line compose fix, RE-RAN full mesh from source (empty .env): 29/29 healthy, gateway/identity/course/analytics/attendance/user-org/enrollment /health=200, web+admin 307→/login, login 200+token, demo-tenant course read non-empty, tenant-isolation read empty, seed exit 0. Evidence §5. |
| Security & DoD | security-agent | ☑ done | APPROVE — secrets clean (.env gitignored+untracked; .env.example Supabase block fully commented `<region>/<ref>/password` placeholders; only LOCAL dev defaults app_user/lms/dev-JWT), RLS not weakened (runtime stays app_user NOSUPERUSER NOBYPASSRLS; seed-only privileged via MIGRATION_DATABASE_URL→lms L124; qa 2222→[] holds), DoD/AC mapped (base 29 GHCR images intact, override additive build-only, 26 svc + web/admin Dockerfiles exist). See §5. |
| Docs | docs-agent | ☑ done | README §Getting started (both paths table + demo logins + empty-DB-URL note + down/down:clean), docs/DEPLOYMENT.md (build-from-source override, env/DB-URL, ADR-0026/ADR-0027 #295 caveat), SETUP.md §Option B (pnpm start:build one-liner) — hand-authored only; no generated specs touched |

## 4. Decisions & contracts  (append; never rewrite history)
_(empty — architect to record technical design here before any code is written)_

### 2026-06-21 · service-builder · build-from-source path + zero-account local run
**Why:** collaborators who can't pull the owner-private GHCR images (or who want
to run current source) need a one-command full-mesh build, with ZERO external
accounts. The default GHCR pull path (#258 AC) stays intact.

**Changes**
- **NEW `docker-compose.build.yml`** — compose OVERRIDE (`name: lms`) adding only a
  `build:` block (context `.` + the existing `services/<name>/Dockerfile`) to all
  29 buildable services (26 microservices + `seed` packages/db/seed.Dockerfile +
  `web` apps/web/Dockerfile + `admin` apps/admin/Dockerfile). Same service keys as
  base ⇒ Compose deep-merges; each keeps its base env/ports/depends_on/healthcheck
  and its existing `image:` tag (built image tagged consistently). All 29 Dockerfile
  paths verified to exist on disk.
- **`.env.example`** — `DATABASE_URL`/`MIGRATION_DATABASE_URL`/`DIRECT_URL`/
  `CONTROL_PLANE_DATABASE_URL` now EMPTY by default with a prominent "LOCAL DOCKER:
  leave EMPTY" note, plus a commented "Supabase / remote (opt-in)" block. Fixes the
  bug where the Supabase placeholders (non-empty) overrode the `${VAR:-default}`
  fallback and broke the bundled in-compose Postgres
  (postgresql://app_user:app_user@postgres:5432/lms). All other vars unchanged; still
  a template, no real secrets.
- **`package.json`** — added `start:build` (build-from-source up), `start:pull`
  (=existing GHCR pull), `down`, `down:clean` (-v wipes pgdata/re-seeds), `ps`.
  Existing `start`/`stop`/`logs` preserved.
- **Item 4 (web/admin URLs):** audited every `process.env.*_URL`/`*_SERVICE_URL` in
  apps/web + apps/admin against the compose `web`/`admin` env — all present
  (web: IDENTITY, USER_ORG, ENROLLMENT, COURSE, CONTENT, ASSIGNMENT, GRADING,
  DISCUSSION, ANNOUNCEMENT, CALENDAR, ATTENDANCE, ANALYTICS; admin: IDENTITY,
  USER_ORG, COURSE, TENANT, ANALYTICS). No change required. GHCR `image:` lines kept.

**Run command (build everything from source, one command):**
`docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build`
(npm shortcut: `pnpm start:build`).

**Validation (CLI parse only — no containers started):**
- `docker compose -f docker-compose.yml -f docker-compose.build.yml config` → exit 0;
  29 `dockerfile:` + 29 `context:` entries (all 29 buildable services).
- `docker compose config` (base GHCR-pull path) → exit 0.

**Handoff → qa-agent:** do NOT run docker myself per task scope. qa-agent to actually
run `pnpm start:build` (and `pnpm start`) end-to-end and verify the mesh comes up
healthy with an empty `.env` (bundled Postgres) and login works via the demo seed.

### 2026-06-21 · service-builder · fix nested-var expansion crash (qa STORY DEFECT)
**Why:** qa-agent (§5) reproduced all 26 services crash-looping on
`DIRECT_URL`/`CONTROL_PLANE_DATABASE_URL: Invalid url` for a clean collaborator
(no `.env`). Root cause: `docker-compose.yml:52-53` used nested default expansion
`${VAR:-${DATABASE_URL}}` — Compose resolves the inner `${DATABASE_URL}` from the
host/`.env` env (unset for a clean clone), NOT the YAML key on line 51 ⇒ empty.

**Change (docker-compose.yml:52-53 only, 2 lines):** replaced nested defaults with
literal defaults matching line 51's pattern (kept the `${VAR:-...}` opt-in override
so Supabase/remote still works when `.env` sets these):
```yaml
DIRECT_URL: ${DIRECT_URL:-postgresql://app_user:app_user@postgres:5432/lms}
CONTROL_PLANE_DATABASE_URL: ${CONTROL_PLANE_DATABASE_URL:-postgresql://app_user:app_user@postgres:5432/lms}
```
Two-role model preserved: these are the runtime `app_user` URL (correct for
services); seed/migration (line 124, `lms` owner) untouched. Nothing else changed
(env/ports/depends_on/.env.example all unchanged). Not committed.

**Validation (clean-collaborator — `.env` temporarily moved aside, no host vars):**
`docker compose -f docker-compose.yml -f docker-compose.build.yml config` → exit 0.
Rendered values now NON-empty across all service blocks:
```
DIRECT_URL: postgresql://app_user:app_user@postgres:5432/lms
CONTROL_PLANE_DATABASE_URL: postgresql://app_user:app_user@postgres:5432/lms
DATABASE_URL: postgresql://app_user:app_user@postgres:5432/lms
```
Operator `.env` restored after the parse. **Handoff → qa-agent:** re-run `up -d`
(images cached) to confirm the mesh comes up healthy and login/read works.

## 5. Verification  (real output only — paste, don't summarize away errors)

### 2026-06-21 · qa-agent · ran the FULL mesh from source as a clean collaborator (empty .env)
Method: moved operator `.env` aside → `.env.operator-bak` (forces bundled in-compose Postgres),
`docker compose down -v` (fresh volume), then
`docker compose -f docker-compose.yml -f docker-compose.build.yml build` +
`... up -d`. Operator `.env` RESTORED at end (verified Test-Path .\.env → True).

**RESULT: image build GREEN, runtime RED.**

- **Build:** GREEN — all 29 images built (26 services + seed + web + admin). No Docker image-build
  failures. (Host pnpm EPERM symlink issue did NOT occur — Linux container builds fine.)
- **postgres / redis:** healthy. **seed:** SUCCESS, exit 0 — populated demo tenant
  11111111-…-111111111111: app_user×2, user_credential×2, role×7, course×1, enrollment×2,
  assignment×2, submission×1, grade×1, announcement×2, discussion_post×2, attendance_record×3,
  timetable_entry×1.
- **All 26 microservices: crash-loop (RED).** Every service exits 1 at startup:
  ```
  {"level":50,"msg":"failed to start <service> service","err":{"message":
    "Invalid environment configuration:\n  - DIRECT_URL: Invalid url\n  - CONTROL_PLANE_DATABASE_URL: Invalid url"}}
  ```
  Docker also printed 55× `"DATABASE_URL" variable is not set. Defaulting to a blank string.`
- **Health curl matrix (final capture):** gateway 4000, identity 4001, user-org 4003,
  enrollment 4004, course 4005, analytics 4015, attendance 4025 — **all 000 (connection refused)**.
- **web (3000) / admin (3001):** never started (stuck `Created`) — gated on `gateway` healthy,
  which never went healthy. curl exit 7.
- **Login smoke** (POST identity:4001/auth/login admin@demo.school): **000** — identity not listening.
- **Authenticated read** (GET course:4005/courses, demo tenant): **000** — course not listening.
- **Tenant-isolation negative check:** could not be evaluated (course never stable). NOTE: this is
  a runtime-availability failure, NOT evidence of an RLS regression — services never reached the DB.

**ROOT CAUSE (what / why / where / how masked / blast radius / fix):**
- **What:** all 26 services reject their env: `DIRECT_URL`/`CONTROL_PLANE_DATABASE_URL` resolve to
  empty string → fail URL validation in `packages/config` → process exits 1, crash-loops.
- **Where:** `docker-compose.yml:52-53`
  ```yaml
  DIRECT_URL: ${DIRECT_URL:-${DATABASE_URL}}
  CONTROL_PLANE_DATABASE_URL: ${CONTROL_PLANE_DATABASE_URL:-${DATABASE_URL}}
  ```
- **Why:** Docker Compose interpolates the INNER `${DATABASE_URL}` from the host/`.env`
  environment — NOT from the YAML key defined on line 51. With a clean collaborator (no `.env`),
  `DATABASE_URL` is unset in the host env, so the nested default expands to empty. Line 51 works
  because its fallback is a literal string; the seed (line 124) works for the same reason.
- **How it was masked:** the OLD `.env.example` shipped non-empty Supabase placeholders for
  DIRECT_URL/CONTROL_PLANE, which populated the host env and hid the nested-expansion bug. THIS
  story deliberately empties those defaults (`.env.example:24-27`) for the zero-account clean-clone
  path — which is exactly the scenario that surfaces the bug. ⇒ **STORY DEFECT**, not pre-existing-masking.
- **Blast radius:** the entire one-command collaborator path is non-functional at runtime — 26
  services down, gateway never healthy, web+admin never start, no login/read possible.
- **Fix direction (for service-builder):** replace the nested defaults with literal defaults
  matching line 51 (and the seed pattern):
  ```yaml
  DIRECT_URL: ${DIRECT_URL:-postgresql://app_user:app_user@postgres:5432/lms}
  CONTROL_PLANE_DATABASE_URL: ${CONTROL_PLANE_DATABASE_URL:-postgresql://app_user:app_user@postgres:5432/lms}
  ```
- **Recurrence guard:** after the fix, `docker compose -f docker-compose.yml -f docker-compose.build.yml config`
  should show DIRECT_URL/CONTROL_PLANE_DATABASE_URL = the literal app_user URL (not empty) when no
  `.env`/host var is set. qa-agent will re-run `up -d` (images cached) to confirm green.

**Failure classification:**
- **[STORY DEFECT → service-builder]** docker-compose.yml:52-53 nested var expansion (above). Only finding.
- **[PRE-EXISTING → file]** none found — build, seed, schema/RLS init, and image set all behaved.

`.env` restored: confirmed (`Test-Path .\.env` → True; `.env.operator-bak` gone).

### 2026-06-21 · qa-agent · RE-VERIFY after service-builder's compose fix — GREEN
Same clean-collaborator method (operator `.env` moved aside; images cached, seeded volume kept;
`docker compose -f docker-compose.yml -f docker-compose.build.yml up -d`). Operator `.env` restored at end.

**RESULT: GREEN — the one-command full-app collaborator path works end-to-end with empty/no `.env`.**

- **All 29 containers healthy** (postgres, redis, gateway, all 26 services, web, admin). `seed` exit 0.
  No crash-loops; the prior `DIRECT_URL/CONTROL_PLANE_DATABASE_URL: Invalid url` is gone.
- **Health matrix (200 each):** gateway 4000, identity 4001, user-org 4003, enrollment 4004,
  course 4005, analytics 4015, attendance 4025. No unhealthy containers.
- **web 3000 / admin 3001:** `HTTP/1.1 307 → /login` (<500, reachable).
- **Login** POST identity:4001/auth/login (admin@demo.school / password123, x-tenant-id demo):
  **HTTP 200**, body `{"tokenType":"Bearer","accessToken":"…","refreshToken":"…","expiresIn":900}` — token present.
- **Authenticated read** GET course:4005/courses (x-tenant-id 11111111-…): **HTTP 200, 1 course** —
  `"Introduction to the Demo Platform"` (seeded, RLS-scoped via app_user). NOT empty, NOT hard-coded.
- **Tenant isolation** GET course:4005/courses (x-tenant-id 22222222-…): **HTTP 200, `{"courses":[]}`** —
  no cross-tenant leak. The #286 RLS win survives the runtime mesh. ✅
- **`.env` restored:** Test-Path .\.env → True; .env.operator-bak gone.

**AC coverage at runtime:** AC1 one-command full mesh ✅ (29/29 up). AC4 web/admin server-side *_URL
wired to compose DNS ✅ (web/admin healthy, 307→/login through the mesh). AC5 depend_on healthy +
healthchecks ✅ (gateway gated services; web/admin gated gateway; all healthy). AC6 RLS unaffected ✅
(isolation negative check empty). AC2/AC3/AC7 are static/doc — for security-agent's DoD gate.

**Net QA verdict: build GREEN (29/29 images) + runtime GREEN (29/29 healthy, login+read+isolation pass).
One STORY DEFECT found and fixed within this story (compose nested-var expansion). No pre-existing bugs to file.**

### 2026-06-21 · security-agent · SECURITY + DoD GATE → APPROVE (safe to merge)
Audited the working tree vs source: `git status -s`, full `git diff`, the 7-file changeset, base
`docker-compose.yml`, the new `docker-compose.build.yml`, `.env.example`, and Dockerfile inventory.

**1) Secrets — CLEAN.**
- `git check-ignore .env` → exit 0 (gitignored); `git ls-files --error-unmatch .env` → error (NOT tracked,
  NOT staged). Only `.env.example` (template) is modified.
- `.env.example` Supabase/remote block (L41-49) is now **fully commented** and uses placeholders only —
  `<region>` / `<ref>` / literal `password` (no real host/ref/pooler/credential). Prior version shipped
  those lines UNcommented (non-secret placeholders, but live keys) → this change strictly reduces risk.
- No leaked credential/token/JWT-secret/real pooler host anywhere in the diff (grep over build override:
  no password/secret/token/app_user). `app_user:app_user`, `lms:lms`, and JWT fallback
  `local-compose-dev-secret-change-me-please` are pre-established LOCAL-only dev defaults (ADR-0026 / #286,
  #289 merged) — defaults, not new prod secrets.

**2) Tenant isolation — NOT weakened.**
- docker-compose.yml:52-53 literal defaults keep runtime DIRECT_URL/CONTROL_PLANE_DATABASE_URL on
  `app_user` (NOSUPERUSER NOBYPASSRLS, non-owner) — identical privilege to the prior `${DATABASE_URL}`
  fallback (also app_user); no switch to the privileged `lms` owner. The ONLY privileged runtime path is
  seed (L124, `DATABASE_URL: ${MIGRATION_DATABASE_URL:-…lms:lms@…}`) — untouched. qa 2222…→`{"courses":[]}`
  holds; #286 FORCE RLS survives the live mesh.

**3) DoD / AC mapping (#258).**
- AC1/AC4/AC5/AC6 → qa GREEN (29/29 healthy, login 200, RLS read+isolation). AC2 → base compose keeps 29
  `image: ghcr.io/akshatarora7/lms-saas/*` tags (grep count 29); override is **additive build-only** (deep-
  merge keeps both image+build → built image gets the GHCR tag, no tag removed). AC3 → apps/web/Dockerfile,
  apps/admin/Dockerfile, packages/db/seed.Dockerfile + 26 services/*/Dockerfile all present on disk. AC7 →
  README + docs/DEPLOYMENT.md + SETUP.md updated (docs-agent). Story #258 linked.
- Store-abstraction/six-file shape: N/A (infra/docs-only change, no services/* app code touched).
- Commit hygiene: NOT yet committed — ADVISORY to committer: Conventional prefix (e.g.
  `chore(infra): one-command local mesh + build-from-source path`), `Refs #258` / `Closes #258`, NO
  `Co-authored-by: Copilot` trailer.

**VERDICT: APPROVE — safe to merge** once committed with the hygiene above. No code defects; nothing to
delegate. Non-blocking follow-ups to file as issues: (a) GHCR image visibility / collaborator pull-access
for the `pnpm start` path (images are owner-private); (b) build-cache optimization to cut the ~2h cold
first build on the from-source path; (c) prod hardening to make `40xx` per-service ports internal-only
(already tracked as #295 / ADR-0027).

## 6. Open questions / blockers
_(none yet)_

## 7. Handshake log  (append-only; one line per hand-off)
- 2026-06-21 · backlog-agent · seeded handshake from issue #258, branch chore/one-command-local created off main @4787d2f · **next owner → orchestrator**
- 2026-06-21 · service-builder · added build-from-source override (docker-compose.build.yml, 29 build contexts), fixed .env.example DB-URL local default, added start:build/start:pull/down/down:clean/ps scripts; both `docker compose config` invocations exit 0 (not committed) · **next owner → qa-agent**
- 2026-06-21 · qa-agent · RAN the full mesh from source, empty .env: build GREEN (29/29 images), seed exit 0, but ALL 26 services crash-loop — `DIRECT_URL`/`CONTROL_PLANE_DATABASE_URL: Invalid url`. Root cause: docker-compose.yml:52-53 nested `${...:-${DATABASE_URL}}` expansion resolves the inner var from host env (empty for clean clone), not the YAML default on L51. STORY DEFECT (surfaced by this story's empty .env.example defaults). Diagnosis in §5; operator .env restored · **next owner → service-builder (apply 2-line literal-default fix), then back to qa-agent to re-verify**
- 2026-06-21 · qa-agent · RE-VERIFIED after the compose fix: full mesh from source (empty .env) is GREEN — 29/29 containers healthy, all sampled /health=200, web+admin 307→/login, login 200+token, demo-tenant course read non-empty, tenant-isolation read empty, seed exit 0, operator .env restored. QA stage ☑ done · **next owner → security-agent (DoD + tenant-isolation/secrets gate)**
- 2026-06-21 · docs-agent · documented the one-command full-app run in README.md (Getting started: build-from-source vs GHCR-pull table, demo logins, empty-DB-URL collaborator note, pnpm down/down:clean/ps), docs/DEPLOYMENT.md (override file + env/DB-URL behavior + ADR-0026 two-role link + ADR-0027/#295 local-vs-prod exposure caveat) and SETUP.md §5/6 Option B (pnpm start:build one-liner). Hand-authored docs only — no generated docs/services/* edited; internal links/anchors verified; demo accounts confirmed in seed.demo.ts. Not committed · **next owner → qa-agent**
- 2026-06-21 · service-builder · FIXED the STORY DEFECT — docker-compose.yml:52-53 nested `${VAR:-${DATABASE_URL}}` replaced with literal `app_user` defaults matching L51 (kept `${VAR:-...}` opt-in for Supabase/remote). Two-role model intact; seed L124 untouched; only those 2 lines changed. Verified clean-collaborator (`.env` moved aside) `docker compose -f docker-compose.yml -f docker-compose.build.yml config` → exit 0 with DIRECT_URL/CONTROL_PLANE_DATABASE_URL now = postgresql://app_user:app_user@postgres:5432/lms (NON-empty); operator `.env` restored. Not committed · **next owner → qa-agent (re-run `up -d`, confirm mesh healthy + login/read)**
- 2026-06-21 · security-agent · FINAL GATE → **APPROVE, safe to merge**. Secrets CLEAN (.env gitignored+untracked; .env.example Supabase block fully commented `<region>/<ref>/password` placeholders; only LOCAL dev defaults). RLS NOT weakened (runtime stays app_user NOSUPERUSER NOBYPASSRLS; only privileged path is seed→MIGRATION_DATABASE_URL→lms L124; qa 2222→[] holds). DoD/AC mapped: base keeps 29 GHCR image tags, override additive build-only, 26 svc + web/admin/seed Dockerfiles exist, docs updated, #258 linked. Advisory to committer: Conventional + Refs/Closes #258, no Co-authored-by trailer. Evidence §5 · **next owner → committer / orchestrator (commit + open PR; file non-blocking follow-ups: GHCR pull-access, build-cache, #295 port hardening)**
