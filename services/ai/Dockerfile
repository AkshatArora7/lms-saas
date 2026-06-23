# syntax=docker/dockerfile:1
# Multi-stage build for the ai service (pnpm workspace).
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

# build: bring in ONLY shared packages + this service's source, then build.
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages ./packages
COPY services/ai ./services/ai
RUN pnpm --filter @lms/db generate
RUN pnpm --filter "@lms/service-ai..." build

FROM base AS runtime
ENV NODE_ENV=production PORT=4017
# Ship the built workspace so @lms/* imports resolve at runtime. The service is
# compiled with tsc (not bundled), so the compiled workspace packages it imports
# must be present and the process must run from the service's workspace dir.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/services/ai ./services/ai
WORKDIR /app/services/ai
EXPOSE 4017
CMD ["node", "dist/main.js"]
