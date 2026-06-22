import { defineConfig } from "vitest/config";

// Component-level a11y regression tests (#87). The shared @lms/ui primitives are
// server-component-free and render cleanly under jsdom, so we run jest-axe over
// the audited components (AppShell, Field/forms, Alert/Badge/status) with no
// server, no Postgres and no network. Tests live in src/**/*.test.tsx.
export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", "dist/**"],
  },
});
