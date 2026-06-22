// Pure RLS-invariant guard logic. No FS, no git — operates over string inputs
// so it is fully unit-testable. See .claude/handshakes/feat-agents-contribution-ruleset.md §4.B (Guard 1).
//
// Invariant enforced: every table that declares its own `tenant_id uuid` column
// MUST be listed in the `tenant_tables` ARRAY[...] literal in rls.sql (so it gets
// an RLS tenant_isolation policy), and vice-versa the list must not name a table
// that is not tenant-scoped (drift the other way). Documented control-plane /
// join-based tables are passed in as `exceptions`.

/**
 * Parse the `tenant_tables text[] := ARRAY[ ... ];` literal from rls.sql into a
 * set of bare table names (single-quoted entries).
 * @param {string} rlsSql
 * @returns {string[]}
 */
export function parseTenantTables(rlsSql) {
  const match = rlsSql.match(/tenant_tables\s+text\[\]\s*:=\s*ARRAY\[([\s\S]*?)\]\s*;/);
  if (!match) return [];
  const body = match[1];
  const names = [];
  const re = /'([^']+)'/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    names.push(m[1]);
  }
  return names;
}

/**
 * Parse `CREATE TABLE IF NOT EXISTS <name> ( ... );` blocks from schema.sql and
 * return the names of those whose body declares a `tenant_id uuid` column.
 * @param {string} schemaSql
 * @returns {string[]}
 */
export function parseTenantScopedTables(schemaSql) {
  const tenantScoped = [];
  // Match each table name + its parenthesised body. Bodies in this schema do not
  // contain nested unbalanced parens at the top level that would break a
  // non-greedy capture up to the first `);` followed by a newline.
  const re = /CREATE TABLE IF NOT EXISTS\s+(\w+)\s*\(([\s\S]*?)\n\)\s*;/g;
  let m;
  while ((m = re.exec(schemaSql)) !== null) {
    const name = m[1];
    const body = m[2];
    if (/^\s*tenant_id\s+uuid/m.test(body)) {
      tenantScoped.push(name);
    }
  }
  return tenantScoped;
}

/**
 * Compute RLS-invariant violations over the raw SQL strings.
 *
 * @param {string} schemaSql  contents of database/schema.sql
 * @param {string} rlsSql     contents of database/policies/rls.sql
 * @param {string[]} [exceptions]  documented allowlist of table names skipped in
 *   both directions (control-plane / join-based tables).
 * @returns {string[]} human-readable violation messages; empty array = GREEN.
 */
export function findUnprotectedTables(schemaSql, rlsSql, exceptions = []) {
  const exempt = new Set(exceptions);
  const tenantScoped = parseTenantScopedTables(schemaSql).filter((t) => !exempt.has(t));
  const listed = parseTenantTables(rlsSql);
  const listedSet = new Set(listed);
  const tenantScopedSet = new Set(tenantScoped);

  const violations = [];

  // Forward drift: tenant-scoped table missing from tenant_tables.
  for (const t of tenantScoped) {
    if (!listedSet.has(t)) {
      violations.push(
        `tenant-scoped table "${t}" declares tenant_id but is MISSING from tenant_tables in rls.sql (no RLS policy)`,
      );
    }
  }

  // Reverse drift: a name in tenant_tables that is not a tenant-scoped table and
  // is not a documented exception.
  for (const t of listed) {
    if (exempt.has(t)) continue;
    if (!tenantScopedSet.has(t)) {
      violations.push(
        `tenant_tables lists "${t}" but no CREATE TABLE with a tenant_id uuid column was found for it (stale entry)`,
      );
    }
  }

  return violations;
}
