import { defineConfig } from "vitest/config";

// Pure unit tests for the stored-XSS HTML sanitizer (#32, architect D3). The
// server-side sanitizer (`sanitizeHtmlString`) and the isomorphic entry point
// run without a DOM, so the Node environment is sufficient — no Next runtime, no
// Postgres, no network. Mirrors apps/web's vitest setup.
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**"],
  },
});
