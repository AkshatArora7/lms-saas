import config from "@lms/eslint-config";

/**
 * Root flat ESLint config for the LMS monorepo.
 * ESLint 9 discovers this file by searching upward from each package's cwd,
 * so every workspace (`eslint src` / `eslint app`) shares one ruleset.
 */
export default config;
