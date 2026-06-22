#!/usr/bin/env node
// Schema drift check (live, database-level) — AC2 of issue #82.
//
// Compares a TARGET database against a CANONICAL database (one freshly built
// from `database/schema.sql`, the source-of-truth shape) using Prisma's
// `migrate diff`. Runs identically locally and in CI.
//
//   FROM_URL  — canonical DB url (fresh `database/schema.sql` applied)
//   TO_URL    — target DB url (the migrated / live DB to validate)
//   PRISMA_CMD (optional) — how to invoke the prisma CLI; defaults to the
//                           workspace binary via pnpm so it works from repo root.
//
// Interpreting `prisma migrate diff --exit-code`:
//   0 → no difference            → PASS (target matches canonical schema)
//   2 → a difference was found   → FAIL (drift; the SQL diff is printed) → exit 1
//   other → prisma error         → exit that code (or 1)
//
// `--script` makes prisma emit the SQL that would migrate FROM → TO, so a drift
// failure prints exactly what differs.

import { spawnSync } from "node:child_process";

function requireEnv(name) {
  const v = process.env[name];
  if (!v || v.length === 0) {
    console.error(
      `check-drift: missing required env ${name}.\n` +
        "  FROM_URL = canonical DB (fresh database/schema.sql)\n" +
        "  TO_URL   = target DB to validate against canonical",
    );
    process.exit(2);
  }
  return v;
}

function main() {
  const fromUrl = requireEnv("FROM_URL");
  const toUrl = requireEnv("TO_URL");
  // Default to the workspace prisma so this runs from the repo root after
  // `pnpm install`. Override with PRISMA_CMD for other layouts (e.g. `npx prisma`).
  const prismaCmd = process.env.PRISMA_CMD || "pnpm --filter @lms/db exec prisma";

  const command =
    `${prismaCmd} migrate diff ` +
    `--from-url "${fromUrl}" ` +
    `--to-url "${toUrl}" ` +
    `--script --exit-code`;

  console.log("check-drift — comparing TARGET against CANONICAL (schema.sql)");
  console.log(`  $ ${prismaCmd} migrate diff --from-url <canonical> --to-url <target> --script --exit-code`);

  const res = spawnSync(command, {
    shell: true,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (res.error) {
    console.error(`check-drift: failed to run prisma: ${res.error.message}`);
    process.exit(1);
  }

  const stdout = res.stdout || "";
  const stderr = res.stderr || "";

  if (res.status === 0) {
    console.log("\nOK: no schema drift. TARGET matches CANONICAL (database/schema.sql).");
    process.exit(0);
  }

  if (res.status === 2) {
    console.error("\nFAIL: schema drift detected between CANONICAL and TARGET.");
    console.error("The following SQL would be required to reconcile TARGET → CANONICAL shape:\n");
    if (stdout.trim()) console.error(stdout);
    if (stderr.trim()) console.error(stderr);
    console.error(
      "\nFix: apply database/schema.sql to the target (the db-migrate pipeline does this),\n" +
        "or update database/schema.sql if the canonical shape is meant to change.",
    );
    process.exit(1);
  }

  console.error(`\nERROR: prisma migrate diff exited with status ${res.status}.`);
  if (stdout.trim()) console.error(stdout);
  if (stderr.trim()) console.error(stderr);
  process.exit(res.status || 1);
}

main();
