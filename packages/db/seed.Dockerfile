# One-shot demo seeder image (issue #266). Builds the pnpm workspace, builds
# @lms/auth (the password-hashing path the Prisma login verifies against),
# generates the Prisma client, then runs the dedicated idempotent demo seed
# (packages/db/prisma/seed.demo.ts) against DATABASE_URL.
#
# Used by the `seed` service in docker-compose.yml as a one-shot job
# (restart: "no") that the bundled identity/web/admin wait on via
# `service_completed_successfully`, so login can't be hit before the demo
# accounts + dataset exist.
FROM node:20-slim AS base
ENV PNPM_HOME=/pnpm PATH=$PNPM_HOME:$PATH
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
# @lms/auth → dist (hashPassword); @lms/db → generated Prisma client.
RUN pnpm --filter @lms/auth... build
RUN pnpm --filter @lms/db generate

FROM base AS runtime
ENV NODE_ENV=production
# Ship the installed workspace so @lms/* + the generated client + tsx resolve.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=build /app/package.json ./package.json
WORKDIR /app/packages/db
# Idempotent: ON CONFLICT upserts keyed by the fixed demo uuids / natural keys.
CMD ["pnpm", "db:seed:demo"]
