# LMS SaaS — Multi-Tenant Learning Platform

A complete, enterprise **Learning Management System** delivered as multi-tenant
SaaS — a **D2L Brightspace–class** platform for **K-12 districts, higher
education, and corporate training**. It runs courses end to end: enroll learners,
deliver content, run assignments and quizzes, grade, track outcomes, communicate,
analyze engagement, and assist with AI — all **white-labeled into the
institution's own portal** and kept in sync with their existing identity and
student records.

The platform is **multi-tenant with sub-tenants**: a district onboards once and
each school becomes its own space with its own admins, branding, sign-on and
rosters, while the district gets consolidated reporting and billing. It speaks the
**education interoperability standards** institutions require — **LTI 1.3 /
Advantage, OneRoster 1.2, Caliper / xAPI, SCORM, QTI** — so it plugs into the
tools schools already use.

> Built on **GitHub + Vercel + serverless** (no AWS/Azure). The deeper
> engineering details live in [`/docs`](docs); this README focuses on **what the
> platform provides**.

---

## What you get at a glance

| For learners | For teachers | For administrators |
| ------------ | ------------ | ------------------ |
| One place for courses, content, deadlines and grades | Author courses, assignments and quizzes; grade with rubrics | Onboard districts → schools as sub-tenants |
| Take quizzes, submit work, join discussions | Gradebook with weighted categories and final grades | White-label branding & custom domain per school |
| Personal calendar + iCal, mobile app | Standards/outcomes & mastery tracking | Per-tenant roles, permissions and policy rules |
| AI study assistant grounded in their course | Engagement & at-risk dashboards | SSO + automatic roster sync from the SIS |
| Accessible (WCAG 2.2 AA), multilingual | Announcements & targeted notifications | Plans, seats, usage metering & consolidated invoicing |
| Class timetable + attendance record | Take attendance with your school's codes | Timetables (conflict-checked) & attendance oversight |

**Headline capabilities:** course & curriculum management · content (incl.
SCORM/xAPI) · assignments & submissions · quizzes & question banks · gradebook ·
rubrics, competencies & outcomes · discussions · announcements & multi-channel
notifications · calendar · timetable scheduling · attendance · analytics &
reporting · AI assistant · video · search · billing · audit & compliance ·
mobile — across **26 services**, each a clean bounded context.

> **Looking for features by user type?** See
> [`docs/FEATURES.md`](docs/FEATURES.md) — a plain-language guide to what we
> provide for **schools, admins, teachers, students, and parents**.

---

## Table of contents

1. [Features — what the LMS provides](#features--what-the-lms-provides) ← **the meat**
2. [Built-in interoperability](#built-in-interoperability)
3. [Who it's for (use cases)](#who-its-for-use-cases)
4. [How it's built (architecture, in brief)](#how-its-built-architecture-in-brief)
5. [Repository structure](#repository-structure)
6. [Technology stack](#technology-stack)
7. [Getting started](#getting-started)
8. [Deployment & CI/CD](#deployment--cicd)
9. [Project tracking & documentation](#project-tracking--documentation)
10. [Roadmap](#roadmap)

---

## Features — what the LMS provides

Each capability area below lists **what you can actually do**, plus a short *why
it matters* and a one-line *under the hood*. The areas map to the 26 services and
the 24 product epics tracked on the GitHub board.

### 1. Multi-tenancy & sub-tenants

Sell to a district once and run every school under it independently.

**What you can do**
- Onboard a customer as a **tenant**, and a **district/university** as a *parent*
  with its **schools/colleges as sub-tenants**.
- Give each sub-tenant its **own admins, branding, SSO and rosters**, while the
  parent gets **consolidated reporting and billing** across all of them.
- Choose an **isolation tier per tenant** — shared (**pool**) for K-12/trials, or
  a dedicated database (**silo**) for enterprise/data-residency — and **promote
  pool → silo later with no code change**.
- Onboard a pool tenant **in minutes**; provision a silo tenant automatically.

*Why it matters.* This is the commercial backbone: it lets you serve a free
single school and a multi-school district contract from one platform.
*Under the hood.* `tenant` hierarchy (`parent_id`, `kind`) + recursive
`tenant_subtree()` roll-up; saga-based provisioning. See
[`docs/MULTI_TENANCY.md`](docs/MULTI_TENANCY.md).

### 2. School-portal integration & white-label branding

Appear **inside** the school's existing website — not as a separate destination.

**What you can do**
- **Embed** the LMS in a school portal/VLE via **LTI 1.3** launches.
- Let users sign in with the school's own identity (**SAML/OIDC SSO**).
- **White-label each tenant**: logo, favicon, primary/secondary/accent colours,
  light/dark theme, **custom domain** (e.g. `lms.school.edu`), custom CSS and
  support email.
- Have **sub-tenants inherit** a district's default look and **override
  field-by-field**.
- Keep users, classes and enrollments **in sync with the school's SIS**.

*Why it matters.* Institutions adopt tools that feel like their own and respect
their login and rosters. *Under the hood.* `tenant_branding` +
`tenant_effective_branding()` inheritance; `lti`, `identity` and `sis` services.

### 3. Identity, roles & per-tenant permission rules

Every tenant enforces **its own rules** — provably isolated.

**What you can do**
- Sign in securely via an external identity provider; receive **tenant-scoped**
  access.
- Define **your own roles** per tenant (e.g. "Teacher", "Dept Head") and choose
  exactly **which capabilities** each role grants.
- **Grant roles at a specific level** of the org tree (district / school / dept /
  section) with **cascade** down the subtree — so a teacher at one school never
  gains rights at another.
- Set **per-tenant governance policies** beyond roles (password rules, quiz
  lockdown defaults, grading-scheme defaults, self-registration on/off).

*Why it matters.* Education data is sensitive; access must be granular,
org-scoped, and auditable. *Under the hood.* `role` / `permission` /
`role_permission` / `role_assignment` + `tenant_setting`, **all under Row-Level
Security** so one tenant can never read or alter another's rules.

### 4. Org hierarchy & roster management

The structure every other feature hangs off.

**What you can do**
- Model **district → school → department → term → course → section**.
- Manage **user profiles**, memberships and **academic sessions/terms**.
- Drive rosters from the SIS or manage them directly.

*Why it matters.* Enrollment, grading, analytics and permissions all query this
tree. *Under the hood.* `user-org` service; OneRoster `orgs`/`users` mapping.

### 5. Courses & curriculum

Author once, reuse every term.

**What you can do**
- Build **course templates** and spin up **per-term offerings** with sections.
- **Copy/import** an entire course into a new offering.
- Organize content into **modules** with **release conditions** (gated /
  prerequisite-driven release).

*Why it matters.* Curriculum reuse and structured learning paths save staff time.
*Under the hood.* `course` service; `course`, `release_condition`.

### 6. Content & materials (SCORM / xAPI)

Deliver any learning content and track completion.

**What you can do**
- Upload and serve **modules, lessons and topics** (text, files, embeds,
  interactive/H5P-style).
- Play **SCORM (1.2 / 2004)** packages and record attempts.
- Track **completion** per learner; emit **xAPI** activity.

*Why it matters.* Schools bring large standards-based content libraries that must
just work. *Under the hood.* `content` service; JSONB structure + Vercel Blob
binaries.

### 7. Enrollment & registration

Get the right people into the right sections.

**What you can do**
- Enroll learners and instructors into sections **with roles**.
- Manage the **lifecycle** (active → completed → dropped) and **self-registration**.
- Keep enrollments **in sync with the SIS**.

*Why it matters.* High-volume, correctness-critical, and tied to billing seats.
*Under the hood.* `enrollment` service; enroll + seat-reservation saga.

### 8. Assignments & submissions

Collect and give feedback on student work.

**What you can do**
- Create assignments with **due dates and late/penalty policies**.
- Accept **file submissions**; leave feedback and grades.
- Hook in **plagiarism** checks.

*Why it matters.* The core instructional activity in most courses.
*Under the hood.* `assignment` service; uploads in Blob, line items in the
gradebook.

### 9. Assessments & quizzing

Assess at scale, securely.

**What you can do**
- Build **question banks** (import/export **QTI**) and **section quizzes**.
- Run **timed attempts** with **auto-grading** of objective items.
- Route subjective items to the gradebook for manual scoring.

*Why it matters.* Scalable, secure, time-boxed assessment is table stakes.
*Under the hood.* `assessment` service; JSONB items, write-heavy attempt path.

### 10. Grading & gradebook

The system of record for outcomes.

**What you can do**
- Use **grade schemes**, **weighted categories** and line items.
- **Calculate and release final grades**; give students a clear grade view.
- Expose grades via **LTI AGS** and **OneRoster results**.

*Why it matters.* The gradebook is the most scrutinized surface in any LMS.
*Under the hood.* `grading` service is the source of truth for grades.

### 11. Rubrics, competencies & outcomes

Standards-based grading and mastery.

**What you can do**
- Author **rubrics** (criteria × levels) and attach them to activities.
- Define **competencies / learning objectives** and **align** activities to them.
- Track **mastery** roll-ups per learner.

*Why it matters.* Accreditation and K-12 standards require outcomes, not just
points. *Under the hood.* `rubric` service feeds grading and analytics.

### 12. Discussions & collaboration

Asynchronous engagement that can be graded.

**What you can do**
- Run **threaded forums**, topics and replies with **subscriptions** and
  moderation.
- **Grade participation** where it counts.

*Why it matters.* A primary engagement and assessment tool, especially online.
*Under the hood.* `discussion` service; notification fanout on new posts.

### 13. Announcements & notifications

Reach the right people on the right channel.

**What you can do**
- Post **targeted course/org announcements** (schedule ahead).
- Deliver **multi-channel** notifications (**email / SMS / push / in-app**) with
  **per-user preferences**, unread counts and quiet hours.
- Set up **intelligent agents** that act on conditions (e.g. notify on at-risk).

*Why it matters.* Timely, preference-aware communication drives engagement.
*Under the hood.* `notification` service; central fanout consumer.

### 14. Calendar, timetable & scheduling

One place for everything that's due — and where to be, when.

**What you can do**
- See a **unified calendar** of deadlines and events aggregated from across the
  platform.
- Subscribe via **iCal** in any calendar app.
- Define **bell schedules** (named periods + times, incl. A/B-day or weekday
  patterns) per school.
- Build the **class timetable** — assign each section to a **period, room and
  teacher** within a term, with **conflict detection** (no double-booked rooms or
  teachers).
- Give every student and teacher a **personal weekly timetable** that merges into
  their calendar/iCal feed.

*Why it matters.* Reduces missed deadlines and gives K-12 schools the daily
scheduling backbone other LMSs lack. *Under the hood.* `calendar` service
aggregates due dates and timetable meetings; serves `.ics`; owns
`bell_schedule` / `schedule_period` / `timetable_entry`.

### 15. Analytics & reporting

Turn activity into insight — and compliance reports.

**What you can do**
- Capture standardized **learning activity** (Caliper / xAPI) into a Learning
  Record Store.
- View **engagement** metrics, **at-risk** learner flags and teacher dashboards.
- Roll up analytics **across a district's schools**.
- Run **scheduled and ad-hoc exports** (CSV / PDF / OneRoster) for compliance and
  accreditation.

*Why it matters.* Data-driven instruction and institutional reporting are major
buying criteria. *Under the hood.* Event-sourced `analytics` LRS + CQRS read
models; `reporting` exports off replicas.

### 16. AI assistant & personalization

A safe, tenant-isolated AI helper.

**What you can do**
- Give learners an **AI study assistant** that answers from **their own course
  content**, with citations.
- Help instructors **generate quiz questions** from course material.

*Why it matters.* AI tutoring and authoring are fast becoming expected — if safe.
*Under the hood.* `ai` service; **RAG over pgvector + Groq**, retrieval bounded by
RLS so it **never crosses a tenant boundary**.

### 17. Video & media

Lecture video that streams everywhere.

**What you can do**
- **Upload** video, **transcode** to adaptive **HLS/DASH**, and **stream**.
- Generate **captions / transcripts** for accessibility.

*Why it matters.* Video is heavy and must be adaptive and accessible.
*Under the hood.* `video` service; Blob storage + FFmpeg worker.

### 18. Search

Find anything — safely scoped.

**What you can do**
- Search content, courses and discussions with **keyword + semantic** results.
- Get results **scoped to your tenant** only.

*Why it matters.* Users expect fast, relevant discovery. *Under the hood.*
`search` service; Postgres full-text + pgvector, filtered by tenant.

### 19. Billing & subscriptions

Monetize cleanly, including for districts.

**What you can do**
- Offer **plans**, manage **seats**, and **meter usage**.
- Issue invoices, including **district-consolidated invoicing** across schools.

*Why it matters.* It's a SaaS — seats and clean district billing are core.
*Under the hood.* `billing` service; seat-reservation saga + `tenant_subtree()`
roll-up.

### 20. Security, audit & compliance

Provable isolation and regulatory readiness.

**What you can do**
- Rely on a **tamper-evident, hash-chained audit log**.
- Trust **enforced tenant isolation** (Row-Level Security) — tested in CI.
- Apply **per-tenant rate limiting**, **DSAR** (access/erasure), and
  **FERPA / GDPR / COPPA** handling (including age-appropriate K-12 flows).

*Why it matters.* Education data is highly regulated; isolation must be provable.
*Under the hood.* `audit` service + RLS (`FORCE ROW LEVEL SECURITY`, non-superuser
app role).

### 21. Mobile

Core learning on the go.

**What you can do**
- Use a **mobile app** for the everyday learner flows (dashboard, course,
  deadlines, notifications, grades).

*Why it matters.* Learners live on mobile. *Under the hood.* `mobile-bff`
aggregates services into mobile-shaped responses.

### 22. Platform, CI/CD & observability

Operate 26 services reliably.

**What you get**
- Per-service **deploy pipelines** (GHCR → container host) and a **DB migration
  pipeline**.
- **Tracing** (OpenTelemetry) and structured, PII-scrubbed logs.
- A documented **AI-agent contribution ruleset** ([`AGENTS.md`](AGENTS.md)) so
  every contributor (human or AI) follows the same rules.

*Why it matters.* Strong automation and visibility from day one.

### 23. Accessibility & internationalization

Usable by everyone, in any language.

**What you get**
- **WCAG 2.2 AA** across core flows — the standard and how it's enforced are in
  [`docs/ACCESSIBILITY.md`](docs/ACCESSIBILITY.md).
- **Internationalization & localization** for multilingual institutions
  (in-house `@lms/i18n`, en + es today, RTL-ready). See
  [`docs/INTERNATIONALIZATION.md`](docs/INTERNATIONALIZATION.md).

### 24. Attendance & participation

Take attendance fast, track it accurately, report it confidently.

**What you can do**
- Define **per-tenant attendance codes** and map each to a reporting category
  (present / absent / tardy / excused) — every school owns its own vocabulary.
- **Take attendance per class meeting** with the **roster pre-filled** from the
  section's enrolment and timetable; mark, annotate, then **finalize** to lock.
- Track **attendance rates** and **chronic-absence flags** per student and
  section, and **export** for compliance and SIS sync.
- Keep **students and parents informed** — attendance history in their views and
  **absence/tardy notifications** on their preferred channel.

*Why it matters.* Attendance is a core K-12 compliance and early-warning
requirement that generic LMSs lack. *Under the hood.* `attendance` service owns
`attendance_code` / `attendance_session` / `attendance_record`; codes are
tenant-isolated via RLS; marking emits events to `notification` and `analytics`.

---

## Built-in interoperability

Standards conformance is how an LMS wins institutional procurement — it's built in
from the start:

- **LTI 1.3** — be embedded in a school portal as an LTI **Tool**: **OIDC
  third-party login + Resource Link launch** (validate the platform-signed
  id_token against its JWKS, map LTI roles, mint a tenant session) ship today;
  **AGS** grade passback, **NRPS** roster, **Deep Linking 2.0**, and **Dynamic
  Registration** are on the roadmap.
- **OneRoster 1.2** — sync rosters both ways with the school SIS (consumer +
  provider) with `sourcedId` mapping and delta sync.
- **Caliper / xAPI** — standardized learning-activity events into the analytics
  LRS.
- **Content** — **SCORM 1.2 / 2004**, **xAPI**, and **QTI** import/export.

See [`docs/STANDARDS.md`](docs/STANDARDS.md).

---

## Who it's for (use cases)

- **K-12 districts** — district as a parent tenant, each school a sub-tenant;
  embed into the district/school portal via LTI + SSO; sync rosters from the SIS;
  district-wide analytics and billing. Start on the low-cost **pool** tier.
- **Higher education** — colleges/departments as sub-tenants; outcomes,
  competencies, heavy assessment and discussion; an LTI tool ecosystem; a **silo**
  tier for isolation or data residency.
- **Corporate / training** — a standalone tenant for compliance training: SCORM
  content, completion tracking, certificates, usage-based billing.

The throughline: **integrate with what the institution already runs** (portal,
identity, SIS) and **scale isolation with the contract** (pool → silo) without
re-engineering.

---

## How it's built (architecture, in brief)

```
clients (web / mobile)
  → Vercel Edge (CDN + WAF)
  → gateway (JWT validation, rate limit, tenant resolution)
  → Next.js Route Handlers (Web BFF) / mobile-bff
  → 26 domain microservices (Fastify, one DB boundary each)
  → Postgres (pool + silo) / Vercel Blob / Upstash / pgvector
events: services → outbox (Postgres) → QStash → consumers (analytics, notification, …)
```

- **Per service:** API (Fastify) → application → domain → infrastructure
  (Prisma + RLS) → Postgres, with a **transactional outbox** + **inbox**
  (exactly-once via `idempotency_key`).
- **Tenant isolation (defense in depth):** in-code tenant filter **+** engine-level
  **RLS** keyed on a request-scoped `app.tenant_id` **+** a non-superuser DB role.
- **The 26 services:** `gateway` · `identity` · `tenant` · `user-org` ·
  `enrollment` · `course` · `content` · `assignment` · `assessment` · `grading` ·
  `discussion` · `announcement` · `notification` · `calendar` · `rubric` ·
  `analytics` · `reporting` · `ai` · `lti` · `sis` · `video` · `search` ·
  `billing` · `audit` · `mobile-bff` · `attendance`.

Full per-service specs (responsibility, tables, endpoints, events, dependencies):
[`docs/services/`](docs/services). Architecture detail:
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Repository structure

```
apps/        web (learner/instructor + Web BFF), admin            → Vercel
services/    26 domain microservices (Fastify; Dockerfile → GHCR)
packages/    db, types, auth, config, events, logger, ui, tsconfig, eslint-config
database/    schema.sql (canonical DDL), policies/ (RLS), seed/
docs/        ARCHITECTURE · MULTI_TENANCY · DEPLOYMENT · STANDARDS · services/ · backlog/ · diagrams/
scripts/     github/ (backlog → issues/board seeder), docs/ (service-spec generator)
.github/     workflows: CI, deploy-web, deploy-services, db-migrate
AGENTS.md    rules every contributor/AI agent must follow
```

---

## Technology stack

| Concern              | Choice                                                        |
| -------------------- | ------------------------------------------------------------- |
| Monorepo             | pnpm workspaces + Turborepo                                   |
| Language             | TypeScript (end to end)                                       |
| Web / Admin          | Next.js 14 (App Router) → **Vercel** (also the Web BFF)       |
| Microservices        | Fastify (Node) — container images → **GHCR** → container host |
| Database             | **Postgres** (Neon / Vercel Postgres) + Prisma                |
| Tenancy              | Hybrid **pool** (shared DB + RLS) / **silo** (DB per tenant)  |
| Object storage       | **Vercel Blob**                                               |
| Cache / messaging    | **Upstash** Redis + QStash (events, schedules)                |
| AI                   | **Groq** + pgvector RAG                                       |
| Identity (CIAM)      | External provider (WorkOS / Auth0) — never a home-grown IdP   |
| CI/CD                | **GitHub Actions** (CI, Vercel deploy, container build, DB migrate) |

---

## Getting started

> **New collaborator?** Start with [`SETUP.md`](SETUP.md) — a step-by-step guide
> from a fresh clone to a running, understood project.

### Run the whole platform locally (one command)

One command brings up the **entire** platform — Postgres + Redis + all 26
services behind the API gateway + the web app (3000) + the admin console (3001) —
exactly the way it runs on a container host in production. There are two ways to
get the images. **Collaborators use the first (build-from-source) — it is the
supported, credential-free path.** The second (pull prebuilt GHCR images) is
**owner/CI-only** and requires access to the owner's private GHCR packages. See
[ADR-0034](docs/ADR-0034-collaborator-run-path.md).

| | Build from source (supported — collaborators) | Pull prebuilt images (owner / CI only — requires private GHCR access) |
| --- | --- | --- |
| **Command** | `pnpm start:build` | `pnpm start` (= `docker compose up -d`) |
| **Raw** | `docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build` | `docker compose up -d` |
| **Needs** | only **Docker Desktop + this repo** | **private** GHCR pull access (owner/CI only) |
| **Accounts** | **none** — no Supabase, no GHCR, no Upstash | GHCR pull access |
| **Images** | built from the **current source** | `ghcr.io/akshatarora7/lms-saas/<name>:latest` |

> **Policy:** image visibility + supported run path are fixed in
> [ADR-0034](docs/ADR-0034-collaborator-run-path.md). Cold build-from-source is
> slow today — speed-up tracked in #299.

> **First run builds ~29 images** (26 services + seed + web + admin) and can take
> a while; later runs are cached and fast.

**Prerequisite:** Docker Desktop installed and running. That's the only
requirement for the build-from-source path — no external accounts.

```bash
# Recommended for collaborators — build everything from local source:
pnpm start:build

# Owner / CI only — requires private GHCR pull access; collaborators use start:build
pnpm start
```

Both paths run against the **bundled in-compose Postgres**, which
**auto-applies** `schema.sql` + `rls.sql` on first boot — so tenant RLS is
enforced with **zero external setup**.

> **⚠️ Collaborators: leave the DB URLs empty.** For the local Docker run, keep
> `DATABASE_URL` (and `MIGRATION_DATABASE_URL` / `DIRECT_URL` /
> `CONTROL_PLANE_DATABASE_URL`) **empty in `.env`** — or don't create a `.env` at
> all — so the mesh uses the bundled Postgres. `.env.example` already ships them
> empty. **Only** set `DATABASE_URL` when you deliberately want to target
> Supabase / a remote Postgres (see below).

**Public surfaces** once it's up:

- **Web app (learner):** http://localhost:3000
- **Admin console:** http://localhost:3001
- **Gateway (authenticated API edge):** http://localhost:4000 — routes
  `/api/:service/*` to the owning service.
- Every service is also published on its own `40xx` port for direct inspection
  (see the port map in [`.env.example`](.env.example)).

**Demo logins** (seeded automatically on first boot) — sign in at `/login`:

| Account | Lands on |
| ------- | -------- |
| `admin@demo.school` / `password123` | web **and** admin console |
| `student@demo.school` / `password123` | web app (admin console shows "not authorized") |

**Prove the whole stack is healthy:** once it's up, run the full-stack smoke
check — it asserts every needed service's `GET /health` returns 200, does one
**authenticated gateway round-trip** (login at identity → `GET /whoami` through
the gateway), and confirms web + admin `/` render (< 500). It **exits non-zero**
on any failure, so it's the one command to trust the mesh is wired end-to-end:

```bash
pnpm smoke        # node scripts/smoke.mjs — green = the mesh works
```

> **Port 5432 already in use?** The bundled Postgres publishes on `${PG_PORT:-5432}`.
> If you already run a local Postgres on 5432, set `PG_PORT=5433` (in `.env` or
> your shell) before `pnpm start:build` so the stack doesn't collide.

**Tear down:**

```bash
pnpm down        # stop the stack, KEEP the Postgres data (= docker compose down)
pnpm down:clean  # stop AND wipe the Postgres volume (re-seeds on next up; = down -v)
pnpm ps          # show container status   ·   pnpm logs   # tail logs
```

The gateway is wired to each service via `SERVICE_URL_*`, and all services share
one `JWT_SECRET` so identity-issued tokens verify at the edge. The placeholder
`JWT_SECRET` fallback is **dev-only** — set a real one in `.env` before any real
deployment.

**Use Supabase instead of the bundled Postgres:** set `DATABASE_URL` in `.env`
to your Supabase connection string and it transparently overrides the in-compose
default for the whole mesh.

> **Supabase + IPv4:** the direct `db.<ref>.supabase.co` host is IPv6-only. On
> IPv4-only or serverless networks, use the Supabase **connection pooler**
> (Supavisor) URL — `...pooler.supabase.com:6543?pgbouncer=true` — as your
> `DATABASE_URL`.

**Infra only (Postgres + Redis):** the lightweight stack used by the integration
tests lives in `docker-compose.infra.yml`:

```bash
docker compose -f docker-compose.infra.yml up -d
# teardown + wipe the local DB volume:
docker compose -f docker-compose.infra.yml down -v
```

### Develop the apps & services locally (hot reload)

```bash
pnpm install
cp .env.example .env            # fill in DATABASE_URL (Supabase), JWT_SECRET, etc.
pnpm db:generate                # Prisma client

# Apply the canonical schema + RLS to Supabase (once):
#   psql "$DIRECT_URL" -f database/schema.sql
#   psql "$DIRECT_URL" -f database/policies/rls.sql

pnpm db:seed
pnpm dev                        # turbo runs apps + services (hot reload)
```

---

## Deployment & CI/CD

- **Web / Admin apps** → Vercel (preview per PR, production on `main`).
- **Microservices** → Docker images to **GHCR**, deployed to a container host
  (Fly / Render / Railway).
- **Database migrations** → dedicated GitHub Actions workflow.
- **Scheduled work** → QStash schedules + GitHub Actions cron + Vercel Cron.
- **Secrets** → GitHub/Vercel encrypted secrets + a secret store (silo DSNs from
  `tenant.database_ref`, never hard-coded).

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

---

## Project tracking & documentation

- **GitHub Project board:** **LMS Delivery** — every epic, user story, task and
  bug lives on the board.
- **Backlog source of truth:** [`docs/backlog/`](docs/backlog) — `backlog.json`
  (24 epics) → GitHub issues/labels/milestones via
  [`scripts/github/seed-backlog.ps1`](scripts/github/seed-backlog.ps1) (idempotent).
- **Start here (contributing):** [`CONTRIBUTING.md`](CONTRIBUTING.md) — the
  contributor quick-loop; defers to `AGENTS.md` for the authoritative rules.
- **Rules for contributors / AI agents:** [`AGENTS.md`](AGENTS.md) — story-first
  workflow, isolation guardrails, and the multi-agent delegation model.
- **Features by audience:** [`docs/FEATURES.md`](docs/FEATURES.md) — what the
  platform provides for schools, admins, teachers, students, and parents.
- **Design docs:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) ·
  [`docs/MULTI_TENANCY.md`](docs/MULTI_TENANCY.md) ·
  [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) ·
  [`docs/STANDARDS.md`](docs/STANDARDS.md) ·
  [`docs/ACCESSIBILITY.md`](docs/ACCESSIBILITY.md) ·
  [`docs/INTERNATIONALIZATION.md`](docs/INTERNATIONALIZATION.md) ·
  [`docs/services/`](docs/services) · [`docs/diagrams/`](docs/diagrams).

---

## Roadmap

1. **Phase 1 (MVP)** — **pool** only; core 8 services (Identity, Tenant, User&Org,
   Enrollment, Course, Content, Assignment, Gradebook); ship the **LTI 1.3
   platform** early. Exit: one tenant fully functional end to end.
2. **Phase 2** — Quiz, Discussion, Notification, Calendar, SIS (OneRoster 1.2),
   Search, Analytics (Caliper LRS); stand up the tenant catalog so the **silo**
   path is ready; reach **SOC 2 Type II** readiness.
3. **Phase 3** — AI assistant (RAG), Video, Billing, Rubric/Competency, Audit;
   introduce the **silo** tier for the first large enterprise / higher-ed tenant.
