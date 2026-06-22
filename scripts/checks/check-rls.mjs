#!/usr/bin/env node
// CLI wrapper for the RLS-invariant guard. Reads database/schema.sql and
// database/policies/rls.sql, applies the documented EXCEPTIONS allowlist, and
// fails (exit 1) if any tenant-scoped table lacks an RLS policy entry (or the
// list has drifted). Pure logic lives in lib/rls-invariant.mjs.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { findUnprotectedTables } from "./lib/rls-invariant.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");

// Documented allowlist: tables intentionally without a per-row `tenant_id`
// tenant_isolation policy. A reviewer must consciously extend this list.
const EXCEPTIONS = {
  tenant: "control plane; the tenant registry itself (no tenant_id)",
  plan: "global billing catalog shared across tenants (no tenant_id)",
  permission: "global permission catalog shared across tenants (no tenant_id)",
  role_permission: "join-based RLS via parent role (rls.sql tenant_isolation on role)",
  tenant_admin_delegation: "cross-tenant control plane; uses delegator/scope tenant ids, not tenant_id",
};

function main() {
  const schemaSql = readFileSync(resolve(repoRoot, "database/schema.sql"), "utf8");
  const rlsSql = readFileSync(resolve(repoRoot, "database/policies/rls.sql"), "utf8");

  const violations = findUnprotectedTables(schemaSql, rlsSql, Object.keys(EXCEPTIONS));

  console.log("check:rls — RLS-for-new-tenant-table invariant");
  console.log("Documented exceptions (allowlist):");
  for (const [name, reason] of Object.entries(EXCEPTIONS)) {
    console.log(`  - ${name}: ${reason}`);
  }

  if (violations.length > 0) {
    console.error(`\nFAIL: ${violations.length} RLS invariant violation(s):`);
    for (const v of violations) console.error(`  ✗ ${v}`);
    console.error(
      "\nFix: add the table to tenant_tables in database/policies/rls.sql (delegate to schema-agent),\n" +
        "or, if intentionally not tenant-scoped, add it to EXCEPTIONS in scripts/checks/check-rls.mjs with a reason.",
    );
    process.exit(1);
  }

  console.log("\nOK: every tenant-scoped table has an RLS policy entry. 0 violations.");
  process.exit(0);
}

main();
