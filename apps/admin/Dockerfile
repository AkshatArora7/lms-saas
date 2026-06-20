# Multi-stage build for the admin app (Next.js standalone, pnpm workspace).
FROM node:20-slim AS base
ENV PNPM_HOME=/pnpm PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
# @lms/admin depends only on @lms/ui + @lms/types (no @lms/db / Prisma), so no
# `pnpm --filter @lms/db generate` step is needed. The `...` includes workspace
# deps, so @lms/ui is compiled before the Next build.
RUN pnpm --filter "@lms/admin..." build

FROM base AS runtime
ENV NODE_ENV=production PORT=3001
# Next.js standalone output for a monorepo: the self-contained server (with a
# minimal node_modules) is traced under .next/standalone preserving the
# apps/admin/ workspace path, so the entry lands at apps/admin/server.js. Static
# assets are copied separately. There is no apps/admin/public dir, so it is omitted.
COPY --from=build /app/apps/admin/.next/standalone ./
COPY --from=build /app/apps/admin/.next/static ./apps/admin/.next/static
EXPOSE 3001
CMD ["node", "apps/admin/server.js"]
