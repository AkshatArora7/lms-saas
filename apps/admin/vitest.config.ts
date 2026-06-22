import { defineConfig } from "vitest/config";

// Pure unit tests for the admin app: the BFF auth flow (#104 — route handlers,
// getSession/isAdmin, the Edge middleware) and the stored-XSS HTML sanitizer
// (#32 — `sanitizeHtmlString` and its isomorphic entry point). All mock
// `next/headers` cookies()/global fetch or run without a DOM — no Next runtime,
// no Postgres, no network — so the Node environment is sufficient.
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**"],
  },
});
