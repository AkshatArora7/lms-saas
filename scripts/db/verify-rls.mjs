#!/usr/bin/env node
// Live RLS verification — AC3 of issue #82.
//
// Connects to a database and PROVES that every tenant-scoped table actually has
// row-level security enabled, FORCED, and carries at least one row-level policy
// (the `tenant_isolation` policy from database/policies/rls.sql). This is the
// runtime counterpart to the static string-level guard in
// scripts/checks/check-rls.mjs.
//
//   DATABASE_URL or VERIFY_DATABASE_URL — the DB to verify.
//
// A tenant-scoped table is derived LIVE as any BASE TABLE in schema `public`
// that has a `tenant_id` column, MINUS the control-plane allowlist below, PLUS
// the join-policy table(s) that rls.sql isolates without their own tenant_id
// (role_permission). For each it asserts ALL of:
//   * pg_class.relrowsecurity      = true  (RLS enabled)
//   * pg_class.relforcerowsecurity = true  (FORCE — owner/superuser still subject)
//   * >= 1 row in pg_policies                (the tenant_isolation policy)
// Any violation is collected and printed; exit 1 if any, else exit 0.

import pg from "pg";

const { Client } = pg;

// Control-plane / global tables intentionally WITHOUT a per-row tenant_isolation
// policy. Mirrors the EXCEPTIONS allowlist concept in
// scripts/checks/lib/rls-invariant.mjs (used by scripts/checks/check-rls.mjs).
// NOTE: role_permission is NOT excluded here — it is join-isolated and MUST be
// verified; it is added explicitly to the candidate set below.
const EXCLUDE = new Set([
  "tenant", // control plane; the tenant registry itself (no tenant_id)
  "plan", // global billing catalog shared across tenants
  "permission", // global permission catalog shared across tenants
  "tenant_admin_delegation", // cross-tenant control plane (delegator/scope ids, not tenant_id)
]);

// Join-policy tables that rls.sql protects without their own tenant_id column,
// so they won't be found by the `has tenant_id column` query.
const JOIN_POLICY_TABLES = ["role_permission"];

function databaseUrl() {
  const url = process.env.VERIFY_DATABASE_URL || process.env.DATABASE_URL;
  return url && url.length > 0 ? url : undefined;
}

async function main() {
  const connectionString = databaseUrl();
  if (!connectionString) {
    console.error(
      "verify-rls: set DATABASE_URL (or VERIFY_DATABASE_URL) to the database to verify.",
    );
    process.exit(2);
  }

  const client = new Client({ connectionString });
  await client.connect();
  try {
    // 1. Candidate tenant-scoped tables: public BASE TABLEs with a tenant_id column.
    const cols = await client.query(`
      SELECT DISTINCT c.table_name
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public'
        AND c.column_name = 'tenant_id'
        AND t.table_type = 'BASE TABLE'
    `);

    const candidates = new Set();
    for (const row of cols.rows) {
      if (!EXCLUDE.has(row.table_name)) candidates.add(row.table_name);
    }
    for (const t of JOIN_POLICY_TABLES) candidates.add(t);

    if (candidates.size === 0) {
      console.error(
        "verify-rls: found 0 tenant-scoped tables — has database/schema.sql been applied to this DB?",
      );
      process.exit(1);
    }

    // 2. RLS flags for every public table.
    const flags = await client.query(`
      SELECT c.relname AS name,
             c.relrowsecurity AS rls,
             c.relforcerowsecurity AS force
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
    `);
    const flagByTable = new Map();
    for (const row of flags.rows) {
      flagByTable.set(row.name, { rls: row.rls === true, force: row.force === true });
    }

    // 3. Tables that have at least one row-level policy.
    const pols = await client.query(`
      SELECT tablename, count(*)::int AS n
      FROM pg_policies
      WHERE schemaname = 'public'
      GROUP BY tablename
    `);
    const policyCount = new Map();
    for (const row of pols.rows) policyCount.set(row.tablename, row.n);

    // 4. Assert RLS + FORCE + policy for each candidate.
    const violations = [];
    for (const table of [...candidates].sort()) {
      const f = flagByTable.get(table);
      if (!f) {
        violations.push(`${table}: table not found in pg_class (missing from this DB)`);
        continue;
      }
      const missing = [];
      if (!f.rls) missing.push("RLS not enabled");
      if (!f.force) missing.push("FORCE not set");
      if ((policyCount.get(table) || 0) < 1) missing.push("no row-level policy");
      if (missing.length > 0) {
        violations.push(`${table}: ${missing.join(", ")}`);
      }
    }

    if (violations.length > 0) {
      console.error(`FAIL: ${violations.length} RLS violation(s) across ${candidates.size} tenant table(s):`);
      for (const v of violations) console.error(`  \u2717 ${v}`);
      console.error(
        "\nFix: ensure database/policies/rls.sql was applied (the db-migrate pipeline does this),\n" +
          "and that the table is listed in tenant_tables (delegate to schema-agent).",
      );
      process.exit(1);
    }

    console.log(
      `RLS verified: ${candidates.size} tenant tables all have RLS + FORCE + at least one policy.`,
    );
    process.exit(0);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(`verify-rls: ${err.message}`);
  process.exit(1);
});
