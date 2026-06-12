const js = require("@eslint/js");
const tsParser = require("@typescript-eslint/parser");
const tsPlugin = require("@typescript-eslint/eslint-plugin");

/**
 * Shared ESLint **flat** config (ESLint 9) for the LMS monorepo.
 * Consumed by the root eslint.config.mjs and discovered by every package's
 * `eslint` invocation (flat config is searched upward from the cwd).
 */
module.exports = [
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/node_modules/**",
      "**/prisma/generated/**",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      // TypeScript handles undefined-symbol checking; the core rule conflicts.
      "no-undef": "off",
      "no-unused-vars": "off",
      // Value + type sharing a name (declaration merging) is valid in TS.
      "no-redeclare": "off",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
];
