#!/usr/bin/env node
// CLI wrapper for the handshake-protocol guard. Reads the tracked protocol
// surfaces (handshake.template.md, docs/AGENT_DELEGATION_PROTOCOL.md,
// .claude/agents/README.md), globs the agent files, applies the documented
// EXCEPTIONS allowlist, and fails (exit 1) on any Guard A (template integrity)
// or Guard B (role drift) violation. Guard C (local handshake lint) runs over
// any present .claude/handshakes/*.md but is ADVISORY (non-fatal) — the live
// files are git-ignored, so CI sees none and the guard prints nothing there.
// Pure logic lives in lib/handshake-protocol.mjs (no FS there).

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  validateTemplate,
  findRoleDrift,
  validateHandshake,
  roleSlugsFromFilenames,
} from "./lib/handshake-protocol.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");

// Documented allowlist: files under .claude/agents/ that are NOT roles and must
// be excluded from the canonical role set. A reviewer must consciously extend
// this list (e.g. a future non-role helper file).
const EXCEPTIONS = {
  README: "agents README index, not an agent role definition",
  "handshake.template": "the handshake template, not an agent role definition",
};

function readFileOrEmpty(relPath) {
  try {
    return readFileSync(resolve(repoRoot, relPath), "utf8");
  } catch {
    return "";
  }
}

function listMd(relDir) {
  try {
    return readdirSync(resolve(repoRoot, relDir)).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }
}

function main() {
  console.log("check:handshake — delegation-protocol guards (template integrity + role drift)");
  console.log("Documented exceptions (non-role files under .claude/agents/):");
  for (const [name, reason] of Object.entries(EXCEPTIONS)) {
    console.log(`  - ${name}.md: ${reason}`);
  }

  const exceptionKeys = Object.keys(EXCEPTIONS);

  const templateMd = readFileOrEmpty(".claude/agents/handshake.template.md");
  const protocolDocMd = readFileOrEmpty("docs/AGENT_DELEGATION_PROTOCOL.md");
  const readmeMd = readFileOrEmpty(".claude/agents/README.md");
  const agentFilenames = listMd(".claude/agents");
  const canonicalSlugs = roleSlugsFromFilenames(agentFilenames, exceptionKeys);

  console.log(`\nCanonical roles (${canonicalSlugs.length}): ${canonicalSlugs.join(", ")}`);

  // ---- Guard A — template integrity (FATAL) ----
  const guardA = validateTemplate(templateMd);

  // ---- Guard B — role drift (FATAL) ----
  const guardB = findRoleDrift(agentFilenames, protocolDocMd, readmeMd, exceptionKeys);

  const fatal = [...guardA, ...guardB];

  // ---- Guard C — local handshake lint (ADVISORY / non-fatal) ----
  const handshakeFiles = listMd(".claude/handshakes").filter((f) => f !== "README.md");
  const guardC = [];
  for (const file of handshakeFiles) {
    const md = readFileOrEmpty(`.claude/handshakes/${file}`);
    guardC.push(...validateHandshake(file, md, canonicalSlugs));
  }

  if (guardA.length > 0) {
    console.error(`\nGuard A (template integrity) — ${guardA.length} violation(s):`);
    for (const v of guardA) console.error(`  ✗ ${v}`);
  }
  if (guardB.length > 0) {
    console.error(`\nGuard B (role drift) — ${guardB.length} violation(s):`);
    for (const v of guardB) console.error(`  ✗ ${v}`);
  }

  if (guardC.length > 0) {
    console.warn(
      `\nGuard C (local handshake lint, ADVISORY — non-fatal) — ${guardC.length} warning(s) across ${handshakeFiles.length} file(s):`,
    );
    for (const v of guardC) console.warn(`  ⚠ ${v}`);
  } else if (handshakeFiles.length > 0) {
    console.log(`\nGuard C (local handshake lint): ${handshakeFiles.length} file(s) checked, 0 warnings.`);
  }

  if (fatal.length > 0) {
    console.error(`\nFAIL: ${fatal.length} fatal handshake-protocol violation(s).`);
    console.error(
      "\nFix: restore the missing/renamed/reordered section in .claude/agents/handshake.template.md (Guard A),\n" +
        "or reconcile the role catalogue — add/remove the agent file under .claude/agents/ and its backticked entry in\n" +
        "docs/AGENT_DELEGATION_PROTOCOL.md AND .claude/agents/README.md (Guard B), or add an EXCEPTIONS entry with a reason.",
    );
    process.exit(1);
  }

  console.log("\nOK: template has all 7 sections in order; role catalogue is consistent. 0 fatal violations.");
  process.exit(0);
}

main();
