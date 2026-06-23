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

## Custom domains: white-label at the edge

A school can serve the learner web app from its **own domain** — a platform
subdomain (`school.lms.app`) or its own apex/subdomain (`learn.school.edu`). The
domain attachment is a **Vercel dashboard / DNS action** (there is no committed
`vercel.json` — domain binding is configured in Vercel, not in the repo). The app
then resolves the tenant from the request `Host` **at the edge** and renders that
tenant's **effective (inheritance-resolved) branding**.

**1. Attach the domain in Vercel** (web project → Settings → Domains → **Add**):

- **Platform subdomains** (`*.lms.app`): add a **wildcard domain** `*.lms.app` to
  the web project and point a wildcard DNS `CNAME` (`*.lms.app` →
  `cname.vercel-dns.com`) so every school subdomain hits this deployment.
- **A school's own domain** (`learn.school.edu`): add it as a domain on the web
  project; Vercel shows the exact `CNAME`/`A` record the school must create at its
  DNS provider, then issues the TLS certificate once the record resolves.

**2. Set the web project's environment variables** (Vercel → web project →
Environment Variables):

| Env | Purpose | Default |
| --- | --- | --- |
| `APP_DOMAIN` | The platform's **first-party** domain. Requests on this host (or any subdomain of it) skip the by-domain lookup and use the session/pinned tenant; only genuinely custom hosts trigger resolution. | `localhost` |
| `TENANT_SERVICE_URL` | Base URL the edge middleware calls for the host→tenant lookup. | `http://localhost:4002` |

**3. How resolution works at runtime** (no extra config):

1. Edge middleware (`apps/web/middleware.ts`) reads the request `Host`. A
   first-party host (`APP_DOMAIN` or its subdomains, plus localhost) is skipped.
2. For a custom host it calls the tenant service
   `GET /tenants/by-domain/:host` (pre-auth, control-plane) at `TENANT_SERVICE_URL`,
   which resolves `tenant_branding.custom_domain` → an opaque `tenantId` (404 if
   no tenant claims the host).
3. The resolved id is forwarded to the server layer on the `x-lms-tenant` request
   header (any inbound copy of that header is **stripped first** — anti-spoof).
4. The root layout resolves that tenant's **effective branding** and applies it,
   so the custom-domain landing/login screen already carries the school's brand
   **before any session exists**.

Effective branding follows the precedence **sub-tenant override → parent
(district) default → platform default** (`tenant_effective_branding()` walks the
parent chain). If the lookup fails or the service is unreachable, the app falls
back to the default brand and never blocks navigation. See the
[tenant service spec](services/tenant.md) for the endpoint contract.

## Services on a container host

`deploy-services.yml` publishes `ghcr.io/<owner>/<repo>/<service>:{sha,latest}`.
Point your container host at these images (one app per service) with the same env
contract (`.env.example`). Scale workers (enrollment, notification, video) on
queue depth.

## Production service exposure (internal-only)

**Policy.** In production only **three** services are publicly reachable: the
**gateway** (`:4000`), the **web** app (`:3000`) and the **admin** console
(`:3001`). Every domain microservice (`identity` … `relay`) **and** the
datastores (`postgres`, `redis`) stay on the internal network with **no
published host ports** — they are reachable only service-to-service by DNS name
(e.g. `http://identity:4001`).

**Why this matters ([ADR-0027](ADR-0027-trusted-identity-headers.md)).** The
gateway is the **single trust boundary**: it strips any client-supplied
`x-user-id` / `x-user-roles` / `x-tenant-id` headers and re-stamps them from the
verified JWT claims. If a domain service were directly reachable on an untrusted
network, a caller could **spoof those identity headers** and bypass
authentication/authorization. Keeping every domain service internal-only closes
that header-spoofing vector — there is no public path that skips the gateway.

**How to run production (compose host).** Layer the prod override on the
canonical compose file:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
docker compose -f docker-compose.yml -f docker-compose.prod.yml down
```

`docker-compose.prod.yml` resets `ports` to an empty list for every service
**except** gateway/web/admin and adds an informational `expose:` of each
service's own internal port (self-documentation only — intra-bridge reachability
does not require it). Because Compose **merges `ports` lists by appending**, a
plain `ports: []` would *not* drop the base publish; the override uses the
Compose **`!override`** tag (`ports: !override []`), which **requires Docker
Compose v2.24+** to force the empty list to fully replace the inherited value.
On older Compose the tag is unknown and the host ports would remain published —
verify your Compose version (`docker compose version`) before relying on this
override.

> **Forgetting the second `-f` silently leaves all ports public.** The two-file
> command is the production contract; the base `docker-compose.yml` alone is
> dev-only (next paragraph).

**Dev is intentionally different.** Running `docker compose up -d` with the base
file alone keeps every service's `40xx` host port published for direct local
inspection. That is a deliberate dev-only convenience on a trusted local network
— see the *Local vs prod exposure* note in the local-development section below.

**Relationship to the Fly private mesh.** On the managed production target
(Fly.io) east-west traffic already stays private over the **6PN WireGuard mesh +
`.internal` DNS** with zero public hops (see *Container host decision* →
*Networking* below). The `docker-compose.prod.yml` override is the equivalent
control for **compose-based / self-hosted container hosts** that lack that
private mesh. There are **no Kubernetes/Helm manifests** in this repo, so these
two mechanisms — the Fly private mesh and the compose override — are the entire
production exposure story; nothing else needs to change.

## Container host decision

> **Decided 2026-06-22 (SPIKE [#85]):** **Fly.io is the primary container host.
> Render is the documented runner-up. Railway is not recommended as primary.**
> See [ADR-0032](ADR-0032-container-host-flyio.md) for the full record; the deploy
> mechanism this implies is built in [#81]. Vendor specifics tagged **(verify)** must
> be re-confirmed against current vendor docs at implementation time (#81); they move.

### Comparison matrix — Fly.io vs Render vs Railway

| Dimension | **Fly.io** | **Render** | **Railway** |
| --- | --- | --- | --- |
| **Pricing model** | Per-machine, per-second usage-based; pay only while a Machine runs. shared-cpu-1x/256MB is ~$2–3/mo if always-on, ~$0 idle with scale-to-zero. **(verify current rates)** | Per-service flat tier — Starter instance ~$7/mo each, always-on; bigger tiers for CPU/RAM. Background Workers priced same as services. **(verify)** | Usage-based (vCPU-min + GB-min) on top of a ~$5/mo seat; metered, can be cheap when idle but spiky under load. **(verify)** |
| **Rough cost @ this scale** (27 services, mostly idle + 1 heavy video worker) | **Lowest.** Scale-to-zero on the ~24 idle/low-traffic services → only gateway/identity + active workers + the video machine cost real money. Est. **~$100–250/mo** depending on idle ratio + video class. | **Highest floor.** ~24 always-on services × ~$7 ≈ **~$170/mo minimum** before the video worker (needs a larger, pricier instance) — no scale-to-zero on paid tiers, so you pay for idle. | **Variable**; could undercut Render when idle, but US-West metal + metered model makes the heavy video worker and steady gateway costs less predictable. |
| **Cold start / scale-to-zero** | **Native.** Machines `auto_stop`/`auto_start` on request; stopped Machine resumes in ~sub-second to a few hundred ms **(verify)**. Ideal for the long tail of rarely-hit domain services. | No scale-to-zero on paid; **free tier spins down** (cold ~tens of seconds) but free tier is unsuitable for prod. Effectively always-on → no cold start, but no idle savings. | App **sleeping** on hobby/idle; wake latency exists. Less granular than Fly per-machine control. **(verify)** |
| **Region coverage / Neon+Vercel co-location** | Global incl. **iad (Ashburn, us-east-1 adjacent)**, plus EU ams/fra/cdg. iad co-locates with Neon us-east-1 and Vercel iad1 → meets read p95<300ms. EU regions ready for EU tenant silos. | Regions incl. **Virginia (us-east-1)**, Ohio, Oregon, Frankfurt, Singapore. Virginia co-locates well with Neon us-east. **(verify region set)** | Metal regions limited — **US-West**, EU **Amsterdam**, SE-Asia. **US-West is NOT co-located with Neon us-east-1** → adds cross-country RTT to every DB call; weakest fit for the latency target. **(verify)** |
| **Horizontal + worker scaling** | Per-process-group machine counts; **metrics-driven autoscaling via `fly-autoscaler`** (reads an external metric e.g. Upstash/QStash queue depth → scales worker Machines), plus scale-to-zero. Fits queue-scaled enrollment/notification/relay. **(verify fly-autoscaler is the current path)** | **Native autoscaling on CPU/RAM** only — **no native queue-depth autoscaling**; queue-driven workers would need a custom metric→API loop. No scale-to-zero. | Horizontal replicas + automatic vertical scaling; **no native queue-depth autoscaling**; custom scaling via GraphQL API. **(verify)** |
| **Heavy native workload fit (FFmpeg video worker)** | **Strong.** Dedicated `performance` CPU Machine classes, large RAM, attachable Volumes for scratch, long-running jobs, per-app machine sizing — video can be its own app/machine class isolated from web services. | OK — larger instance tiers exist, but always-on cost for a heavy box is high and instance sizing is coarser; disk for scratch via persistent disks. **(verify max class)** | Possible via larger plans, but metered heavy-CPU on US-West is the least attractive cost+latency combo. |
| **GHCR image pull** | `flyctl deploy --image ghcr.io/...` pulls a prebuilt image directly — **no rebuild on host**; matches our GHCR pipeline 1:1. Public GHCR pulls cleanly; **private GHCR needs registry creds passed to the deploy — verify mechanism**. | Supports **"Deploy an existing image"** from external registries incl. GHCR (registry credentials in dashboard/Blueprint). **(verify private-GHCR auth path)** | Supports deploying a Docker image / from registry; GHCR via image source. **(verify private auth)** |
| **Secrets / env management** | `flyctl secrets set` per app (encrypted, injected as env, triggers redeploy). Runtime secrets live in Fly, not GitHub. | **Env Groups** shared across services + per-service env vars (dashboard/Blueprint). | Project/service variables + shared variable groups; references between services. |
| **GitHub Actions deploy + approval-gate fit** | Deploy is a plain `flyctl deploy` CLI step → wraps cleanly in a **GitHub Environment** job with required reviewers. Needs `FLY_API_TOKEN`. Mirrors the Vercel "skip-if-secret-absent" pattern. | **Deploy Hooks** (curl a per-service URL) or **Blueprint** sync; works inside an Environment-gated job. Needs deploy-hook URLs / API key. | CLI (`railway up`) / GraphQL API in an Environment-gated job. Needs `RAILWAY_TOKEN`. Enterprise/approval maturity weaker. |
| **Networking (private mesh / internal DNS)** | **6PN private WireGuard mesh + `.internal` DNS** (`<app>.internal`, `<region>.<app>.internal`) → gateway→service east-west stays private, no public hop. Strong for a 27-service mesh. | **Private Services + private network** within a region (internal hostnames); cross-region private networking more limited. **(verify)** | **Private networking** with internal hostnames between services in a project. **(verify maturity)** |
| **Observability hooks** | Built-in **Prometheus metrics + Grafana**, log shipping/OTel export, healthchecks. | Built-in metrics + logs; log streams/drains. | Built-in metrics + logs; less depth. |
| **DX / maturity** | Mature, container/microservice-native, deep CLI + Machines API; ops surface is larger (you manage machines/regions). | Very polished managed DX; least ops; opinionated. | Best prototyping DX; smallest of the three; enterprise features thinnest. |

### Rationale

Fly.io is the only one of the three that simultaneously satisfies every hard
constraint of this system:

1. **Cost at our shape** — 27 services where the great majority are idle/low-traffic.
   Fly's per-second billing + native **scale-to-zero** means we pay for the
   gateway/identity hot path + active workers + the video machine, not 24 idle boxes.
   Render's flat ~$7/always-on-service floor (~$170/mo before video) penalizes exactly
   our long-tail topology.
2. **Heavy FFmpeg video worker** — Fly gives it a **dedicated app + `performance`
   machine class + Volume scratch + long-running jobs**, isolated from the
   latency-sensitive web tier. Best native-workload fit of the three.
3. **Queue-scaled workers** — enrollment/notification/relay scale on **queue depth**,
   which maps to `fly-autoscaler` (external-metric driven) + scale-to-zero.
   Render/Railway autoscale on CPU/RAM only — the wrong signal for
   outbox-drain/notification fan-out.
4. **Latency / co-location** — Fly **iad** sits with Neon us-east-1 and Vercel iad1,
   protecting read p95<300ms / write p95<800ms. Railway's US-West metal fails this;
   Render Virginia matches but loses on the cost+scaling axes above.
5. **GHCR pulls** — `flyctl deploy --image ghcr.io/...` consumes our existing
   `:sha`/`:latest` images **without rebuilding** — a clean seam onto
   `deploy-services.yml`.
6. **Approval-gated envs** — deploy is a CLI step, so GitHub Environments
   staging→production with required reviewers wrap it trivially (same
   skip-if-secret-absent pattern as Vercel).
7. **Private mesh** — 6PN + `.internal` DNS keeps the 27-service east-west traffic
   private with zero public hops.

**Runner-up: Render.** Choose it instead **if** the team prioritizes minimal ops over
cost/scaling control, accepts always-on per-service pricing, and doesn't need
queue-depth autoscaling. **Switch trigger:** if Fly's machine/region ops burden or
support responsiveness becomes a recurring drag, OR if we consolidate to a handful of
always-on services (the long tail collapses) so flat per-service pricing stops hurting
— Render's Virginia region + managed DX then wins. **Railway is not recommended as
primary** (US-West/Neon-us-east latency, metered cost variance, thinner approval-gate
maturity); fine for throwaway previews only.

### Consequences for deploy (#81)

The per-service deploy pipeline ([#81]) will add a `deploy` job after `build-push` in
`deploy-services.yml` (or a sibling `deploy-fly.yml`):

- **Deploy mechanism (per changed service):**
  `flyctl deploy --image ghcr.io/<owner>/<repo>/<svc>:<sha>` (with
  `--app lms-<svc>-<env> --config services/<svc>/fly.toml --strategy rolling`, or the
  equivalent Machines API) — pulls the prebuilt GHCR image with **no rebuild on host**.
- **Per-service `fly.toml`:** app name, primary region `iad`, internal port,
  `auto_stop_machines`/`auto_start_machines`, a `/health` healthcheck, and machine size;
  the **video** service gets its own `performance` machine class + an attached **Volume**
  for FFmpeg scratch.
- **`FLY_API_TOKEN` guard:** stored as a **GitHub Environment** secret (separate token
  per `staging`/`production`). The deploy job **skips green** when the token is absent so
  PRs aren't blocked before the host is configured — mirroring the Vercel
  "skip-if-secret-absent" pattern above.
- **Runtime secrets live in Fly, not GitHub** — set once per app via
  `flyctl secrets set` (`DATABASE_URL` Neon pooled/RLS + per-tenant Neon branch wiring,
  `UPSTASH_REDIS_REST_URL`/`_TOKEN`, `QSTASH_*`, `BLOB_READ_WRITE_TOKEN`, `GROQ_API_KEY`,
  service-to-service/JWT secrets).
- **Post-deploy `/health` smoke:** after `flyctl deploy`, poll
  `https://lms-<svc>-<env>.fly.dev/health` (or the `.internal` address) until **200** with
  a timeout → fail the deploy on non-200. `staging` auto-deploys on `main`; `production`
  sits behind the GitHub Environment approval gate.

[#81]: https://github.com/AkshatArora7/lms-saas/issues/81
[#85]: https://github.com/AkshatArora7/lms-saas/issues/85

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

`docker-compose.yml` (root) is the **canonical** compose file. There are two ways
to bring the whole platform up — pull prebuilt images, or build everything from
local source:

| | Build from source (collaborators) | Pull prebuilt images (owner / CI) |
| --- | --- | --- |
| **Command** | `pnpm start:build` | `pnpm start` (= `docker compose up -d`) |
| **Raw** | `docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build` | `docker compose up -d` |
| **Needs** | only Docker Desktop + this repo | access to the owner's private GHCR images |
| **Accounts** | **none** | GHCR pull access |

Either way, one command brings up the **entire** platform on one network, wired
together by DNS service names:

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

> **Local vs prod exposure.** The per-service `40xx` host ports are a **dev-only
> convenience**. In production the domain services MUST be **internal-only** —
> reachable only via the gateway (or the trusted web BFF) — otherwise a direct
> caller could self-stamp trusted identity headers and bypass the gateway. See
> [ADR-0027](ADR-0027-trusted-identity-headers.md) and the deployment-hardening
> follow-up (#295).

**Demo logins** (seeded automatically on first boot, at `/login`):
`admin@demo.school` or `student@demo.school`, password `password123`.

**Tear down:**

```bash
pnpm down       # stop the stack, KEEP the Postgres data (= docker compose down)
pnpm down:clean # stop AND wipe the Postgres volume (re-seeds next up; = down -v)
pnpm ps         # container status   ·   pnpm logs   # tail logs
```

> **First run builds ~29 images** on the build-from-source path (26 services +
> seed + web + admin) and can take a while; later runs are cached.

### Database: bundled Postgres by default, Supabase opt-in

By default the mesh runs against the **in-compose Postgres**, which
**auto-applies** `database/schema.sql` then `database/policies/rls.sql` on first
boot via `/docker-entrypoint-initdb.d` — so tenant RLS is enforced with **zero
external setup**.

> **⚠️ Collaborators: leave the DB URLs empty.** For the local Docker run keep
> `DATABASE_URL` / `MIGRATION_DATABASE_URL` / `DIRECT_URL` /
> `CONTROL_PLANE_DATABASE_URL` **empty in `.env`** (that is how `.env.example`
> ships them) so the bundled `postgresql://app_user:app_user@postgres:5432/lms`
> fallback is used. ANY non-empty value overrides the `${VAR:-default}`
> interpolation and points the mesh away from the bundled DB.

To point the whole mesh at Supabase (or any external Postgres), set
`DATABASE_URL` in `.env` (gitignored; Compose reads it automatically for
`${VAR}` interpolation); `DIRECT_URL` and `CONTROL_PLANE_DATABASE_URL` fall back
to it. A remote deploy also wants the **three-role model** that makes
`FORCE ROW LEVEL SECURITY` actually enforce (#290 + #291; see
[ADR-0026](ADR-0026-runtime-app-role-rls-enforcement.md) and `SETUP.md` §5):
`MIGRATION_DATABASE_URL` → the privileged **owner/migrator** role (`lms`; DDL +
seeds only, never runtime), `DATABASE_URL` → the least-privilege **runtime app**
role (`app_user`, `NOSUPERUSER NOBYPASSRLS`, SELECT-only on the control-plane
tables), and `CONTROL_PLANE_DATABASE_URL` → the dedicated **control-plane** role
(`control_plane_user`, `NOSUPERUSER NOBYPASSRLS` with a narrow control-plane
write set) — set it explicitly for a hardened deploy rather than letting it fall
back to the `app_user` `DATABASE_URL`.
`JWT_SECRET` and `GROQ_API_KEY` are likewise sourced from `.env` — the in-compose
`JWT_SECRET` fallback is a **dev-only** placeholder, so set a real one before any
real deployment.

> **Supabase + IPv4:** the direct `db.<ref>.supabase.co` host is IPv6-only. On
> IPv4-only or serverless networks, use the Supabase **connection pooler**
> (Supavisor) URL — `...pooler.supabase.com:6543?pgbouncer=true`.

See [docs/RUNBOOK-prod-db-roles.md](RUNBOOK-prod-db-roles.md) for the prod
provisioning + verification steps (create `app_user`, apply `database/roles.sql`,
set the DSNs, and verify cross-tenant isolation on the live DB).

### Images: GHCR by default, build-from-source override

A bare `docker compose up -d` (`pnpm start`) defaults the gateway, the 26
services, `web` and `admin` to the owner-built GHCR images
`ghcr.io/akshatarora7/lms-saas/<name>:latest` and **pulls** them on first run —
which requires access to those (private) images.

Collaborators who can't pull GHCR — or who want to run the **current source** —
build every image locally with the **`docker-compose.build.yml` override**:

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
# shortcut:
pnpm start:build
```

The override adds **only** a `build:` block (context `.` + each service's
existing `services/<name>/Dockerfile`) to all 29 buildable services (26
microservices + `seed` + `web` + `admin`). Compose deep-merges it onto the base
file, so every service keeps its base env / ports / `depends_on` / healthcheck
and its existing `image:` tag — the locally built image is just tagged with that
same name.

### Topology & teardown

Every service `depends_on` Postgres being healthy, so they start only after the
schema + RLS are applied. `web` and `admin` additionally `depends_on` (healthy)
exactly the services they call server-side — `web` waits on identity, enrollment,
assignment, discussion, announcement and attendance; `admin` waits on identity
and course — so first page loads don't 502. The apps' server-side `*_URL` env
points at compose DNS names (e.g. `IDENTITY_URL=http://identity:4001`).

```bash
pnpm down       # stop the stack, keep data (= docker compose down)
pnpm down:clean # also wipe the Postgres volume — re-applies schema + re-seeds next up (= down -v)
pnpm logs       # tail logs   ·   pnpm ps   # container status
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
