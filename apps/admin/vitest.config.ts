import { defineConfig } from "vitest/config";

// Pure unit tests for the admin BFF auth flow (#104): route handlers,
// getSession/isAdmin, and the Edge middleware. They mock `next/headers`
// cookies() and global fetch — no Next runtime, no Postgres, no network — so the
// Node environment is sufficient.
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**"],
  },
});
