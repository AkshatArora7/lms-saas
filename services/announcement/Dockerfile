# syntax=docker/dockerfile:1
# Multi-stage build for the announcement service (pnpm workspace).
#
# The shared base + workspace-deps (openssl/ca-certificates, corepack, the full
# `pnpm install`) now live in docker/base.Dockerfile and are built ONCE as
# ${BASE_IMAGE} (#369, L5). This file consumes that image for both its build and
# runtime stages instead of re-running the install. Build the base first:
#   pnpm build:base   (or `pnpm start:build`, which runs it before compose).
ARG BASE_IMAGE=lms-base-deps:local

# deps: the shared, pre-installed workspace (includes the standardized base).
FROM ${BASE_IMAGE} AS deps

# build: bring in ONLY shared packages + this service's source, then build.
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages ./packages
COPY services/announcement ./services/announcement
RUN pnpm --filter @lms/db generate
RUN pnpm --filter "@lms/service-announcement..." build

# runtime: FROM deps (carries the standardized base with openssl/ca-certificates),
# then ship the built workspace so @lms/* imports resolve at runtime. The service
# is compiled with tsc (not bundled), so the compiled workspace packages it
# imports must be present and the process must run from the service's workspace dir.
FROM deps AS runtime
ENV NODE_ENV=production PORT=4011
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/services/announcement ./services/announcement
WORKDIR /app/services/announcement
EXPOSE 4011
CMD ["node", "dist/main.js"]
