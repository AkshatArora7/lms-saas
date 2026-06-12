# Multi-stage build for the reporting service (pnpm workspace).
FROM node:20-slim AS base
ENV PNPM_HOME=/pnpm PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @lms/service-reporting build

FROM base AS runtime
ENV NODE_ENV=production PORT=4016
COPY --from=build /app/services/reporting/dist ./dist
COPY --from=build /app/node_modules ./node_modules
EXPOSE 4016
CMD ["node", "dist/main.js"]
