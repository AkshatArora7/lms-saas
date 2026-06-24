# ADR-0035: Shared base/deps Docker image for the build-from-source mesh

- **Status:** Accepted
- **Date:** 2026-06-24
- **Issue:** [#369](https://github.com/AkshatArora7/lms-saas/issues/369) — Cut
  Docker cold build time with a shared base/deps image + measure full-mesh
  wall-clock (lever **L5**).
- **Predecessor:** [#299 / PR #368](https://github.com/AkshatArora7/lms-saas/pull/368)
  shipped L1–L4 (BuildKit pnpm-store cache mount, manifest-first install, scoped
  per-service `COPY`).
- **Supersedes:** the "Future optimization (deferred)" note for L5 in
  `docs/DEPLOYMENT.md`.

## Context

The build-from-source path (`pnpm start:build`) builds **29 buildable images**:
27 services under `services/*/Dockerfile`, `apps/web`, `apps/admin`, plus the
one-shot `seed` image (`packages/db/seed.Dockerfile`).

Every one of those Dockerfiles carried the **same** three opening stages:

1. `base` — `FROM node:20-slim`, `PNPM_HOME`, `corepack enable`, `WORKDIR /app`.
2. `manifests` — copy only `package.json` / `pnpm-lock.yaml` /
   `pnpm-workspace.yaml` into `/app`.
3. `deps` — `COPY --from=manifests` then
   `RUN --mount=type=cache,id=pnpm-store,... pnpm install --frozen-lockfile`.

The `manifests` + `deps` slice was effectively identical across all 27 service
files. #299's BuildKit cache mount already shared the pnpm **store** (the
download is paid once), but **the install work itself** — linking ~550 packages
into `node_modules` — was re-executed per image, and the resulting `deps` layer
was never reused **as a layer** because each image built it in its own context.

A second, latent problem: **7 prisma services** (`ai`, `gateway`, `lti`,
`mobile-bff`, `reporting`, `sis`, `video`) ran `prisma generate` **without**
installing `openssl`/`ca-certificates`, relying on whatever shipped in
`node:20-slim`. This drift risked an engine-target / libssl mismatch.

## Decision

Build the shared `base` + `deps` stages **once** as a standalone image and have
every service/app/seed image `FROM` it.

- **New `docker/base.Dockerfile`** contains the `base` → `manifests` → `deps`
  triplet, with `openssl` + `ca-certificates` installed **once** in `base` for
  all consumers (fixes the 7-service drift). Tagged `lms-base-deps:local`
  (lowercase, honoring the GHCR-lowercase rule if ever published).
- **Every consumer Dockerfile** starts with
  `ARG BASE_IMAGE=lms-base-deps:local` and `FROM ${BASE_IMAGE} AS deps`, then
  keeps **its own** `build` stage (scoped `COPY` + `prisma generate` where
  needed + `pnpm --filter "<pkg>..." build`) and **its own** `runtime` tail
  (PORT, runtime `COPY` list, `CMD`) verbatim. Runtime is now `FROM deps` so
  every image inherits the standardized base (guaranteed runtime libssl).
- **Build ordering** is guaranteed by making the base build first:
  - `build:base` → `docker build -f docker/base.Dockerfile -t lms-base-deps:local .`
  - `start:build` → `pnpm build:base && docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build`

  `${BASE_IMAGE}` is overridable (e.g. a GHCR-published
  `ghcr.io/akshatarora7/lms-saas/base-deps:<sha>`) without editing 29 files.

### Why not L6 (`turbo prune --docker`)?

`turbo prune` produces a minimal per-service context (pruned lockfile + that
package's transitive workspace deps). But:

- #299's scoped `COPY` + manifest-first install **already** realized most of the
  "minimal context" benefit for warm rebuilds. The remaining cold cost is the
  **repeated install**, which L6 does **not** eliminate (each pruned context
  still installs).
- It emits **29 pruned lockfiles** to codegen/commit — a large new moving part
  and a new way for `--frozen-lockfile` to drift against the root lock.
- It changes the build-context shape, risking the fragile `@lms/db generate` /
  `@lms/*` workspace resolution.

L6 stays a **deferred follow-up** if, after L5, the per-service `COPY packages`
+ build stage proves to dominate.

## Consequences

- **Cold build:** the full workspace install runs **once** (the base image)
  instead of 29 times. Measured before/after full-mesh wall-clock is recorded in
  `docs/DEPLOYMENT.md` (Build performance).
- **Warm-rebuild isolation (#299) is preserved.** A source-only edit to one
  service still busts only that service's `build` stage; the shared `deps` layer
  is upstream and reused. Verified: editing `grading` left `deps` `CACHED`
  (only `COPY services/grading` + `prisma generate` + `tsc` re-ran), and an
  untouched service rebuilt fully cached in seconds.
- **A dependency change (lockfile/manifest)** now rebuilds the **base once**,
  then every service re-layers on top — correct, and still cheaper than 29
  installs. Collaborators should expect that one-time base rebuild after a
  `pnpm add`.
- **openssl drift removed:** all images share one toolchain.
- **Image size:** runtime `FROM deps` ≈ unchanged — runtime already shipped the
  full `node_modules`.
- **No secrets baked:** unchanged; `prisma generate` only generates the client
  (no DB at build time). `.dockerignore` still excludes `**/node_modules`.
- **New failure mode (acceptable):** if the base image tag is missing,
  `FROM ${BASE_IMAGE}` fails **loudly** — no silent stale base. `start:build`
  builds it first so collaborators never hit this.

## Alternatives considered

- **`docker-bake.hcl`** declaring the base as a target with
  `contexts = { lms-base-deps = "target:base" }` for one-DAG max parallelism.
  Deferred: the `start:build` two-step keeps the one-command UX and is the
  canonical path; bake can be added later if base/service serialization proves
  to be the bottleneck.
