import { defineConfig } from "vitest/config";

// Pure unit tests for the BFF auth flow (#103): route handlers, getSession, and
// the Edge middleware. They mock `next/headers` cookies() and global fetch — no
// Next runtime, no Postgres, no network — so the Node environment is sufficient.
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**"],
  },
});
