# syntax=docker/dockerfile:1
# Multi-stage build for the web app (Next.js standalone, pnpm workspace).
#
# The shared base + workspace-deps (openssl/ca-certificates, corepack, the full
# `pnpm install`) now live in docker/base.Dockerfile and are built ONCE as
# ${BASE_IMAGE} (#369, L5). This file consumes that image for both its build and
# runtime stages instead of re-running the install. Build the base first:
#   pnpm build:base   (or `pnpm start:build`, which runs it before compose).
ARG BASE_IMAGE=lms-base-deps:local

# deps: the shared, pre-installed workspace (includes the standardized base).
FROM ${BASE_IMAGE} AS deps

# build: bring in ONLY shared packages + this app's source, then build.
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web
# @lms/web depends only on @lms/ui + @lms/types (no @lms/db / Prisma), so no
# `pnpm --filter @lms/db generate` step is needed. The `...` includes workspace
# deps, so @lms/ui is compiled before the Next build.
RUN pnpm --filter "@lms/web..." build

FROM deps AS runtime
ENV NODE_ENV=production PORT=3000
# Next.js standalone output for a monorepo: the self-contained server (with a
# minimal node_modules) is traced under .next/standalone preserving the
# apps/web/ workspace path, so the entry lands at apps/web/server.js. Static
# assets are copied separately. There is no apps/web/public dir, so it is omitted.
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
