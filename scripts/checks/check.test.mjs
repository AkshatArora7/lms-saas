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
import {
  validateTemplate,
  findRoleDrift,
  validateHandshake,
  roleSlugsFromFilenames,
  documentedRoles,
  parseSections,
} from "./lib/handshake-protocol.mjs";
import { readdirSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");

// Mirror the documented EXCEPTIONS from check-rls.mjs (kept in sync deliberately).
const REAL_EXCEPTIONS = ["tenant", "plan", "permission", "role_permission", "tenant_admin_delegation", "tenant_silo_migration"];

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

// ----------------------------------------------------------------------------
// Handshake protocol — shared constants & helpers
// ----------------------------------------------------------------------------

// Mirror the documented EXCEPTIONS from check-handshake.mjs (kept in sync).
const HANDSHAKE_EXCEPTIONS = ["README", "handshake.template"];

// A minimal compliant template body (all 7 sections, in order) for RED-case edits.
const GOOD_TEMPLATE = `# Handshake

## 1. Task
content
## 2. Acceptance criteria
content
## 3. Stage status
content
## 4. Decisions & contracts
content
## 5. Verification
content
## 6. Open questions / blockers
content
## 7. Handshake log
- 2026-06-22 · architect · did thing · **next owner → service-builder**
`;

// ----------------------------------------------------------------------------
// Handshake protocol — Guard A (template integrity) GREEN
// ----------------------------------------------------------------------------

test("handshake: real handshake.template.md passes Guard A (GREEN)", () => {
  const templateMd = readFileSync(
    resolve(repoRoot, ".claude/agents/handshake.template.md"),
    "utf8",
  );
  const violations = validateTemplate(templateMd);
  assert.deepEqual(violations, [], `expected no violations, got:\n${violations.join("\n")}`);
});

test("handshake: a clean crafted template passes Guard A (GREEN)", () => {
  assert.deepEqual(validateTemplate(GOOD_TEMPLATE), []);
});

test("handshake: parseSections returns numbered headings in order", () => {
  const headings = parseSections(GOOD_TEMPLATE);
  assert.equal(headings.length, 7);
  assert.match(headings[0], /^1\. Task/);
  assert.match(headings[6], /^7\. Handshake log/);
});

// ----------------------------------------------------------------------------
// Handshake protocol — Guard A (template integrity) RED
// ----------------------------------------------------------------------------

test("handshake: template missing §5 Verification is reported (Guard A)", () => {
  const broken = GOOD_TEMPLATE.replace("## 5. Verification\ncontent\n", "");
  const violations = validateTemplate(broken);
  assert.ok(violations.some((v) => /§5/.test(v) && /missing/.test(v)), violations.join("; "));
});

test("handshake: template with sections out of order is reported (Guard A)", () => {
  // Swap §4 and §5 so §4 appears after §5 -> order violation on §5.
  const reordered = `# Handshake

## 1. Task
c
## 2. Acceptance criteria
c
## 3. Stage status
c
## 5. Verification
c
## 4. Decisions & contracts
c
## 6. Open questions / blockers
c
## 7. Handshake log
- x · y · z · next owner → qa-agent
`;
  const violations = validateTemplate(reordered);
  assert.ok(violations.some((v) => /out of order/.test(v)), violations.join("; "));
});

// ----------------------------------------------------------------------------
// Handshake protocol — Guard B (role drift) GREEN against the real tree
// ----------------------------------------------------------------------------

test("handshake: real agent files + protocol doc + README have 0 role drift (GREEN)", () => {
  const agentFilenames = readdirSync(resolve(repoRoot, ".claude/agents")).filter((f) =>
    f.endsWith(".md"),
  );
  const protocolDocMd = readFileSync(
    resolve(repoRoot, "docs/AGENT_DELEGATION_PROTOCOL.md"),
    "utf8",
  );
  const readmeMd = readFileSync(resolve(repoRoot, ".claude/agents/README.md"), "utf8");
  const violations = findRoleDrift(
    agentFilenames,
    protocolDocMd,
    readmeMd,
    HANDSHAKE_EXCEPTIONS,
  );
  assert.deepEqual(violations, [], `expected no role drift, got:\n${violations.join("\n")}`);
});

test("handshake: roleSlugsFromFilenames excludes README + handshake.template", () => {
  const slugs = roleSlugsFromFilenames(
    ["architect.md", "qa-agent.md", "README.md", "handshake.template.md"],
    HANDSHAKE_EXCEPTIONS,
  );
  assert.deepEqual(slugs, ["architect", "qa-agent"]);
});

test("handshake: documentedRoles only returns backticked tokens", () => {
  const doc = "The `architect` designs; qa-agent is plain prose here.";
  const found = documentedRoles(doc, ["architect", "qa-agent"]);
  assert.deepEqual(found, ["architect"]);
});

// ----------------------------------------------------------------------------
// Handshake protocol — Guard B (role drift) RED
// ----------------------------------------------------------------------------

test("handshake: agent file not backticked in the doc is forward-drift (Guard B)", () => {
  const agentFilenames = ["architect.md", "qa-agent.md", "README.md", "handshake.template.md"];
  const protocolDoc = "Roles: `architect`."; // qa-agent missing
  const readme = "Roles: `architect`, `qa-agent`.";
  const violations = findRoleDrift(agentFilenames, protocolDoc, readme, HANDSHAKE_EXCEPTIONS);
  assert.ok(
    violations.some((v) => /qa-agent\.md/.test(v) && /AGENT_DELEGATION_PROTOCOL/.test(v)),
    violations.join("; "),
  );
});

test("handshake: a backticked fake role with no file is reverse-drift (Guard B)", () => {
  const agentFilenames = ["architect.md", "README.md", "handshake.template.md"];
  const protocolDoc = "Roles: `architect`, `ghost-agent`."; // ghost-agent has no file
  const readme = "Roles: `architect`.";
  const violations = findRoleDrift(agentFilenames, protocolDoc, readme, HANDSHAKE_EXCEPTIONS);
  assert.ok(
    violations.some((v) => /ghost-agent/.test(v) && /stale role reference/.test(v)),
    violations.join("; "),
  );
});

test("handshake: EXCEPTIONS slugs are never flagged (Guard B)", () => {
  // README/handshake.template appear as files but are exceptions; they must not
  // appear as missing roles, and their absence from docs is fine.
  const agentFilenames = ["architect.md", "README.md", "handshake.template.md"];
  const doc = "Roles: `architect`.";
  const violations = findRoleDrift(agentFilenames, doc, doc, HANDSHAKE_EXCEPTIONS);
  assert.deepEqual(violations, []);
});

// ----------------------------------------------------------------------------
// Handshake protocol — Guard C (local handshake lint) GREEN + RED
// ----------------------------------------------------------------------------

test("handshake: a complete handshake passes Guard C (GREEN)", () => {
  const canonical = ["architect", "service-builder", "qa-agent"];
  const violations = validateHandshake("feat-x.md", GOOD_TEMPLATE, canonical);
  assert.deepEqual(violations, [], violations.join("; "));
});

test("handshake: §7 last line naming an unknown next owner is reported (Guard C)", () => {
  const canonical = ["architect", "service-builder", "qa-agent"];
  const md = GOOD_TEMPLATE.replace(
    "**next owner → service-builder**",
    "**next owner → nonexistent-agent**",
  );
  const violations = validateHandshake("feat-x.md", md, canonical);
  assert.ok(
    violations.some((v) => /next owner "nonexistent-agent"/.test(v)),
    violations.join("; "),
  );
});

test("handshake: a handshake with no §7 log line is reported (Guard C)", () => {
  const canonical = ["architect"];
  const md = GOOD_TEMPLATE.replace(
    "- 2026-06-22 · architect · did thing · **next owner → service-builder**\n",
    "",
  );
  const violations = validateHandshake("feat-x.md", md, canonical);
  assert.ok(violations.some((v) => /no log line/.test(v)), violations.join("; "));
});
