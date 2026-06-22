# ADR-0032 — Container host: Fly.io (Render runner-up, Railway not recommended as primary)

- **Status:** Accepted · 2026-06-22
- **Issue:** #85 — Choose container host (Fly vs Render vs Railway) — SPIKE under Epic #80
- **Owning scope:** platform CI/CD — the microservice container host (`deploy-services.yml` → host); docs
- **Author:** Architect agent (recorded by docs-agent)

> See also the [Container host decision](DEPLOYMENT.md#container-host-decision) section in
> `docs/DEPLOYMENT.md` for the same decision in deployment-runbook form. Vendor specifics
> tagged **(verify)** below must be re-confirmed against current vendor docs at
> implementation time (#81); they move.

## Context

The microservices build to container images on **GHCR** —
`deploy-services.yml` publishes `ghcr.io/<owner>/<repo>/<service>:{sha,latest}` for the
27 service Dockerfiles under `services/*/Dockerfile` (gateway, identity, the domain
services, the `enrollment`/`notification`/`relay` workers, and the heavy native `video`
worker). **It only builds & pushes to GHCR today — there is no deploy-to-host step yet**;
#81 will add that step using the host chosen here. Every reference across the repo
(`README.md`, `docs/ARCHITECTURE.md`, `docs/DEPLOYMENT.md`, the backlog) has so far left
the host as an undecided "Fly.io / Render / Railway" set; this ADR records the decision.

The decision is shaped by the platform's hard constraints:

- **Re-platformed onto GitHub + Vercel + serverless — explicitly NO AWS, NO Azure.**
  The Next.js apps deploy to **Vercel**; only the container microservices need a host.
- **27 GHCR service images, mostly idle/low-traffic, plus one heavy native worker.**
  The `video` service runs FFmpeg transcode + ASR captioning behind injectable seams
  (ADR-0029) — a heavy native CPU/RAM workload that must run on a container host, not
  serverless, isolated from the latency-sensitive web tier.
- **Co-location with the data plane.** Databases are **Neon Postgres** (shared RLS pool
  DB + per-tenant Neon branch silos); supporting infra is **Upstash Redis/QStash** and
  **Vercel Blob**. The host must reach Neon/Upstash with low latency to protect the SLOs.
- **Queue-scaled workers.** `enrollment`/`notification`/`relay` scale on **queue depth**
  (Upstash/QStash), not CPU/RAM.
- **Approval-gated environments.** `staging` and `production` are GitHub **Environments**
  with approval gates; the deploy must wrap cleanly in an Environment-gated Actions job.
- **Performance SLOs.** read APIs p95 < 300 ms · write APIs p95 < 800 ms · LTI launch
  < 1.5 s · quiz-attempt write < 200 ms · availability ≥ 99.9%.

## Decision

**Fly.io is the primary container host. Render is the documented runner-up. Railway is
not recommended as primary.**

### Comparison matrix — Fly.io vs Render vs Railway (AC1)

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

Fly.io is the only one of the three that simultaneously satisfies every hard constraint
of this system:

1. **Cost at our shape** — 27 services where the great majority are idle/low-traffic.
   Fly's per-second billing + native **scale-to-zero** means we pay for the
   gateway/identity hot path + active workers + the video machine, not 24 idle boxes.
   Render's flat ~$7/always-on-service floor (~$170/mo before video) penalizes exactly
   our long-tail topology.
2. **Heavy FFmpeg video worker** — Fly gives it a **dedicated app + `performance` machine
   class + Volume scratch + long-running jobs**, isolated from the latency-sensitive web
   tier. Best native-workload fit of the three.
3. **Queue-scaled workers** — enrollment/notification/relay scale on **queue depth**,
   which maps to `fly-autoscaler` (external-metric driven) + scale-to-zero. Render/Railway
   autoscale on CPU/RAM only — the wrong signal for outbox-drain/notification fan-out.
4. **Latency / co-location** — Fly **iad** sits with Neon us-east-1 and Vercel iad1,
   protecting read p95<300ms / write p95<800ms. Railway's US-West metal fails this; Render
   Virginia matches but loses on the cost+scaling axes above.
5. **GHCR pulls** — `flyctl deploy --image ghcr.io/...` consumes our existing
   `:sha`/`:latest` images **without rebuilding** — a clean seam onto `deploy-services.yml`.
6. **Approval-gated envs** — deploy is a CLI step, so GitHub Environments staging→production
   with required reviewers wrap it trivially (same skip-if-secret-absent pattern as Vercel).
7. **Private mesh** — 6PN + `.internal` DNS keeps the 27-service east-west traffic private
   with zero public hops.

## Consequences

### What #81 (per-service deploy → host) builds

- **Deploy mechanism:** add a `deploy` job after `build-push` in `deploy-services.yml` (or
  a sibling `deploy-fly.yml`) that, per changed service, runs:
  `flyctl deploy --app lms-<svc>-<env> --image ghcr.io/<owner>/<repo>/<svc>:<sha> --config services/<svc>/fly.toml --strategy rolling`
  (or the equivalent Machines API).
- **Per-service `fly.toml`:** app name, primary region `iad`, process group, internal port,
  `auto_stop_machines`/`auto_start_machines`, a `/health` healthcheck, and machine size; the
  **video** service gets its own `performance` machine class + an attached Volume for FFmpeg
  scratch.
- **`FLY_API_TOKEN` guard:** an org- or app-scoped deploy token stored as a **GitHub
  Environment** secret (a separate token per `staging`/`production` env). The deploy job must
  **skip green** when it is absent so PRs aren't blocked before the host is configured —
  mirroring the existing Vercel "skip-if-secret-absent" pattern.
- **Runtime secrets live in Fly, not GitHub** — set once per app via `flyctl secrets set`
  (`DATABASE_URL` Neon pooled/RLS + per-tenant Neon branch wiring,
  `UPSTASH_REDIS_REST_URL`/`_TOKEN`, `QSTASH_*`, `BLOB_READ_WRITE_TOKEN`, `GROQ_API_KEY`,
  service-to-service/JWT secrets). #81 documents the required set per service but does not
  embed them in the workflow.
- **Post-deploy `/health` smoke:** after `flyctl deploy`, poll
  `https://lms-<svc>-<env>.fly.dev/health` (or the `.internal` address) until **200** with a
  timeout → fail the deploy on non-200. `staging` auto-deploys on `main`; `production` sits
  behind the GitHub Environment approval gate.

### Runner-up and switch trigger

**Render** is the documented runner-up — choose it instead **if** the team prioritizes
minimal ops over cost/scaling control, accepts always-on per-service pricing, and doesn't
need queue-depth autoscaling. **Switch trigger:** if Fly's machine/region ops burden or
support responsiveness becomes a recurring drag, OR if we consolidate to a handful of
always-on services (the long tail collapses) so flat per-service pricing stops hurting —
Render's Virginia region + managed DX then wins. **Railway is not recommended as primary**
(US-West/Neon-us-east latency, metered cost variance, thinner approval-gate maturity); fine
for throwaway previews only.

### Follow-ups to file (track, don't fix here)

1. **Per-service scaling policy** — min/max machines, `auto_stop`/`auto_start`, concurrency
   thresholds, scale-to-zero on/off per service.
2. **Video worker dedicated machine class** — `performance` CPU + RAM sizing, attached
   Volume for FFmpeg scratch, long job timeouts; isolate as its own Fly app.
3. **Queue-depth autoscaling wiring** — stand up `fly-autoscaler` reading Upstash/QStash
   depth to scale enrollment/notification/relay. **(verify fly-autoscaler is current best
   practice)**
4. **Multi-region rollout** — map EU tenant silos (Neon eu-central-1) to Fly fra/ams;
   document region-pinning per tenant silo.
5. **Private GHCR → Fly pull auth** — decide public-read packages vs registry-cred/mirror;
   **(verify mechanism)**.
6. **Observability wiring** — Fly Prometheus → Grafana/OTel export, alerting against the
   p95/availability SLOs.
