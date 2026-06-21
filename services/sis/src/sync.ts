/**
 * OneRoster roster sync engine (issue #14).
 *
 * Pure orchestration over the injected OneRoster source PORT and the SisStore —
 * it performs NO HTTP and NO direct DB access, so it is fully unit-testable with
 * a fake client + the memory store. It fetches orgs→users→classes→enrollments
 * in dependency order, resolves external parent refs via the id-map, upserts
 * each record idempotently, and accumulates a created/updated/skipped report
 * with per-record conflicts and errors. A transport failure from the port
 * aborts the run (status 'failed'); per-record issues never fail the run.
 */
import type { TenantContext } from "@lms/types";

import {
  OneRosterError,
  type OneRosterClient,
  type OneRosterFetchOptions,
} from "./oneroster.js";
import {
  addConflict,
  addError,
  addFetched,
  bumpOutcome,
  finishReport,
  mapClass,
  mapEnrollment,
  mapOneRosterUserToUpsert,
  mapOrg,
  newSyncReport,
  type SisStore,
  type SisSyncRun,
  type SyncMode,
} from "./store.js";

const SOURCE = "oneroster_rest";

export interface RunSyncOptions {
  /** Force a full pull regardless of any prior watermark. */
  full?: boolean;
  /** Override the run clock (tests); defaults to wall-clock ISO. */
  now?: () => string;
}

/**
 * Drive one sync run end to end. Returns the finished `sis_sync` row (status
 * 'succeeded' even with per-record conflicts/errors; 'failed' only on a
 * transport/auth error from the source).
 */
export async function runSync(
  ctx: TenantContext,
  client: OneRosterClient,
  store: SisStore,
  options: RunSyncOptions = {},
): Promise<SisSyncRun> {
  const now = options.now ?? (() => new Date().toISOString());

  // 1. Decide mode + delta watermark. Delta with no prior success → full.
  let mode: SyncMode = options.full ? "full" : "delta";
  let since: string | null = null;
  if (mode === "delta") {
    since = await store.lastSuccessfulSyncAt(ctx, SOURCE);
    if (since === null) mode = "full";
  }

  // 2. Open the run row.
  const run = await store.startSyncRun(ctx, { source: SOURCE, mode, since });
  const report = newSyncReport(mode, since, run.lastRunAt ?? now());
  const fetchOpts: OneRosterFetchOptions = since ? { since } : {};

  try {
    // 3a. Orgs — parents before children (resolve parent via id-map).
    const orgs = await client.listOrgs(fetchOpts);
    addFetched(report, "orgs", orgs.length);
    for (const rec of orgs) {
      const mapped = mapOrg(rec);
      if (!mapped.ok) {
        bumpOutcome(report, "orgs", "skipped");
        addError(report, { entityType: "org", sourcedId: rec.sourcedId, reason: mapped.reason, detail: mapped.detail });
        continue;
      }
      let parentInternalId: string | null = null;
      if (rec.parentSourcedId) {
        parentInternalId = await store.lookupInternalId(ctx, "org", rec.parentSourcedId);
        if (parentInternalId === null) {
          bumpOutcome(report, "orgs", "skipped");
          addConflict(report, {
            entityType: "org",
            sourcedId: rec.sourcedId,
            reason: "parent_unmapped",
            detail: `parent org '${rec.parentSourcedId}' not yet mapped`,
          });
          continue;
        }
      }
      const result = await store.upsertOrgUnit(ctx, { ...mapped.input, parentInternalId });
      bumpOutcome(report, "orgs", result.created ? "created" : "updated");
    }

    // 3b. Users.
    const users = await client.listUsers(fetchOpts);
    addFetched(report, "users", users.length);
    for (const rec of users) {
      const mapped = mapOneRosterUserToUpsert(rec);
      if (!mapped.ok) {
        bumpOutcome(report, "users", "skipped");
        addError(report, { entityType: "user", sourcedId: rec.sourcedId, reason: mapped.reason, detail: mapped.detail });
        continue;
      }
      const result = await store.upsertUser(ctx, mapped.input);
      bumpOutcome(report, "users", result.created ? "created" : "updated");
    }

    // 3c. Classes — resolve owning school via id-map.
    const classes = await client.listClasses(fetchOpts);
    addFetched(report, "classes", classes.length);
    for (const rec of classes) {
      const mapped = mapClass(rec);
      if (!mapped.ok) {
        bumpOutcome(report, "classes", "skipped");
        addError(report, { entityType: "class", sourcedId: rec.sourcedId, reason: mapped.reason, detail: mapped.detail });
        continue;
      }
      let schoolInternalId: string | null = null;
      if (rec.orgSourcedId) {
        schoolInternalId = await store.lookupInternalId(ctx, "org", rec.orgSourcedId);
        if (schoolInternalId === null) {
          bumpOutcome(report, "classes", "skipped");
          addConflict(report, {
            entityType: "class",
            sourcedId: rec.sourcedId,
            reason: "school_unmapped",
            detail: `owning org '${rec.orgSourcedId}' not yet mapped`,
          });
          continue;
        }
      }
      const result = await store.upsertCourseClass(ctx, { ...mapped.input, schoolInternalId });
      bumpOutcome(report, "classes", result.created ? "created" : "updated");
    }

    // 3d. Enrollments — resolve user + class org_unit + role.
    const enrollments = await client.listEnrollments(fetchOpts);
    addFetched(report, "enrollments", enrollments.length);
    for (const rec of enrollments) {
      const mapped = mapEnrollment(rec);
      if (!mapped.ok) {
        bumpOutcome(report, "enrollments", "skipped");
        addError(report, { entityType: "enrollment", sourcedId: rec.sourcedId, reason: mapped.reason, detail: mapped.detail });
        continue;
      }
      const userInternalId = await store.lookupInternalId(ctx, "user", mapped.input.userSourcedId);
      const orgUnitInternalId = await store.lookupInternalId(ctx, "class", mapped.input.classSourcedId);
      if (userInternalId === null || orgUnitInternalId === null) {
        bumpOutcome(report, "enrollments", "skipped");
        addConflict(report, {
          entityType: "enrollment",
          sourcedId: rec.sourcedId,
          reason: userInternalId === null ? "user_unmapped" : "class_unmapped",
          detail:
            userInternalId === null
              ? `user '${mapped.input.userSourcedId}' not mapped`
              : `class '${mapped.input.classSourcedId}' not mapped`,
        });
        continue;
      }
      const roleId = await store.resolveRoleId(ctx, mapped.input.roleName);
      if (roleId === null) {
        bumpOutcome(report, "enrollments", "skipped");
        addConflict(report, {
          entityType: "enrollment",
          sourcedId: rec.sourcedId,
          reason: "unknown_role",
          detail: `role '${mapped.input.roleName}' not found for tenant`,
        });
        continue;
      }
      const result = await store.upsertEnrollment(ctx, {
        sourcedId: mapped.input.sourcedId,
        userInternalId,
        orgUnitInternalId,
        roleId,
        status: mapped.input.status,
      });
      bumpOutcome(report, "enrollments", result.created ? "created" : "updated");
    }
  } catch (err) {
    // Transport/auth failure aborts the run. Record it and mark failed.
    const isTransport = err instanceof OneRosterError;
    addError(report, {
      entityType: "run",
      sourcedId: "",
      reason: isTransport ? "transport_error" : "engine_error",
      detail: (err as Error).message,
    });
    return store.finishSyncRun(ctx, run.id, {
      status: "failed",
      stats: finishReport(report, now()),
    });
  }

  // 4. Success — partial conflicts/errors are surfaced in the report, not fatal.
  return store.finishSyncRun(ctx, run.id, {
    status: "succeeded",
    stats: finishReport(report, now()),
  });
}
