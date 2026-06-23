#!/usr/bin/env node
// Runs the passed command with the PRIVILEGED migration DSN, when available.
//
// Sets DATABASE_URL := MIGRATION_DATABASE_URL ?? DATABASE_URL (and DIRECT_URL
// likewise, because Prisma `migrate deploy` connects via directUrl). Runtime
// services NEVER use this wrapper — only db migrate/seed tooling does, so the
// runtime DATABASE_URL (least-priv app_user) is untouched in service processes.
//
// Cross-platform: spawns through `pnpm exec` with shell:true so the OS shell
// resolves the `.cmd` shims for `prisma`/`tsx` on Windows and the bin on Linux.
//
// Never prints the DSN value (it is a secret) — only which source is in use.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("[with-migration-dsn] no command given");
  process.exit(2);
}

const migrationDsn = process.env.MIGRATION_DATABASE_URL;
if (migrationDsn && migrationDsn.length > 0) {
  // Prisma migrate deploy uses directUrl; align both so DDL/seed runs as the
  // privileged owner/migrator, not the least-priv app role.
  process.env.DATABASE_URL = migrationDsn;
  process.env.DIRECT_URL = migrationDsn;
  console.error(
    "[with-migration-dsn] using MIGRATION_DATABASE_URL for DDL/seed",
  );
} else {
  // Graceful fallback: leave DATABASE_URL/DIRECT_URL untouched (runtime DSN) so
  // repos/CI that have not set the new var keep working.
  console.error(
    "[with-migration-dsn] MIGRATION_DATABASE_URL unset — falling back to DATABASE_URL",
  );
}

// Run from the @lms/db package dir (one level up from scripts/).
const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));

// Build a single command string for shell:true. Our args (`prisma migrate
// deploy`, `tsx prisma/seed.ts`) contain no spaces/shell-meta, so this is safe
// and avoids the Windows args-array mis-quoting gotcha with shell:true.
const command = `pnpm exec ${args.join(" ")}`;
const child = spawn(command, {
  stdio: "inherit",
  shell: true,
  cwd: packageDir,
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
child.on("error", (err) => {
  console.error("[with-migration-dsn] failed to spawn:", err.message);
  process.exit(1);
});
