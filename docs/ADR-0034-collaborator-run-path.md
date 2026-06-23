# ADR-0034 — Collaborator run path: keep GHCR images private, make build-from-source the supported path

- **Status:** Accepted · 2026-06-23
- **Issue:** #298 — ops(infra): make GHCR service images pullable by collaborators (or document build-from-source as the only path)
- **Owning scope:** ops/infra — `docker-compose.yml` + `docker-compose.build.yml` run paths, GHCR package visibility, `README.md` / `docs/DEPLOYMENT.md` — docs
- **Author:** Architect agent (recorded by docs-agent)

## Context

The repository `AkshatArora7/lms-saas` is **private**. The CI workflow
`deploy-services.yml` builds and pushes per-service images to GHCR
(`ghcr.io/akshatarora7/lms-saas/<service>:latest` and `:sha` / `:semver`) using
the workflow's `GITHUB_TOKEN`. Those packages inherit the repo's visibility:
they are **owner-private**. Nothing in CI sets package visibility to public.

There are two ways to bring the mesh up locally:

- **`pnpm start`** = `docker compose up -d` — **pulls** the prebuilt GHCR images.
  This requires GHCR pull access to the owner's private packages.
- **`pnpm start:build`** = `docker compose -f docker-compose.yml -f
  docker-compose.build.yml up -d --build` — **builds every image from the
  current source** via each service's existing `Dockerfile`. It needs only
  Docker Desktop + this repo: no GHCR, no Supabase, no Upstash accounts.

This creates collaborator friction: a brand-new collaborator who runs the
seemingly-default `pnpm start` hits an image-pull authorization failure, because
the GHCR packages are private and they have no pull credentials. Today
`README.md` (~517–537) and `docs/DEPLOYMENT.md` (~365–373) already present a
two-column table (build-from-source for collaborators vs pull for owner/CI) and
note that new collaborators want build-from-source — but `pnpm start` is still
presented as a **co-equal default** that silently fails for collaborators, and
**no decision record fixes the policy** on image visibility.

A secondary fact about the pull path: `deploy-services.yml` is **path-filtered**
(only changed services build) and only updates `:latest` on the default branch,
so `:latest` can lag for services that have not changed recently. That makes a
pull-based run a weaker reproducibility guarantee than building from the exact
working tree.

Issue #298's acceptance criterion: *collaborators can run the mesh without owner
GHCR credentials by a documented, supported path; image visibility decision
recorded.*

## Decision

**Keep the GHCR service images PRIVATE, and make build-from-source
(`pnpm start:build`) the single SUPPORTED collaborator run path. Reclassify the
pull path (`pnpm start`) as OWNER/CI-ONLY.**

1. **GHCR packages stay private.** The repository is private and the images are
   compiled artifacts derived from proprietary source. Publishing them publicly
   would disclose source-derived artifacts to anyone and contradicts the
   project's security posture (cf. #361). We therefore do **not** flip package
   visibility to public, and we do not add a CI step to do so.

2. **`pnpm start:build` is the supported collaborator path.** It builds from the
   current working tree and requires only Docker Desktop + this repo — no GHCR
   credentials and no external SaaS accounts. This is the credential-free,
   documented, supported path the AC requires, and it is also the most faithful
   reproduction of the working tree (no `:latest` lag).

3. **`pnpm start` (the GHCR pull path) is OWNER/CI-ONLY.** It is documented as
   requiring private GHCR pull access and is intended for the owner and CI, not
   for collaborators. Collaborators are no longer pointed at it as a co-equal
   default, so they are not sent down a path that silently fails.

4. **Revisit triggers.** This decision is reopened if (a) the repository goes
   public, or (b) a public demo registry / published image distribution is
   explicitly desired. Either would change the cost/benefit of public packages
   (the Option A below).

## Consequences

- **Collaborators can run the full mesh with Docker only** — no GHCR, Supabase,
  or Upstash credentials — satisfying the #298 AC. The supported path is
  unambiguous and does not fail closed on missing pull access.
- **The image-visibility decision is recorded** (this ADR) — the second half of
  the AC.
- **Trade-off: a cold `pnpm start:build` is slow (~2h today).** Build-from-source
  being the supported path couples collaborator onboarding to build speed; that
  slowness is tracked and addressed separately in **#299** (make the
  build-from-source path fast). This ADR knowingly accepts the slow cold build
  as the cost of not publishing proprietary images, with #299 as the follow-up
  to remove the pain.
- **`:latest` drift is acceptable.** Because the pull path is now owner/CI-only,
  the fact that `deploy-services.yml` is path-filtered and can leave `:latest`
  stale for unchanged services no longer affects collaborators (who build from
  source and always get the current tree).
- **No source disclosure.** Compiled, source-derived images are never exposed to
  non-collaborators; the private posture (cf. #361) is preserved.
- **Docs must be relabeled** so build-from-source is the primary/supported
  collaborator path and the pull path is explicitly "owner/CI only — requires
  private GHCR access", with a pointer to this ADR (handed to docs-agent; see the
  handshake edit spec). No code or compose change is required by this decision.

## Alternatives considered

- **(A) Publish the GHCR packages public and keep `:latest` current** — rejected.
  It would let collaborators `pnpm start` with no credentials, but it publicly
  exposes compiled artifacts derived from a **private** repo to anyone, which
  contradicts the project's security posture (cf. #361). It would also require
  new CI work to set/maintain public visibility and to keep `:latest` from
  lagging for path-filtered, unchanged services. Reconsider only if the repo
  goes public or a deliberate public demo registry is wanted (see revisit
  triggers).
- **(B-alt) Grant every collaborator GHCR pull access instead of changing the
  default** — rejected. It adds per-collaborator credential provisioning and
  org/package permission management for no benefit over building from source,
  and still leaves `pnpm start` dependent on private access rather than offering
  a truly credential-free path.
- **(C) Remove the pull path entirely** — rejected. The owner and CI legitimately
  use prebuilt images; keeping `pnpm start` as an explicitly owner/CI-only path
  preserves that workflow without misleading collaborators.

## Related

- **#299** — make the build-from-source path fast (removes the ~2h cold-build
  cost this decision accepts).
- **#361** — security posture context for keeping source-derived artifacts
  private.
- **#258** — origin (security-agent gate that surfaced the collaborator
  pull-failure); build-from-source override added there.
