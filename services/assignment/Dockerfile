# Multi-stage build for the assignment service (pnpm workspace).
FROM node:20-slim AS base
ENV PNPM_HOME=/pnpm PATH=$PNPM_HOME:$PATH
# Prisma needs OpenSSL both at build time (so `prisma generate` selects the engine
# matching node:20-slim = Debian bookworm / OpenSSL 3.0) and at runtime (libssl).
# Without it Prisma fails with "cannot find libssl.so.1.1" or an engine-target
# mismatch (generated debian-openssl-1.1.x vs runtime debian-openssl-3.0.x).
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @lms/db generate
RUN pnpm --filter "@lms/service-assignment..." build

FROM base AS runtime
ENV NODE_ENV=production PORT=4007
# Ship the built workspace so @lms/* imports resolve at runtime. The service is
# compiled with tsc (not bundled), so the compiled workspace packages it imports
# must be present and the process must run from the service's workspace dir.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/services/assignment ./services/assignment
WORKDIR /app/services/assignment
EXPOSE 4007
CMD ["node", "dist/main.js"]
