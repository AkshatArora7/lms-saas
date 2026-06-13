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

## Local development

```bash
pnpm install
cp .env.example .env
# Bring up Postgres + Redis locally (compose file optional), then:
psql "$DIRECT_URL" -f database/schema.sql
psql "$DIRECT_URL" -f database/policies/rls.sql
pnpm db:seed
pnpm dev
```

## Performance targets (validate with load tests)

read APIs p95 < 300 ms · write APIs p95 < 800 ms · LTI launch < 1.5 s ·
quiz-attempt write < 200 ms · availability ≥ 99.9%.
