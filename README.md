# LMS SaaS — Multi-Tenant Learning Platform

An enterprise, multi-tenant **Learning Management System (LMS) SaaS** — a
**D2L Brightspace–class** platform — built entirely on a **GitHub + Vercel +
serverless** stack (no AWS/Azure). It is designed to **plug into a school's
existing portal or website** rather than replace it: a district onboards as a
tenant, each of its schools becomes a **sub-tenant** with its own admins,
branding, single sign-on and rosters, and the district gets consolidated
reporting and billing across all of them.

It is built around the **1EdTech** interoperability standards that institutional
procurement requires — **LTI 1.3 / Advantage**, **OneRoster 1.2**, and
**Caliper / xAPI** — and a **hybrid pool/silo** tenancy model that scales from a
free K-12 trial to a physically isolated enterprise contract **without an
application code change**.

> The reference architecture (see [`/docs`](docs)) was adapted from an
> Azure + .NET blueprint and **re-platformed onto GitHub + Vercel + serverless
> equivalents** per project direction. The domain design — ~25 microservices,
> hybrid tenancy, event-driven analytics, and full 1EdTech standards — is
> preserved.

---

## Table of contents

1. [Features](#features) — **start here**
2. [Who it's for (use cases)](#who-its-for-use-cases)
3. [How it all fits together (architecture)](#how-it-all-fits-together-architecture)
4. [Repository structure](#repository-structure)
5. [Technology stack](#technology-stack)
6. [Getting started](#getting-started)
7. [Deployment & CI/CD](#deployment--cicd)
8. [Project tracking & documentation](#project-tracking--documentation)
9. [Roadmap](#roadmap)

---

## Features

The platform is decomposed into **23 capability areas** (epics), each backed by
one or more of the 25 microservices. Below, every feature area is explained:
**what it does**, **why it matters**, and **how it works** here.

### 1. Multi-tenancy, sub-tenants & provisioning

**What.** Every customer is a *tenant*. A **district or university** onboards as
a **parent tenant**; each of its **schools or colleges** is a **sub-tenant** with
its own administrators, branding, SSO and rosters. Standalone customers (a single
school, a company) onboard as a flat tenant.

**Why.** This is the commercial backbone and the project's defining requirement.
Schools already run a portal; we integrate beneath it. A district can manage many
schools centrally while each school stays operationally independent, and the
district still gets **consolidated reporting and billing**.

**How.**
- The `tenant` table carries a self-referencing `parent_id` and a `kind`
  (`standalone` / `parent` / `sub`), enforced by a consistency check so a
  sub-tenant must declare a parent and a parent/standalone must not.
- A recursive `tenant_subtree(root)` SQL function returns a parent plus all of
  its descendants — used for **district-wide roll-up** reporting and billing —
  while row-level data stays isolated per sub-tenant.
- A **tenant catalog** (control plane) is the single isolation authority,
  mapping `tenant_id → tier, region, database_ref, status`.
- **Provisioning is a saga** (QStash-driven): a *pool* tenant is just a catalog
  row; a *silo* tenant provisions a dedicated Neon database/branch, runs
  migrations, registers the mapping, then emits `tenant.provisioned` — with
  compensation (tear-down) on failure.

#### Per-tenant rules & branding

Each tenant owns its **own rule set and look**, and these are isolated by RLS
just like every other tenant table:

- **Roles & permissions** — every tenant defines its **own roles** (`role`,
  unique per tenant) and maps them to capabilities (`role_permission`), then
  grants them to users **at a specific org-unit** with optional cascade
  (`role_assignment`). The `permission` catalog is a shared *vocabulary* (fixed
  capability keys) so enforcement stays consistent across services while each
  tenant composes its own roles. Isolation is provable end-to-end: `role`,
  `role_assignment` **and** `role_permission` are all under RLS.
- **Governance settings** — `tenant_setting` is a namespaced key → JSON store for
  per-tenant policy beyond RBAC (e.g. password rules, quiz lockdown defaults,
  grading-scheme defaults, self-registration on/off).
- **White-label branding** — `tenant_branding` holds each tenant's logo, favicon,
  colours, theme, **custom domain**, custom CSS and support email. Sub-tenants
  **inherit** unset fields from their parent (a district sets a default look;
  schools override field-by-field), resolved by `tenant_effective_branding()`.

#### Hybrid pool / silo isolation

| Tier       | Isolation                              | Typical customer            | Cost   |
| ---------- | -------------------------------------- | --------------------------- | ------ |
| **pool**   | Shared Postgres + Row-Level Security   | K-12 / SMB / trials         | lowest |
| **silo**   | Dedicated Neon database/branch         | Enterprise / Higher-Ed      | higher |
| **hybrid** | pool by default, promote to silo later | the platform default        | mixed  |

The schema is **identical** in pool and silo — only physical placement differs —
so a tenant is promoted from pool to silo (noisy-neighbor, data residency,
customer-managed keys, or an enterprise contract) by copying its rows and
flipping a catalog flag, **with no code change**.

### 2. School-portal integration & embedding

**What.** The platform embeds into a school's existing website/VLE and federates
with its identity and roster systems. Features: **LTI 1.3** launches, **SSO**
(SAML/OIDC), **white-label theming**, embeddable widgets, and **OneRoster/SIS**
sync.

**Why.** Institutions don't rip-and-replace; they expect new tools to appear
inside their portal, respect their login, and stay in sync with their student
records. This is what makes adoption frictionless.

**How.** The `lti` service is both an LTI **Platform** and **Tool**; the
`identity` service federates to the school's IdP; per-tenant branding
(`tenant_branding`: logo, colours, theme, custom domain, CSS) drives
white-labeling; the `sis` service keeps users/orgs/classes/enrollments in sync.
(See [Interoperability](#interoperability-standards-1edtech) below.)

### 3. Identity, authentication, authorization & RBAC

**What.** Tenant-scoped authentication and **granular, role-based access
control** that cascades down the org hierarchy.

**Why.** A teacher at one school must never see another school's data; a district
admin needs read-across; permissions must be auditable.

**How.** Credentials are delegated to an **external CIAM** (WorkOS / Auth0) — no
home-grown identity store. The `identity` service issues **tenant-scoped JWTs**
(carrying `tenantId` and `tier`), publishes a **JWKS** for token verification at
the gateway, and evaluates permissions from `role` / `permission` /
`role_permission` / `role_assignment` tables, all tenant-isolated by RLS so one
tenant can never read or apply another's rules.

### 4. Org hierarchy & roster management

**What.** The organizational tree every other feature queries:
**district → school → department → term → course → section**, plus user profiles
and academic sessions.

**Why.** Rostering is the spine of an LMS — enrollment, grading, analytics and
permissions all hang off it.

**How.** The `user-org` service owns `org_unit`, `app_user` and
`academic_session`, maps cleanly to OneRoster `orgs`/`users`/`academicSessions`,
and is read-optimized with materialized membership views.

### 5. Courses & curriculum

**What.** Reusable **course templates** that become per-term **offerings**;
sections, modules, and **release conditions** (gated/conditional release).

**Why.** Curriculum is authored once and reused across terms and cohorts; release
conditions enable structured, prerequisite-driven learning paths.

**How.** The `course` service supports deep **course copy/import**, owns `course`
and `release_condition`, and exposes endpoints to define gated-release rules that
content/assessment evaluate at access time.

### 6. Content & materials (SCORM / xAPI)

**What.** Upload and deliver learning content — modules, lessons, topics —
including **SCORM (1.2 / 2004)** and **xAPI** packages and H5P-style interactive
content, with **completion tracking**.

**Why.** Institutions have large existing libraries of standards-based content
that must play and report completion correctly.

**How.** The `content` service stores structure/metadata in **JSONB** and
binaries in **Vercel Blob**, records completion, plays SCORM packages, and mirrors
**xAPI** statements to the analytics LRS.

### 7. Enrollment & registration

**What.** Place learners and instructors into sections with roles, manage the
**lifecycle** (active → completed → dropped), and support self-registration.

**Why.** Enrollment is a high-frequency, correctness-critical flow that also has
billing implications (seats).

**How.** The `enrollment` service drives the **enroll + billing saga**
(enroll → reserve seat → confirm; compensate by withdrawing on seat rejection)
and stays in sync with SIS-driven enrollments.

### 8. Assignments & submissions

**What.** Create assignments with **due dates and late/penalty policies**, collect
file submissions, and give feedback; **plagiarism** integration hooks.

**Why.** Assignments are the core instructional activity in most courses.

**How.** The `assignment` service stores uploads in **Vercel Blob** with metadata
in Postgres, creates a gradebook line item, and runs plagiarism checks as an
asynchronous hook.

### 9. Assessments & quizzing

**What.** **Question banks** (QTI import/export), sectioned exams, **timed
attempts**, and **auto-grading** of objective items.

**Why.** Scalable assessment with secure, time-boxed attempts is table stakes for
an LMS.

**How.** The write-heavy `assessment` service uses **JSONB** for flexible item
types; objective grading is synchronous, subjective grading routes to the
gradebook.

### 10. Grading & gradebook

**What.** A full **gradebook**: schemes, **weighted categories**, line items,
calculated and final grades, controlled **release**, and a student-facing view.

**Why.** The gradebook is the system of record for outcomes and the most
politically sensitive surface in any LMS.

**How.** The `grading` service is the source of truth for grades and exposes them
to **LTI AGS** and **OneRoster results**; it consumes submission/quiz events to
build line items.

### 11. Rubrics, competencies & outcomes

**What.** Authorable **rubrics**, **competencies / learning objectives**,
activity-to-objective **alignment**, and **mastery** tracking (standards-based
grading).

**Why.** Accreditation and K-12 standards frameworks demand outcomes and mastery
reporting, not just points.

**How.** The `rubric` service computes mastery roll-ups across aligned objectives
and feeds both grading and analytics.

### 12. Discussions & collaboration

**What.** Threaded **forums**, topics and replies, **subscriptions**, moderation,
and **graded participation**.

**Why.** Asynchronous discussion is a primary engagement and assessment tool,
especially online and in higher-ed.

**How.** The `discussion` service stores threaded posts in JSONB and fans out
notifications to subscribers on new posts.

### 13. Announcements & notifications

**What.** Targeted course/org **announcements** and **multi-channel
notifications** (email, SMS, push, in-app) with **per-user preferences** and
unread counters; **intelligent agents** that act on conditions.

**Why.** Timely, preference-respecting communication drives engagement and
reduces missed deadlines.

**How.** The `notification` service is the central fanout consumer (announcements,
discussions, grades, enrollments), respects preferences and quiet hours, and
evaluates intelligent-agent rules against analytics signals.

### 14. Calendar & scheduling

**What.** A **unified calendar** of due dates and events aggregated from across
the platform, with **iCal** feeds.

**Why.** Learners want one place to see everything that's due; iCal lets them sync
to their own calendar apps.

**How.** The `calendar` service aggregates deadlines from assignments, quizzes and
announcements and serves a personal `.ics` feed.

### 15. Analytics & reporting (Caliper / LRS)

**What.** Event capture into a **Learning Record Store**, **engagement** metrics,
**at-risk** prediction, teacher dashboards, and **district roll-ups**; scheduled
and ad-hoc **exports** (CSV/PDF/OneRoster).

**Why.** Data-driven instruction and institutional reporting/compliance are major
buying criteria.

**How.** Domain services emit **Caliper** (and legacy **xAPI**) events through the
outbox → QStash → the `analytics` LRS (append-only), which builds **CQRS read
models** (`engagement_summary`) that dashboards query — never the raw event store.
The `reporting` service runs exports off read replicas and writes results to Blob
with signed URLs.

### 16. AI & personalization (Groq)

**What.** A **Lumi-equivalent** assistant: a **RAG study assistant** grounded in
course content (with citations) and **AI-assisted question generation**.

**Why.** AI tutoring and authoring assistance are fast becoming expected
differentiators — but only if they're safe and tenant-isolated.

**How.** The `ai` service embeds tenant-scoped content into **pgvector** and
answers via **Groq**; retrieval is constrained by RLS so it **never crosses a
tenant boundary**.

### 17. Video & media

**What.** **Upload, transcode (HLS/DASH), caption/transcript**, and stream
lecture video.

**Why.** Video is heavy and latency-sensitive; it needs adaptive streaming and
accessibility captions.

**How.** The `video` service stores assets in Blob and runs **FFmpeg** transcoding
on a container worker (not serverless, due to runtime limits), with status in
JSONB and optional AI transcription.

### 18. Search

**What.** **Tenant-scoped** keyword **and** semantic search across content,
courses and discussions.

**Why.** Users expect Google-quality discovery, scoped safely to their tenant.

**How.** The `search` service combines Postgres **full-text** and **pgvector**;
every query is constrained by `app.tenant_id`, and indexes are kept fresh from
domain events.

### 19. Billing & subscriptions

**What.** Plans, **seat** management, **usage metering**, invoices, and
**district-consolidated invoicing**.

**Why.** It's a SaaS — monetization, seat reservation, and clean district-level
billing are core.

**How.** The `billing` service participates in the enroll+billing saga
(reserve/release seats), meters usage, and can bill a **parent (district)** tenant
via the `tenant_subtree()` roll-up.

### 20. Security, audit & compliance

**What.** **Tamper-evident, hash-chained audit logs**, **automated RLS isolation
tests in CI**, per-tenant **rate limiting**, **DSAR** (data-subject access /
erasure), and **FERPA / GDPR / COPPA** handling (including age-appropriate K-12
flows).

**Why.** Education data is highly regulated; isolation must be provable, not
assumed.

**How.** The `audit` service chains each record to the previous hash for
verifiability; **RLS** (`FORCE ROW LEVEL SECURITY`, app connects as a
non-superuser without `BYPASSRLS`) is the engine-level safety net behind the
application's tenant filter, and CI tests assert cross-tenant queries return
nothing.

### 21. Mobile (BFF + apps)

**What.** Core learner flows on **mobile**, served by a dedicated
**Backend-for-Frontend**.

**Why.** Mobile-shaped, low-round-trip payloads keep the React Native app thin and
fast.

**How.** The `mobile-bff` aggregates `course`, `calendar`, `notification`,
`grading` and `identity` into mobile-optimized responses, holding tokens
server-side.

### 22. Platform, CI/CD & observability

**What.** Per-service **deploy pipelines** (GHCR → container host), a **database
migration pipeline**, **OpenTelemetry tracing**, structured logging, and local
dev tooling.

**Why.** Operating 25 services reliably requires strong automation and visibility
from day one.

**How.** **GitHub Actions** build/test/deploy each service image to **GHCR** and
deploy the Next.js apps to **Vercel**; migrations run through a dedicated workflow;
**OpenTelemetry** traces and PII-scrubbed `pino` logs flow per service.

### 23. Accessibility & internationalization

**What.** **WCAG 2.2 AA** across core flows and full **i18n/localization**.

**Why.** Accessibility is a legal requirement in education, and the platform must
serve multilingual institutions.

**How.** Shared UI primitives enforce accessible patterns; copy is externalized
for localization.

### Interoperability standards (1EdTech)

Standards conformance is how an LMS displaces incumbents in procurement, so it is
built in from the start:

- **LTI 1.3 / Advantage** — the platform is both an LTI **Platform** and **Tool**:
  OIDC third-party login with signed RS256 `id_token`, **AGS** (grade passback),
  **NRPS** (roster), **Deep Linking 2.0**, and **Dynamic Registration**. Handles
  the third-party-cookie pitfalls (cookieless `postMessage` / new-window launch).
- **OneRoster 1.2** — the `sis` service is both **consumer** (pull from a school
  SIS) and **provider** (`/ims/oneroster/rostering/v1p2/*`), with `sourcedId`
  mapping and **delta sync** watermarks; OAuth2 client-credentials auth.
- **Caliper / xAPI** — standardized learning-activity events into the LRS.
- **Content** — **SCORM 1.2/2004**, **xAPI**, and **QTI** import/export.

---

## Who it's for (use cases)

- **K-12 districts** — onboard the district as a parent tenant and each school as
  a sub-tenant; integrate into the existing district/school portal via LTI + SSO;
  keep rosters synced from the SIS via OneRoster; give the district consolidated
  analytics and billing. Start on the low-cost **pool** tier.
- **Higher education** — colleges/departments as sub-tenants, standards-based
  outcomes and competencies, heavy discussions and assessments, LTI tool
  ecosystem, and a **silo** tier for institutions that demand physical isolation
  or data residency.
- **Corporate / training** — a standalone tenant for compliance training: SCORM
  content, completion tracking, certificates, and usage-based billing.

The unifying thread: **integrate with what the institution already runs**
(portal, IdP, SIS) instead of replacing it, and **scale isolation with the
contract** (pool → silo) without re-engineering.

---

## How it all fits together (architecture)

### Request path

```
clients (web / mobile)
  → Vercel Edge Network (CDN + WAF + DDoS)          [was: Azure Front Door]
  → gateway service (JWT validation, rate limit, tenant resolution)
  → Next.js Route Handlers (Web BFF) / mobile-bff
  → domain microservices (Fastify, one DB boundary each)
  → Postgres (pool + silo) / Vercel Blob / Upstash / pgvector
events: domain services → outbox (Postgres) → QStash → consumers (analytics, notification, …)
```

### Per-service shape

Each service is layered **API (Fastify) → application (commands/queries) → domain
→ infrastructure (Prisma + RLS) → Postgres**, and writes a **transactional outbox**
row in the same DB transaction as the business change, relayed to QStash after
commit. Consumers dedupe via an **inbox** + `idempotency_key` for exactly-once
processing.

### Tenancy & isolation (defense in depth)

1. **Application filter** — every query is tenant-scoped in code.
2. **Engine-level RLS** — a `tenant_isolation` policy on every tenant table
   compares `tenant_id` to a request-scoped `app.tenant_id` GUC set
   transaction-locally (so it can't leak across reused serverless connections).
3. **Non-superuser role** — no `BYPASSRLS`, so RLS catches what code misses.

Tenant is resolved from **subdomain → JWT claim → `X-Tenant-Id` header** (the last
for service-to-service only). See [`docs/MULTI_TENANCY.md`](docs/MULTI_TENANCY.md).

### The 25 services

`gateway` · `identity` · `tenant` · `user-org` · `enrollment` · `course` ·
`content` · `assignment` · `assessment` · `grading` · `discussion` ·
`announcement` · `notification` · `calendar` · `rubric` · `analytics` ·
`reporting` · `ai` · `lti` · `sis` · `video` · `search` · `billing` · `audit` ·
`mobile-bff`.

Full per-service specs (responsibility, owned tables, endpoints, events,
dependencies) are in [`docs/services/`](docs/services).

---

## Repository structure

```
apps/
  web/            Next.js learner/instructor app (Vercel) — also the Web BFF
  admin/          Next.js administration app (Vercel)
services/         25 domain microservices (Fastify; Dockerfile → GHCR)
packages/
  db/             Prisma + tenant routing (pool/silo) + seed
  types/          Shared domain types
  auth/           JWT signing/verification, scopes
  config/         Validated env (zod)
  events/         Event envelope + contracts (outbox/inbox)
  logger/         Structured pino logger
  ui/             Shared UI primitives
  tsconfig/       Shared TS configs
  eslint-config/  Shared lint config
database/
  schema.sql      Canonical Postgres DDL (source of truth)
  policies/       Row-Level Security (pool isolation)
  seed/           Seed data
docs/
  ARCHITECTURE.md MULTI_TENANCY.md DEPLOYMENT.md STANDARDS.md
  services/       Per-service design specs (25) + index
  backlog/        Product backlog (epics/stories) + GitHub seeder source
  diagrams/       draw.io diagrams
scripts/
  github/         Idempotent backlog → GitHub issues/labels/milestones/board seeder
  docs/           Service-spec generator
.github/workflows CI, deploy-web, deploy-services, db-migrate
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
| AI (Lumi-equivalent) | **Groq** + pgvector RAG                                       |
| Identity (CIAM)      | External provider (WorkOS / Auth0) — never a home-grown IdP   |
| CI/CD                | **GitHub Actions** (CI, Vercel deploy, container build, DB migrate) |

---

## Getting started

```bash
pnpm install
cp .env.example .env            # fill in DATABASE_URL, JWT_SECRET, etc.
pnpm db:generate                # Prisma client

# Apply the canonical schema + RLS (needs Postgres + psql, or run via CI):
#   psql "$DIRECT_URL" -f database/schema.sql
#   psql "$DIRECT_URL" -f database/policies/rls.sql

pnpm db:seed
pnpm dev                        # turbo runs apps + services
```

---

## Deployment & CI/CD

- **Web / Admin apps** → Vercel (preview per PR, production on `main`).
- **Microservices** → Docker images built and pushed to **GHCR**, deployed to a
  container host (Fly / Render / Railway).
- **Database migrations** → dedicated GitHub Actions workflow (Prisma + raw SQL).
- **Scheduled work** → QStash schedules + GitHub Actions cron + Vercel Cron.
- **Secrets** → GitHub/Vercel encrypted secrets + a secret store (silo DSNs are
  resolved from `tenant.database_ref`, never hard-coded).

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the full pipeline detail.

---

## Project tracking & documentation

- **GitHub Project board:** **LMS Delivery** — every epic, user story, task and
  bug (88 seeded issues) lives on the board.
- **Backlog source of truth:** [`docs/backlog/`](docs/backlog) — machine-readable
  `backlog.json` (23 epics, 88 items) turned into GitHub issues/labels/milestones
  by [`scripts/github/seed-backlog.ps1`](scripts/github/seed-backlog.ps1) (idempotent by issue title).
- **Architecture & design:**
  - [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — services, request path, Azure→Vercel mapping
  - [`docs/MULTI_TENANCY.md`](docs/MULTI_TENANCY.md) — pool/silo/hybrid, RLS, catalog, migration
  - [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — pipelines, Vercel, GHCR, cron, secrets
  - [`docs/STANDARDS.md`](docs/STANDARDS.md) — LTI 1.3/Advantage, OneRoster 1.2, Caliper/xAPI
  - [`docs/services/`](docs/services) — per-service specs (responsibility, tables, endpoints, events)
  - [`docs/diagrams/`](docs/diagrams) — draw.io diagrams (open at app.diagrams.net)

---

## Roadmap

1. **Phase 1 (MVP)** — **pool** only; core 8 services (Identity, Tenant, User&Org,
   Enrollment, Course, Content, Assignment, Gradebook); ship the **LTI 1.3
   platform** early. Exit: one tenant fully functional end to end.
2. **Phase 2** — Quiz, Discussion, Notification, Calendar, SIS (OneRoster 1.2),
   Search, Analytics (Caliper LRS); stand up the tenant catalog so the **silo**
   path is ready; reach **SOC 2 Type II** readiness.
3. **Phase 3** — AI/Lumi (RAG), Video, Billing, Rubric/Competency, Audit;
   introduce the **silo** tier for the first large enterprise / higher-ed tenant.
