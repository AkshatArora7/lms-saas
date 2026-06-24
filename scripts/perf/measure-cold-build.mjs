#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Reproducible cold-build wall-clock measurement for the LMS Docker mesh (#369).
//
// Measures the time to build every buildable image FROM SCRATCH (no BuildKit
// layer cache, no pnpm store) so the shared-base (L5) before/after can be
// compared apples-to-apples on a documented reference machine.
//
// What it does:
//   1. Prints reference-machine info (docker version + docker info: CPU/RAM/arch/OS).
//   2. Cold reset:  `docker builder prune -af`  (drops all build cache + the
//      shared pnpm-store cache mount).  With --hard it also removes the built
//      lms-* / mesh image tags so nothing is reused.
//   3. Times `pnpm build:base` (the one-time shared base/deps install).
//   4. Times `docker compose -f docker-compose.yml -f docker-compose.build.yml build`
//      (all ~29 service/app/seed images), OR a single representative service in
//      --smoke mode (default: grading).
//   5. Prints a labeled summary: base time, mesh/service time, total wall-clock.
//
// Run the SAME invocation on `origin/main` (before) and this branch (after),
// each after a cold reset, back-to-back on the same machine. On `origin/main`
// (no docker/base.Dockerfile) pass --no-base so it only times the compose build.
//
// Usage:
//   node scripts/perf/measure-cold-build.mjs              # full mesh, with base
//   node scripts/perf/measure-cold-build.mjs --smoke      # base + grading only
//   node scripts/perf/measure-cold-build.mjs --smoke=web  # base + web only
//   node scripts/perf/measure-cold-build.mjs --no-base    # skip pnpm build:base
//   node scripts/perf/measure-cold-build.mjs --no-reset   # skip the cold reset
//   node scripts/perf/measure-cold-build.mjs --hard       # also `docker image rm` mesh tags
//   node scripts/perf/measure-cold-build.mjs --warm       # do NOT prune (warm rebuild timing)
// -----------------------------------------------------------------------------
import { execSync, spawnSync } from "node:child_process";
import os from "node:os";

const argv = process.argv.slice(2);
const has = (name) => argv.some((a) => a === name || a.startsWith(`${name}=`));
const val = (name, def) => {
  const hit = argv.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : def;
};

const SMOKE = has("--smoke");
const SMOKE_SVC = val("--smoke", "grading");
const NO_BASE = has("--no-base");
const NO_RESET = has("--no-reset");
const WARM = has("--warm");
const HARD = has("--hard");

const COMPOSE = [
  "compose",
  "-f",
  "docker-compose.yml",
  "-f",
  "docker-compose.build.yml",
];

const env = { ...process.env, DOCKER_BUILDKIT: "1", COMPOSE_DOCKER_CLI_BUILD: "1" };

function sh(cmd, args, { capture = false } = {}) {
  const r = spawnSync(cmd, args, {
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    env,
    shell: false,
    encoding: "utf8",
  });
  if (capture) return (r.stdout || "").trim();
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} exited ${r.status}`);
  }
  return "";
}

function tryCapture(cmd, args) {
  try {
    return sh(cmd, args, { capture: true });
  } catch {
    return "(unavailable)";
  }
}

function timed(label, fn) {
  const start = process.hrtime.bigint();
  fn();
  const sec = Number(process.hrtime.bigint() - start) / 1e9;
  console.log(`\n[timing] ${label}: ${sec.toFixed(1)}s`);
  return sec;
}

function header() {
  console.log("=".repeat(70));
  console.log("LMS Docker cold-build measurement (#369, shared base/deps L5)");
  console.log("=".repeat(70));
  console.log(`date            : ${new Date().toISOString()}`);
  console.log(`mode            : ${SMOKE ? `SMOKE (${SMOKE_SVC} only)` : "FULL MESH"}`);
  console.log(`reset           : ${WARM ? "WARM (no prune)" : NO_RESET ? "skipped" : HARD ? "builder prune -af + image rm" : "builder prune -af"}`);
  console.log(`build:base      : ${NO_BASE ? "skipped (--no-base)" : "yes"}`);
  console.log("-".repeat(70));
  console.log("Reference machine:");
  console.log(`  host OS       : ${os.type()} ${os.release()} (${os.arch()})`);
  console.log(`  host CPUs     : ${os.cpus().length} x ${os.cpus()[0]?.model?.trim() ?? "?"}`);
  console.log(`  host RAM      : ${(os.totalmem() / 1024 ** 3).toFixed(1)} GiB`);
  const dockerVer = tryCapture("docker", ["version", "--format", "{{.Server.Version}}"]);
  const info = tryCapture("docker", [
    "info",
    "--format",
    "{{.OperatingSystem}} | {{.NCPU}} CPU | {{.MemTotal}} bytes | {{.Architecture}} | engine {{.ServerVersion}}",
  ]);
  console.log(`  docker engine : ${dockerVer}`);
  console.log(`  docker info   : ${info}`);
  console.log("=".repeat(70));
}

function coldReset() {
  if (WARM) {
    console.log("\n[reset] WARM run — skipping prune (measuring cached rebuild).");
    return;
  }
  if (NO_RESET) {
    console.log("\n[reset] --no-reset — skipping cold reset.");
    return;
  }
  console.log("\n[reset] docker builder prune -af (dropping build cache + pnpm store mount)...");
  sh("docker", ["builder", "prune", "-af"]);
  if (HARD) {
    console.log("[reset] --hard — removing built mesh image tags...");
    // Remove the shared base and any ghcr.io/.../lms-saas/* tags so nothing is reused.
    const ids = tryCapture("docker", [
      "images",
      "--format",
      "{{.Repository}}:{{.Tag}}",
    ])
      .split(/\r?\n/)
      .filter((l) => l.includes("lms-base-deps") || l.includes("lms-saas/"));
    for (const tag of ids) {
      try {
        execSync(`docker image rm -f ${tag}`, { stdio: "ignore", env });
      } catch {
        /* tag may not exist; ignore */
      }
    }
  }
}

function main() {
  header();
  coldReset();

  let baseSec = 0;
  if (!NO_BASE) {
    baseSec = timed("pnpm build:base (shared base/deps install, ONE time)", () => {
      sh("docker", ["build", "-f", "docker/base.Dockerfile", "-t", "lms-base-deps:local", "."]);
    });
  }

  let buildSec;
  if (SMOKE) {
    buildSec = timed(`docker compose build ${SMOKE_SVC} (representative smoke)`, () => {
      sh("docker", [...COMPOSE, "build", SMOKE_SVC]);
    });
  } else {
    buildSec = timed("docker compose build (FULL mesh, all ~29 images)", () => {
      sh("docker", [...COMPOSE, "build"]);
    });
  }

  const total = baseSec + buildSec;
  console.log("\n" + "=".repeat(70));
  console.log("SUMMARY");
  console.log("-".repeat(70));
  if (!NO_BASE) console.log(`  base/deps (1x)      : ${baseSec.toFixed(1)}s`);
  console.log(`  ${SMOKE ? `service (${SMOKE_SVC})    ` : "mesh (compose build)"}: ${buildSec.toFixed(1)}s`);
  console.log(`  TOTAL wall-clock    : ${total.toFixed(1)}s (${(total / 60).toFixed(1)} min)`);
  console.log("=".repeat(70));
  console.log(
    "\nRecord this number against the branch under test (origin/main = before, " +
      "perf/docker-shared-base = after). Run both cold, back-to-back, same machine.",
  );
}

main();
