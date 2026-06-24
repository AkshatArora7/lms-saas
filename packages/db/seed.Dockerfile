# syntax=docker/dockerfile:1
# One-shot demo seeder image (issue #266). Builds the pnpm workspace, builds
# @lms/auth (the password-hashing path the Prisma login verifies against),
# generates the Prisma client, then runs the dedicated idempotent demo seed
# (packages/db/prisma/seed.demo.ts) against DATABASE_URL.
#
# Used by the `seed` service in docker-compose.yml as a one-shot job
# (restart: "no") that the bundled identity/web/admin wait on via
# `service_completed_successfully`, so login can't be hit before the demo
# accounts + dataset exist.
#
# The shared base + workspace-deps (openssl/ca-certificates, corepack, the full
# `pnpm install`) now live in docker/base.Dockerfile and are built ONCE as
# ${BASE_IMAGE} (#369, L5). This file consumes that image for both its build and
# runtime stages instead of re-running the install. Build the base first:
#   pnpm build:base   (or `pnpm start:build`, which runs it before compose).
ARG BASE_IMAGE=lms-base-deps:local

# deps: the shared, pre-installed workspace (includes the standardized base).
FROM ${BASE_IMAGE} AS deps

# build: bring in ONLY shared packages (no services/), then build the seed deps.
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages ./packages
# @lms/auth → dist (hashPassword); @lms/db → generated Prisma client.
RUN pnpm --filter @lms/auth... build
RUN pnpm --filter @lms/db generate

FROM deps AS runtime
ENV NODE_ENV=production
# Ship the installed workspace so @lms/* + the generated client + tsx resolve.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=build /app/package.json ./package.json
WORKDIR /app/packages/db
# Idempotent: ON CONFLICT upserts keyed by the fixed demo uuids / natural keys.
CMD ["pnpm", "db:seed:demo"]
