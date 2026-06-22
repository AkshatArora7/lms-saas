#!/usr/bin/env node
// CLI wrapper for the commit-hygiene guard. Resolves the commit range
// (origin/main..HEAD in CI; merge-base fallback locally), reads NUL-delimited
// messages via git log --no-merges, and fails (exit 1) on any violation.
// Pure logic lives in lib/commit-rules.mjs (no git access there).

import { execFileSync } from "node:child_process";
import { lintRange } from "./lib/commit-rules.mjs";

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

function tryGit(args) {
  try {
    return git(args).trim();
  } catch {
    return null;
  }
}

/**
 * Resolve `<base>..HEAD`. Prefer origin/main; if the ref is absent (e.g. a fresh
 * shallow CI checkout), try to fetch it, then fall back to a local merge-base
 * against main/master. Returns null if no base can be determined.
 */
function resolveRange() {
  const candidates = ["origin/main", "origin/master"];

  for (const ref of candidates) {
    if (tryGit(["rev-parse", "--verify", "--quiet", ref]) !== null) {
      return `${ref}..HEAD`;
    }
  }

  // Ref not present locally — attempt a lightweight fetch (CI shallow checkout).
  tryGit(["fetch", "--no-tags", "--quiet", "origin", "main"]);
  if (tryGit(["rev-parse", "--verify", "--quiet", "origin/main"]) !== null) {
    return "origin/main..HEAD";
  }

  // Last resort: merge-base against a local main/master branch.
  for (const branch of ["main", "master"]) {
    const base = tryGit(["merge-base", branch, "HEAD"]);
    if (base) return `${base}..HEAD`;
  }

  return null;
}

function readMessages(range) {
  // %B = raw body (subject + body), NUL-delimited so multi-line messages parse.
  const out = git(["log", "--no-merges", "--format=%B%x00", range]);
  return out
    .split("\0")
    .map((m) => m.replace(/^\n+|\n+$/g, ""))
    .filter((m) => m.length > 0);
}

function main() {
  console.log("check:commits — commit hygiene (Conventional Commit + issue ref, no co-author/Generated trailer)");

  const range = resolveRange();
  if (!range) {
    console.log("No base ref (origin/main) resolvable; nothing to check. OK.");
    process.exit(0);
  }

  let messages;
  try {
    messages = readMessages(range);
  } catch (err) {
    console.log(`Could not read commits for range ${range} (${err.message}); skipping. OK.`);
    process.exit(0);
  }

  if (messages.length === 0) {
    console.log(`Range ${range} has no non-merge commits; nothing to check. OK.`);
    process.exit(0);
  }

  console.log(`Checking ${messages.length} commit(s) in ${range}:`);

  const { ok, violations } = lintRange(messages);
  if (!ok) {
    console.error(`\nFAIL: ${violations.length} commit-hygiene violation(s):`);
    for (const v of violations) console.error(`  ✗ ${v}`);
    console.error(
      "\nFix: amend/rebase the offending commit(s). Use a Conventional Commit subject\n" +
        "(feat|fix|docs|chore|refactor|test|build|ci|perf|style|revert), reference the issue\n" +
        "(e.g. (#92) or Closes #92), and remove any Co-authored-by / 'Generated with' trailer.",
    );
    process.exit(1);
  }

  console.log("\nOK: all commits are compliant. 0 violations.");
  process.exit(0);
}

main();
