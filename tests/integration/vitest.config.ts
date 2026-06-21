import { defineConfig } from "vitest/config";

/**
 * Integration tests all run against ONE shared Postgres. Vitest runs test files
 * in parallel worker threads by default, which lets several suites create and
 * cascade-delete `tenant` rows concurrently — those cascades touch overlapping
 * tables and can deadlock (`40P01`). Run the test FILES sequentially so the DB
 * fixtures of one suite can't race another's. Tests within a file already run in
 * order. This keeps the lane deterministic locally and in CI.
 */
export default defineConfig({
  test: {
    fileParallelism: false,
  },
});
