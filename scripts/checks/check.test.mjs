// Unit tests for the repo-rule guards. Run with `node --test scripts/checks/`.
// Proves BOTH green (real tree / compliant inputs) and red (crafted violations)
// paths without ever dirtying real commits.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  findUnprotectedTables,
  parseTenantTables,
  parseTenantScopedTables,
} from "./lib/rls-invariant.mjs";
import { lintCommitMessage, lintRange } from "./lib/commit-rules.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");

// Mirror the documented EXCEPTIONS from check-rls.mjs (kept in sync deliberately).
const REAL_EXCEPTIONS = ["tenant", "plan", "permission", "role_permission", "tenant_admin_delegation"];

// ----------------------------------------------------------------------------
// RLS invariant — RED paths
// ----------------------------------------------------------------------------

test("rls: tenant-scoped table missing from tenant_tables is reported", () => {
  // org_unit is correctly listed; widget is tenant-scoped but omitted -> exactly
  // one forward-drift violation, no reverse drift.
  const schema = `
CREATE TABLE IF NOT EXISTS org_unit (
  id        uuid PRIMARY KEY,
  tenant_id uuid NOT NULL
);
CREATE TABLE IF NOT EXISTS widget (
  id        uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  name      text NOT NULL
);
`;
  const rls = `
  tenant_tables text[] := ARRAY[
    'org_unit'
  ];
`;
  const violations = findUnprotectedTables(schema, rls, REAL_EXCEPTIONS);
  assert.equal(violations.length, 1);
  assert.match(violations[0], /widget/);
  assert.match(violations[0], /MISSING from tenant_tables/);
});

test("rls: stale tenant_tables entry (no matching tenant_id table) is reported", () => {
  const schema = `
CREATE TABLE IF NOT EXISTS org_unit (
  id        uuid PRIMARY KEY,
  tenant_id uuid NOT NULL
);
`;
  const rls = `
  tenant_tables text[] := ARRAY[
    'org_unit','ghost_table'
  ];
`;
  const violations = findUnprotectedTables(schema, rls, REAL_EXCEPTIONS);
  assert.equal(violations.length, 1);
  assert.match(violations[0], /ghost_table/);
  assert.match(violations[0], /stale entry/);
});

test("rls: exception tables are not flagged in either direction", () => {
  // role_permission has no tenant_id; it is in the allowlist, so listing it (or
  // not) must never produce a violation.
  const schema = `
CREATE TABLE IF NOT EXISTS role (
  id        uuid PRIMARY KEY,
  tenant_id uuid NOT NULL
);
CREATE TABLE IF NOT EXISTS role_permission (
  role_id       uuid NOT NULL,
  permission_id uuid NOT NULL
);
`;
  const rls = `
  tenant_tables text[] := ARRAY[
    'role','role_permission'
  ];
`;
  const violations = findUnprotectedTables(schema, rls, REAL_EXCEPTIONS);
  assert.deepEqual(violations, []);
});

test("rls: parseTenantScopedTables only returns tenant_id-bearing tables", () => {
  const schema = `
CREATE TABLE IF NOT EXISTS plan (
  id uuid PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS course (
  id        uuid PRIMARY KEY,
  tenant_id uuid NOT NULL
);
`;
  const tables = parseTenantScopedTables(schema);
  assert.deepEqual(tables, ["course"]);
});

test("rls: parseTenantTables extracts quoted names", () => {
  const rls = `tenant_tables text[] := ARRAY[
    'a','b',
    'c'
  ];`;
  assert.deepEqual(parseTenantTables(rls), ["a", "b", "c"]);
});

// ----------------------------------------------------------------------------
// RLS invariant — GREEN path (locks in the real tree)
// ----------------------------------------------------------------------------

test("rls: real schema.sql + rls.sql have 0 violations (GREEN)", () => {
  const schemaSql = readFileSync(resolve(repoRoot, "database/schema.sql"), "utf8");
  const rlsSql = readFileSync(resolve(repoRoot, "database/policies/rls.sql"), "utf8");
  const violations = findUnprotectedTables(schemaSql, rlsSql, REAL_EXCEPTIONS);
  assert.deepEqual(violations, [], `expected no violations, got:\n${violations.join("\n")}`);
});

// ----------------------------------------------------------------------------
// Commit hygiene — RED paths
// ----------------------------------------------------------------------------

test("commits: Co-authored-by trailer is rejected", () => {
  const msg = "feat(x): do thing (#92)\n\nCo-authored-by: Copilot <copilot@github.com>";
  const { ok, violations } = lintCommitMessage(msg);
  assert.equal(ok, false);
  assert.ok(violations.some((v) => /Co-authored-by/i.test(v)));
});

test("commits: 'Generated with' footer is rejected", () => {
  const msg = "feat(x): do thing (#92)\n\nGenerated with Claude Code";
  const { ok, violations } = lintCommitMessage(msg);
  assert.equal(ok, false);
  assert.ok(violations.some((v) => /Generated/i.test(v)));
});

test("commits: missing Conventional Commit prefix is rejected", () => {
  const msg = "do a thing without a prefix (#92)";
  const { ok, violations } = lintCommitMessage(msg);
  assert.equal(ok, false);
  assert.ok(violations.some((v) => /Conventional Commit prefix/.test(v)));
});

test("commits: missing issue reference is rejected", () => {
  const msg = "feat(x): do thing with no issue";
  const { ok, violations } = lintCommitMessage(msg);
  assert.equal(ok, false);
  assert.ok(violations.some((v) => /reference an issue/.test(v)));
});

// ----------------------------------------------------------------------------
// Commit hygiene — GREEN paths
// ----------------------------------------------------------------------------

test("commits: a clean compliant message is accepted", () => {
  const msg = "feat(x): do thing\n\nCloses #92";
  const { ok, violations } = lintCommitMessage(msg);
  assert.equal(ok, true, violations.join("; "));
  assert.deepEqual(violations, []);
});

test("commits: inline (#92) reference is accepted", () => {
  const { ok } = lintCommitMessage("fix(rls): tighten policy (#92)");
  assert.equal(ok, true);
});

test("commits: revert prefix is accepted", () => {
  const { ok } = lintCommitMessage("revert: undo broken change (#92)");
  assert.equal(ok, true);
});

test("commits: merge commits are skipped (exempt)", () => {
  const res = lintCommitMessage("Merge branch 'main' into feature");
  assert.equal(res.ok, true);
  assert.equal(res.skipped, true);
});

test("commits: lintRange aggregates violations across messages", () => {
  const messages = [
    "feat(x): good (#92)",
    "bad subject no prefix no ref",
    "Merge branch 'main'",
  ];
  const { ok, violations } = lintRange(messages);
  assert.equal(ok, false);
  // the good and the merge commit contribute nothing; only the bad one does.
  assert.ok(violations.every((v) => /bad subject/.test(v)));
});

test("commits: lintRange on all-compliant messages is ok", () => {
  const { ok, violations } = lintRange(["feat(a): one (#92)", "fix(b): two (#92)"]);
  assert.equal(ok, true);
  assert.deepEqual(violations, []);
});
