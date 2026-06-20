# Deployment

CI/CD is **GitHub Actions**. The Next.js apps deploy to **Vercel**; the
microservices build to container images on **GHCR** and run on a container host
(Fly.io / Render / Railway). Databases are **Neon Postgres**.

## Pipelines

| Workflow                       | Trigger                                  | Does                                                            |
| ------------------------------ | ---------------------------------------- | -------------------------------------------------------------- |
| `.github/workflows/ci.yml`     | push / PR to `main`,`develop`            | install → Prisma generate → apply `schema.sql` + RLS to a CI Postgres → lint → typecheck → build → test |
| `deploy-web.yml`               | push/PR to `main` (apps/packages changed)| Vercel build + deploy (`web`,`admin`); preview on PR, prod on `main` |
| `deploy-services.yml`          | push to `main` (services/packages changed)| path-filtered matrix → build & push changed service images to GHCR |
| `db-migrate.yml`               | manual / push (db artifacts changed)     | `prisma migrate deploy` + apply RLS policies (env-gated)        |

## Vercel setup

The **Deploy Web (Vercel)** job **skips cleanly** (green, not failed) until the
Vercel secrets below are present — so PRs are not blocked before deploy is
configured. To enable real preview/production deploys:

**1. Create two Vercel projects** (one per app) by importing this repo twice,
each with **Root Directory** set to `apps/web` / `apps/admin` (Next.js framework
preset; Vercel detects the pnpm/Turbo workspace).

**2. Collect the values:** a token from
<https://vercel.com/account/tokens>, the **Org/Account ID** (Vercel → Settings →
General), and each **Project ID** (project → Settings → General).

**3. Set the GitHub repo secrets** with the helper (uses the GitHub CLI):

```powershell
pwsh ./scripts/vercel/set-secrets.ps1 `
  -VercelToken <token> -OrgId <team_or_account_id> `
  -ProjectIdWeb <prj_web_id> -ProjectIdAdmin <prj_admin_id>
```

This sets the four required secrets:

```
VERCEL_TOKEN
VERCEL_ORG_ID
VERCEL_PROJECT_ID_WEB
VERCEL_PROJECT_ID_ADMIN
```

**4.** Open/update a PR (preview) or merge to `main` (production) to trigger a
deploy.

Set runtime env (DATABASE_URL, JWT_SECRET, BLOB_READ_WRITE_TOKEN, UPSTASH_*,
GROQ_API_KEY, CIAM_*) in each Vercel project's Environment Variables.

## Services on a container host

`deploy-services.yml` publishes `ghcr.io/<owner>/<repo>/<service>:{sha,latest}`.
Point your container host at these images (one app per service) with the same env
contract (`.env.example`). Scale workers (enrollment, notification, video) on
queue depth.

## Scheduled / background work

Replaces Azure Functions + Hangfire with serverless schedules:

- **QStash schedules** — SIS sync, report generation, grade recalc, outbox relay.
- **GitHub Actions cron** — periodic maintenance / housekeeping.
- **Vercel Cron** — light app-side periodic tasks.

## Secrets

- **GitHub Actions**: repo/environment secrets (`DATABASE_URL`, `DIRECT_URL`,
  `VERCEL_*`, registry creds).
- **Vercel**: per-project encrypted env vars.
- **Silo DSNs**: stored in a secret store and referenced by
  `tenant.database_ref` — never committed.

## Environments

`db-migrate.yml` uses GitHub **Environments** (`staging`, `production`) for
approval gates and environment-scoped secrets. Promote with canary/weighted
rollout and roll back on SLO breach.

## Run the full app in one command (Docker)

`docker-compose.yml` (root) is the **canonical** compose file: a bare

```bash
docker compose up -d   # or: pnpm start
```

brings up the **entire** platform on one network, wired together by DNS service
names:

- **Postgres** (`pgvector/pgvector:pg15`, port 5432) and **Redis**
  (`redis:7-alpine`, port 6379) — both always up (not behind a profile).
- **gateway** on **4000** (authenticated `/api/:service/*` edge).
- the **26 services** on **4001-4025** — identity 4001, tenant 4002, user-org
  4003, enrollment 4004, course 4005, content 4006, assignment 4007, assessment
  4008, grading 4009, discussion 4010, announcement 4011, notification 4012,
  calendar 4013, rubric 4014, analytics 4015, reporting 4016, ai 4017, lti 4018,
  sis 4019, video 4020, search 4021, billing 4022, audit 4023, mobile-bff 4024,
  attendance 4025.
- the **web app** on **3000** and the **admin console** on **3001**.

Public surfaces: <http://localhost:3000> (web), <http://localhost:3001> (admin),
<http://localhost:4000> (gateway). Each service is also published on its own
`40xx` port for direct inspection.

### Database: bundled Postgres by default, Supabase opt-in

By default the mesh runs against the **in-compose Postgres**, which
**auto-applies** `database/schema.sql` then `database/policies/rls.sql` on first
boot via `/docker-entrypoint-initdb.d` — so tenant RLS is enforced with **zero
external setup**. To point the whole mesh at Supabase (or any external Postgres),
set `DATABASE_URL` in `.env` (gitignored; Compose reads it automatically for
`${VAR}` interpolation); `DIRECT_URL` and `CONTROL_PLANE_DATABASE_URL` fall back
to it. `JWT_SECRET` and `GROQ_API_KEY` are likewise sourced from `.env` — the
in-compose `JWT_SECRET` fallback is a **dev-only** placeholder, so set a real one
before any real deployment.

> **Supabase + IPv4:** the direct `db.<ref>.supabase.co` host is IPv6-only. On
> IPv4-only or serverless networks, use the Supabase **connection pooler**
> (Supavisor) URL — `...pooler.supabase.com:6543?pgbouncer=true`.

### Images: GHCR by default, local build fallback

The gateway, the 26 services, `web` and `admin` all default to the owner-built
GHCR images `ghcr.io/akshatarora7/lms-saas/<name>:latest` (built and published
from this repo). A bare `up` **pulls** them on first run. To **build** the images
locally instead, uncomment the `build:` block kept above each `image:` line in
`docker-compose.yml`.

### Topology & teardown

Every service `depends_on` Postgres being healthy, so they start only after the
schema + RLS are applied. `web` and `admin` additionally `depends_on` (healthy)
exactly the services they call server-side — `web` waits on identity, enrollment,
assignment, discussion, announcement and attendance; `admin` waits on identity
and course — so first page loads don't 502. The apps' server-side `*_URL` env
points at compose DNS names (e.g. `IDENTITY_URL=http://identity:4001`).

```bash
docker compose down       # stop the stack (or: pnpm stop)
docker compose down -v    # also wipe the Postgres volume (re-applies schema next up)
pnpm logs                 # tail logs
```

### Infra-only stack (integration tests)

The lightweight Postgres + Redis stack used by the integration tests lives in
`docker-compose.infra.yml`:

```bash
docker compose -f docker-compose.infra.yml up -d
docker compose -f docker-compose.infra.yml down -v
```

## Local development (hot reload)

For iterating on the apps and services with hot reload instead of containers:

```bash
pnpm install
cp .env.example .env             # fill in DATABASE_URL, JWT_SECRET, etc.
pnpm db:generate                 # Prisma client

# Apply the canonical schema + RLS to your DB once (Supabase example):
#   psql "$DIRECT_URL" -f database/schema.sql
#   psql "$DIRECT_URL" -f database/policies/rls.sql

pnpm db:seed
pnpm dev                         # turbo runs apps + services with hot reload
```

## Performance targets (validate with load tests)

read APIs p95 < 300 ms · write APIs p95 < 800 ms · LTI launch < 1.5 s ·
quiz-attempt write < 200 ms · availability ≥ 99.9%.
