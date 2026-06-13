# SETUP — getting started as a new collaborator

Welcome! This guide takes you from a fresh clone to a running, understood project.
Allow ~30 minutes. If anything here drifts from reality, fix it in the same PR —
docs are part of the code.

**Read first:**
- [`README.md`](README.md) — what we're building and the feature catalogue.
- [`docs/FEATURES.md`](docs/FEATURES.md) — features by audience (schools, admins,
  teachers, students, parents).
- [`AGENTS.md`](AGENTS.md) — **the rules every contributor (human or AI) must
  follow.** Most important: **every feature starts as a user story**, and new
  tenant tables always ship with Row-Level Security.

---

## 1. What this project is (60-second mental model)

A multi-tenant **LMS SaaS** (a D2L Brightspace-class platform) built on
**GitHub + Vercel + serverless** — no AWS/Azure. Three things to internalize:

1. **Monorepo.** One repo, many packages, managed by **pnpm workspaces** +
   **Turborepo**:
   - `apps/` — Next.js `web` and `admin` apps (deploy to **Vercel**).
   - `services/` — **25 Fastify microservices** (one bounded context each;
     containerized to **GHCR**).
   - `packages/` — shared libraries (`db`, `auth`, `events`, `config`, `types`,
     `logger`, `ui`, plus shared `tsconfig`/`eslint-config`).
   - `database/` — `schema.sql` (canonical DDL) + `policies/rls.sql` (tenant
     isolation) + `seed/`.
   - `docs/`, `scripts/` — documentation and tooling (backlog seeder, spec
     generator).
2. **Multi-tenant with sub-tenants.** A district is a *parent* tenant; its schools
   are *sub-tenants*. Every tenant-scoped table carries `tenant_id` and is guarded
   by **Postgres Row-Level Security**. See [`docs/MULTI_TENANCY.md`](docs/MULTI_TENANCY.md).
3. **Event-driven.** Services write a transactional **outbox** row in the same DB
   transaction as a change; **QStash** relays events to consumers (inbox +
   idempotency for exactly-once).

For the full picture: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and the
per-service specs in [`docs/services/`](docs/services).

---

## 2. Prerequisites

| Tool | Version | Notes |
| ---- | ------- | ----- |
| **Node.js** | **20.x** (see [`.nvmrc`](.nvmrc)) | `nvm use` picks it up. Must be ≥ 20. |
| **pnpm** | **9.x** (repo pins `pnpm@9.12.0`) | `corepack enable` then `corepack prepare pnpm@9.12.0 --activate`. |
| **Git** | any recent | |
| **PostgreSQL** | 15+ | Local install, Docker, or a free **Neon** project. Needs `psql` on PATH to apply the raw schema. |
| **GitHub CLI** (`gh`) | optional | Only needed to seed the backlog / project board. |

Optional accounts for full feature work (not needed to build/test): Neon, Vercel,
Upstash (Redis + QStash), Vercel Blob, a CIAM (WorkOS/Auth0), Groq.

> **Windows note.** Keep `.ps1` scripts ASCII-only and read JSON with
> `Get-Content -Raw -Encoding UTF8` (Windows PowerShell 5.1 quirk). See
> [`AGENTS.md`](AGENTS.md) §3.

---

## 3. First-time setup

```bash
# 1. Clone
git clone https://github.com/AkshatArora7/lms-saas.git
cd lms-saas

# 2. Use the right Node + pnpm
nvm use                      # Node 20 (from .nvmrc)
corepack enable
corepack prepare pnpm@9.12.0 --activate

# 3. Install all workspace dependencies
pnpm install

# 4. Create your local env file
cp .env.example .env         # then edit values (see §4)

# 5. Generate the Prisma client
pnpm db:generate
```

You can already **build, lint, typecheck and test** at this point (these don't
need a live database):

```bash
pnpm typecheck
pnpm lint
pnpm build
pnpm test
```

---

## 4. Environment variables

Copy [`.env.example`](.env.example) → `.env` and fill what you need. For local
build/test you can leave most blank. The ones that matter to actually run things:

| Variable | Why | For local dev |
| -------- | --- | ------------- |
| `DATABASE_URL` | Pooled Postgres connection (serverless runtime) | your local/Neon DB URL |
| `DIRECT_URL` | Direct connection for migrations / raw SQL | same DB, no pgbouncer |
| `CONTROL_PLANE_DATABASE_URL` | Tenant registry / silo routing | can equal `DATABASE_URL` locally |
| `JWT_SECRET`, `JWT_ISSUER`, `JWT_AUDIENCE` | Token signing/verification | any dev values |
| `TENANT_MODE`, `DEFAULT_TENANT_TIER` | Tenancy behaviour | leave defaults (`hybrid` / `pool`) |
| `*_URL` (service ports 4000-4024) | Gateway routing between services | leave defaults |

Feature-specific (only when working on those areas): `NEON_API_KEY`,
`BLOB_READ_WRITE_TOKEN`, `UPSTASH_*`, `QSTASH_*`, `CIAM_*`, `GROQ_API_KEY`.

**Never commit `.env` or real secrets.** Production secrets live in Vercel /
GitHub Actions secrets.

---

## 5. Database setup

The **canonical schema is raw SQL** in [`database/schema.sql`](database/schema.sql),
with tenant isolation in [`database/policies/rls.sql`](database/policies/rls.sql).
Apply them with `psql` against your `DIRECT_URL`:

```bash
psql "$DIRECT_URL" -f database/schema.sql
psql "$DIRECT_URL" -f database/policies/rls.sql
```

Then seed development data via the `db` package:

```bash
pnpm db:seed
```

Prisma is used by the services (client + migrations live in
[`packages/db/prisma/`](packages/db/prisma)):

```bash
pnpm db:generate      # regenerate the Prisma client (after schema changes)
pnpm db:migrate:dev   # create/apply a dev migration
pnpm db:migrate       # apply migrations (deploy/CI)
```

> **Isolation matters.** The app connects as a **non-superuser** role (no
> `BYPASSRLS`) so RLS actually enforces tenant separation. When you add a new
> tenant-scoped table, add it to the `tenant_tables` list in `rls.sql` in the same
> change, and validate the SQL parses:
> ```bash
> python -c "import pglast; pglast.parse_sql(open('database/schema.sql',encoding='utf-8').read()); print('ok')"
> ```

---

## 6. Running the project

```bash
pnpm dev        # Turborepo runs the apps + services together
```

Services listen on ports **4000–4024** (see the `*_URL` entries in `.env`); the
`gateway` is the front door at `4000`. Each service exposes `GET /health`.

Run a single workspace instead of everything:

```bash
pnpm --filter @lms/identity dev      # one service
pnpm --filter web dev                # the web app
```

---

## 7. Everyday commands

| Command | What it does |
| ------- | ------------ |
| `pnpm dev` | Run apps + services (watch mode) |
| `pnpm build` | Build everything (Turborepo, cached) |
| `pnpm test` | Run all tests |
| `pnpm lint` | ESLint (flat config) across the repo |
| `pnpm typecheck` | TypeScript, no emit |
| `pnpm format` / `pnpm format:check` | Prettier write / check |
| `pnpm --filter <pkg> <script>` | Run a script in one workspace |
| `pnpm db:generate` / `db:seed` / `db:migrate(:dev)` | Database tasks |
| `pnpm clean` | Clean build outputs + `node_modules` |

Tip: Turborepo caches build/test/lint — re-running is fast when nothing changed.

---

## 8. How we work (read before your first PR)

The full rules are in [`AGENTS.md`](AGENTS.md). The essentials:

1. **Story-first.** Every feature begins as a **user story** in
   [`docs/backlog/backlog.json`](docs/backlog/backlog.json), seeded as a GitHub
   issue, *then* implemented. Reference the issue in your commit
   (e.g. `… (closes #123)`).
2. **Keep isolation provable.** New tenant tables get RLS in the same change;
   validate `schema.sql` with pglast.
3. **Don't hand-edit generated docs.** Per-service specs in `docs/services/` come
   from [`scripts/docs/gen-service-specs.py`](scripts/docs/gen-service-specs.py) —
   edit the script and regenerate.
4. **Conventional Commits** (`feat`, `fix`, `docs`, `chore`, …). **Do not** add a
   `Co-authored-by: Copilot` trailer.
5. **Definition of done:** story linked, acceptance criteria met, RLS for new
   tables, lint/typecheck/build/test green, generated artifacts regenerated, tree
   clean and pushed.

### Project tracking

- Issues, labels and milestones come from `backlog.json` via the **idempotent**
  seeder:
  ```powershell
  # authenticated as the repo owner; gh needs the 'project' scope for -CreateProject
  pwsh ./scripts/github/seed-backlog.ps1 -Owner AkshatArora7 -Repo lms-saas -CreateProject
  ```
  It's idempotent **by issue title** — edit `backlog.json` and re-run to add new
  items without duplicating.
- Work is tracked on the **LMS Delivery** GitHub Project board.

---

## 9. Troubleshooting

| Symptom | Fix |
| ------- | --- |
| `pnpm: command not found` | `corepack enable && corepack prepare pnpm@9.12.0 --activate` |
| Wrong Node version errors | `nvm use` (needs Node 20; see `.nvmrc`) |
| Prisma client errors | `pnpm db:generate` |
| Queries return no rows / RLS blocks you | Ensure a tenant context (`app.tenant_id`) is set; connect as the non-superuser app role. See [`docs/MULTI_TENANCY.md`](docs/MULTI_TENANCY.md). |
| `psql: command not found` | Install the Postgres client tools, or apply schema via CI. |
| Seeder fails on non-ASCII (Windows) | Keep `.ps1` ASCII-only; read JSON with `-Encoding UTF8`. |
| `gh project` "unknown owner type" | Your token lacks the `project` scope: `gh auth refresh -s project,read:project`. |

---

## 10. Where to go next

- **Understand a service** → [`docs/services/`](docs/services) (responsibility,
  tables, endpoints, events, dependencies).
- **Understand tenancy/RLS** → [`docs/MULTI_TENANCY.md`](docs/MULTI_TENANCY.md).
- **Standards (LTI/OneRoster/Caliper)** → [`docs/STANDARDS.md`](docs/STANDARDS.md).
- **Deploy pipeline** → [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).
- **Pick up work** → grab an issue from the **LMS Delivery** board and follow the
  story-first flow.

Welcome aboard! 🎓
