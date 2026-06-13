# LMS Product Backlog & GitHub Project Board

This folder is the **single source of truth** for what we're building and how we
track it. [`backlog.json`](./backlog.json) is machine-readable and is turned into
GitHub **labels, milestones and issues** by
[`scripts/github/seed-backlog.ps1`](../../scripts/github/seed-backlog.ps1).

## What we're building (in one paragraph)

A multi-tenant **LMS SaaS** (a D2L Brightspace-class platform) for K‑12, Higher‑Ed
and Corporate, on **GitHub + Vercel + serverless Postgres** (no AWS/Azure). The
defining requirement: schools already have a **portal/website**, so we **integrate
into** it rather than replace it — districts onboard as tenants and their schools
as **sub-tenants**, each with their own admins, branding, SSO and rosters, while
the district gets consolidated reporting and billing.

## How the backlog is structured

```
Milestone (M0…M5)         when — a release/phase
  └─ Epic (type/epic)     a large capability area (E1…E23)
       └─ Story/Task/Bug  a shippable increment with acceptance criteria
```

- **Epics** (24) map to the product's bounded contexts and the 26 microservices.
- **User stories** use the canonical form: _As a `<role>`, I want `<goal>`, so that
  `<benefit>`_, each with a checklist of **acceptance criteria** (definition of done).
- **Tasks** are technical work with no direct user story; **bugs** are defects;
  **spikes** are time-boxed research.

### Roles referenced in the stories
Platform super-admin · District administrator · School administrator · Instructional
designer / curriculum lead · Teacher · Teaching assistant · Student · Parent/guardian ·
Compliance officer · Platform/DevEx engineer.

## The epics

| Epic | Area | Why it matters |
| ---- | ---- | -------------- |
| **E1 Multi-Tenancy, Sub-Tenants & Provisioning** | tenancy | District→school **sub-tenant hierarchy**; hybrid pool/silo isolation. The commercial backbone. |
| **E2 School Portal Integration & Embedding** | integration | LTI 1.3, SSO (SAML/OIDC), white-label theming, embeddable widgets, OneRoster/SIS sync — **the "plug into the school's site" requirement**. |
| **E3 Identity, AuthN/AuthZ & RBAC** | identity | Tenant-scoped tokens; granular, org-scoped, cascading permissions. |
| **E4 Org Hierarchy & Roster Management** | rostering | The org-unit tree (org→dept→term→course→section) every feature queries. |
| **E5 Courses & Curriculum** | courses | Reusable templates → per-term offerings; modules & release conditions. |
| **E6 Content & Materials (SCORM/xAPI)** | content | Upload/serve content; SCORM playback; completion tracking. |
| **E7 Enrollment & Registration** | enrollment | Place learners/instructors into sections; self-registration. |
| **E8 Assignments & Submissions** | assignments | Create assignments, collect & feedback on submissions. |
| **E9 Assessments & Quizzing** | assessments | Question banks, timed attempts, auto-grading. |
| **E10 Grading & Gradebook** | grading | Schemes, weighted categories, release, student view. |
| **E11 Rubrics, Competencies & Outcomes** | outcomes | Standards-based grading and mastery tracking. |
| **E12 Discussions & Collaboration** | discussions | Threaded forums, moderation, graded participation. |
| **E13 Announcements & Notifications** | notifications | Targeted announcements; multi-channel prefs. |
| **E14 Calendar & Scheduling** | calendar | Unified due-date/event calendar with iCal feeds. |
| **E15 Analytics & Reporting (Caliper/LRS)** | analytics | Event capture, teacher dashboards, **district roll-ups**. |
| **E16 AI & Personalization (Groq)** | ai | RAG study assistant & question generation, tenant-isolated. |
| **E17 Video & Media** | video | Upload, transcode, caption, stream. |
| **E18 Search** | search | Tenant-scoped keyword + semantic search. |
| **E19 Billing & Subscriptions** | billing | Plans, metering, **district-consolidated invoicing**. |
| **E20 Security, Audit & Compliance** | security | Hash-chained audit, **RLS isolation tests**, FERPA/GDPR/COPPA. |
| **E21 Mobile (BFF + apps)** | mobile | Core learner flows on mobile. |
| **E22 Platform, CI/CD & Observability** | platform | Pipelines, tracing, local dev, host selection. |
| **E23 Accessibility & i18n** | a11y | WCAG 2.2 AA and localization. |

## Labels

- `type/*` — epic, story, task, bug, spike
- `priority/*` — P0 (critical) … P3 (nice-to-have)
- `area/*` — one per epic domain (tenancy, integration, identity, …)

## Recommended Project board

Create a **GitHub Project (v2)** named **"LMS Delivery"** with these views:

1. **Board** grouped by **Status**: `Backlog → Ready → In progress → In review → Done`.
2. **Table** grouped by **Epic/Area**, showing Priority and Estimate.
3. **Roadmap** grouped by **Milestone** (M0…M5).

Suggested custom fields: **Status** (single-select), **Priority** (P0–P3),
**Estimate** (number, story points), **Epic** (single-select or use the `area/*` label).

### Auto-populate the board
Turn on the project's built-in **"Auto-add to project"** workflow filtered to
`is:issue` in this repo — every seeded issue (and future ones) lands on the board
automatically.

## Seeding / re-seeding

```powershell
# from the repo root, authenticated as the repo owner
pwsh ./scripts/github/seed-backlog.ps1 -Owner AkshatArora7 -Repo lms-saas -CreateProject
```

The seeder is **idempotent by issue title** — edit `backlog.json` and re-run to add
new items without duplicating existing ones. Creating the board via `-CreateProject`
requires the `project` + `read:project` token scopes
(`gh auth refresh -s project,read:project`); without them the issues are still
created and you can attach them with the auto-add workflow above.
