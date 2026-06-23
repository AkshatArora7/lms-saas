# syntax=docker/dockerfile:1
# Multi-stage build for the web app (Next.js standalone, pnpm workspace).
FROM node:20-slim AS base
ENV PNPM_HOME=/pnpm PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

# manifests: extract ONLY package manifests + lockfile so the deps layer is reused
# across source-only changes (node_modules already excluded by .dockerignore).
FROM base AS manifests
COPY . /tmp/ctx
RUN cd /tmp/ctx \
 && find . -type f \( -name package.json -o -name pnpm-lock.yaml -o -name pnpm-workspace.yaml \) -print \
    | xargs -I{} cp --parents {} /app/

# deps: install the full workspace from manifests only, with a cached pnpm store.
FROM base AS deps
COPY --from=manifests /app ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

# build: bring in ONLY shared packages + this app's source, then build.
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web
# @lms/web depends only on @lms/ui + @lms/types (no @lms/db / Prisma), so no
# `pnpm --filter @lms/db generate` step is needed. The `...` includes workspace
# deps, so @lms/ui is compiled before the Next build.
RUN pnpm --filter "@lms/web..." build

FROM base AS runtime
ENV NODE_ENV=production PORT=3000
# Next.js standalone output for a monorepo: the self-contained server (with a
# minimal node_modules) is traced under .next/standalone preserving the
# apps/web/ workspace path, so the entry lands at apps/web/server.js. Static
# assets are copied separately. There is no apps/web/public dir, so it is omitted.
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
