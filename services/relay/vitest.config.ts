import { defineConfig } from "vitest/config";

// Under the repo-wide parallel `pnpm -w run test` (~40 vitest processes
// contending), a cold module load + Fastify boot can exceed vitest's
// default 5000ms testTimeout for this service. Give the lane headroom so
// the suite is deterministic locally and in CI. (#306)
export default defineConfig({
  test: { testTimeout: 30000, hookTimeout: 30000 },
});
