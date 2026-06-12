# LMS SaaS — Multi-Tenant Learning Platform

An enterprise, multi-tenant **LMS SaaS** (a D2L Brightspace–class platform) built
on a **GitHub + Vercel + serverless** stack. It implements a **hybrid pool/silo**
tenancy model and the **1EdTech** interoperability standards (LTI 1.3/Advantage,
OneRoster 1.2, Caliper/xAPI) that institutional procurement requires.

> The reference architecture (see `/docs`) was adapted from an Azure + .NET
> blueprint and **re-platformed onto GitHub + Vercel + serverless equivalents**
> per project direction (no AWS/Azure). The domain design — ~25 services, hybrid
> tenancy, event-driven analytics, 1EdTech standards — is preserved.

## Stack

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

## Repository layout

```
apps/
  web/            Next.js learner/instructor app (Vercel) — also Web BFF
  admin/          Next.js administration app (Vercel)
services/         25 domain microservices (Fastify; Dockerfile → GHCR)
  gateway identity tenant user-org enrollment course content assignment
  assessment grading discussion announcement notification calendar rubric
  analytics reporting ai lti sis video search billing audit mobile-bff
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
docs/             Architecture, multi-tenancy, deployment, standards, diagrams
.github/workflows CI, deploy-web, deploy-services, db-migrate
```

## Quick start

```bash
pnpm install
cp .env.example .env            # fill in DATABASE_URL, JWT_SECRET, etc.
pnpm db:generate                # Prisma client
# Apply canonical schema + RLS (needs a Postgres + psql, or run via CI):
#   psql "$DIRECT_URL" -f database/schema.sql
#   psql "$DIRECT_URL" -f database/policies/rls.sql
pnpm db:seed
pnpm dev                        # turbo runs apps + services
```

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — services, request path, Azure→Vercel mapping
- [`docs/MULTI_TENANCY.md`](docs/MULTI_TENANCY.md) — pool/silo/hybrid, RLS, catalog, migration
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — pipelines, Vercel, GHCR, cron, secrets
- [`docs/STANDARDS.md`](docs/STANDARDS.md) — LTI 1.3/Advantage, OneRoster 1.2, Caliper/xAPI
- [`docs/diagrams/`](docs/diagrams) — draw.io diagrams (open at app.diagrams.net)

## Roadmap (phased)

1. **Phase 1 (MVP)** — pool only; core 8 services (Identity, Tenant, User&Org,
   Enrollment, Course, Content, Assignment, Gradebook); ship the **LTI 1.3
   platform** early. Exit: one tenant fully functional end to end.
2. **Phase 2** — Quiz, Discussion, Notification, Calendar, SIS (OneRoster 1.2),
   Search, Analytics (Caliper LRS); stand up the tenant catalog so the **silo**
   path is ready; reach **SOC 2 Type II** readiness.
3. **Phase 3** — AI/Lumi (RAG), Video, Billing, Rubric/Competency, Audit; introduce
   the **silo** tier for the first large enterprise/HE tenant.
