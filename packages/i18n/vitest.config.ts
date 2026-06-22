import { defineConfig } from "vitest/config";

// Pure unit tests for @lms/i18n: catalog lookup + interpolation (`t`), the
// missing-key fallback chain (locale → en → key), `resolveLocale` normalisation
// and `LOCALES` direction metadata. These touch no DOM, so the Node environment
// is sufficient (mirrors the apps' vitest configs).
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["node_modules/**", "dist/**"],
  },
});
