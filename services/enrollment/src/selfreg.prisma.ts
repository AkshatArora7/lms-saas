import { withTenant } from "@lms/db";

import type {
  DecideResult,
  PolicyInput,
  RegistrationPolicy,
  RegistrationRequest,
  RequestStatus,
  SelfRegisterResult,
  SelfRegistrationStore,
} from "./selfreg.js";

/** Role granted to a self-enrolled learner. */
const SELF_ENROLL_ROLE = "learner";

interface PolicyRow {
  org_unit_id: string;
  is_open: boolean;
  requires_approval: boolean;
  capacity: number | null;
}
interface RequestRow {
  id: string;
  tenant_id: string;
  org_unit_id: string;
  user_id: string;
  status: RequestStatus;
  created_at: Date | string;
  decided_at: Date | string | null;
  decided_by: string | null;
}

interface Db {
  $queryRawUnsafe<T>(sql: string, ...args: unknown[]): Promise<T>;
  $executeRawUnsafe(sql: string, ...args: unknown[]): Promise<number>;
}

function toPolicy(row: PolicyRow): RegistrationPolicy {
  return {
    orgUnitId: row.org_unit_id,
    isOpen: row.is_open,
    requiresApproval: row.requires_approval,
    capacity: row.capacity,
  };
}
function iso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : String(v);
}
function toRequest(row: RequestRow): RegistrationRequest {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    orgUnitId: row.org_unit_id,
    userId: row.user_id,
    status: row.status,
    createdAt: iso(row.created_at),
    decidedAt: row.decided_at === null ? null : iso(row.decided_at),
    decidedBy: row.decided_by,
  };
}

const REQ_COLS = `id, tenant_id, org_unit_id, user_id, status, created_at, decided_at, decided_by`;

async function loadPolicy(db: Db, orgUnitId: string): Promise<PolicyRow | undefined> {
  const rows = await db.$queryRawUnsafe<PolicyRow[]>(
    `SELECT org_unit_id, is_open, requires_approval, capacity
       FROM self_registration_policy WHERE org_unit_id = $1::uuid LIMIT 1`,
    orgUnitId,
  );
  return rows[0];
}
async function activeCount(db: Db, orgUnitId: string): Promise<number> {
  const rows = await db.$queryRawUnsafe<{ n: number }[]>(
    `SELECT COUNT(*)::int AS n FROM enrollment
      WHERE org_unit_id = $1::uuid AND status = 'active'`,
    orgUnitId,
  );
  return rows[0]?.n ?? 0;
}
async function isEnrolled(db: Db, orgUnitId: string, userId: string): Promise<boolean> {
  const rows = await db.$queryRawUnsafe<{ one: number }[]>(
    `SELECT 1 AS one FROM enrollment
      WHERE org_unit_id = $1::uuid AND user_id = $2::uuid AND status = 'active' LIMIT 1`,
    orgUnitId,
    userId,
  );
  return rows.length > 0;
}
async function learnerRoleId(db: Db): Promise<string | undefined> {
  const rows = await db.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id FROM role WHERE name = $1 LIMIT 1`,
    SELF_ENROLL_ROLE,
  );
  return rows[0]?.id;
}
async function enroll(
  db: Db,
  tenantId: string,
  orgUnitId: string,
  userId: string,
  roleId: string,
): Promise<void> {
  await db.$executeRawUnsafe(
    `INSERT INTO enrollment (tenant_id, user_id, org_unit_id, role_id)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid)
     ON CONFLICT (user_id, org_unit_id) DO NOTHING`,
    tenantId,
    userId,
    orgUnitId,
    roleId,
  );
}
async function upsertRequest(
  db: Db,
  tenantId: string,
  orgUnitId: string,
  userId: string,
  status: RequestStatus,
  decided: boolean,
): Promise<RequestRow> {
  const rows = await db.$queryRawUnsafe<RequestRow[]>(
    `INSERT INTO self_registration_request
       (tenant_id, org_unit_id, user_id, status, decided_at)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4, ${decided ? "now()" : "NULL"})
     ON CONFLICT (tenant_id, org_unit_id, user_id) DO UPDATE
       SET status = EXCLUDED.status,
           decided_at = ${decided ? "now()" : "self_registration_request.decided_at"}
     RETURNING ${REQ_COLS}`,
    tenantId,
    orgUnitId,
    userId,
    status,
  );
  return rows[0]!;
}

/**
 * Postgres-backed self-registration store. Policy, requests and the enrollment
 * write all run inside one RLS-scoped withTenant transaction; uuid params cast.
 */
export function createPrismaSelfRegStore(): SelfRegistrationStore {
  return {
    async getPolicy(ctx, orgUnitId): Promise<RegistrationPolicy | null> {
      return withTenant(ctx, async (db: Db) => {
        const row = await loadPolicy(db, orgUnitId);
        return row ? toPolicy(row) : null;
      });
    },

    async setPolicy(ctx, orgUnitId, input: PolicyInput) {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<PolicyRow[]>(
          `INSERT INTO self_registration_policy
             (tenant_id, org_unit_id, is_open, requires_approval, capacity)
           VALUES ($1::uuid, $2::uuid, COALESCE($3, false), COALESCE($4, false), $5)
           ON CONFLICT (tenant_id, org_unit_id) DO UPDATE SET
             is_open           = COALESCE($3, self_registration_policy.is_open),
             requires_approval = COALESCE($4, self_registration_policy.requires_approval),
             capacity          = $5,
             updated_at        = now()
           RETURNING org_unit_id, is_open, requires_approval, capacity`,
          ctx.tenantId,
          orgUnitId,
          input.isOpen ?? null,
          input.requiresApproval ?? null,
          input.capacity ?? null,
        );
        return toPolicy(rows[0]!);
      });
    },

    async selfRegister(ctx, orgUnitId, userId): Promise<SelfRegisterResult> {
      return withTenant<SelfRegisterResult>(ctx, async (db: Db) => {
        const policy = await loadPolicy(db, orgUnitId);
        if (!policy || !policy.is_open) return { ok: false, reason: "closed" };
        if (await isEnrolled(db, orgUnitId, userId)) {
          return { ok: false, reason: "already_enrolled" };
        }
        const roleId = await learnerRoleId(db);
        if (!roleId) return { ok: false, reason: "unknown_role" };

        const atCapacity =
          policy.capacity !== null &&
          (await activeCount(db, orgUnitId)) >= policy.capacity;

        if (policy.requires_approval || atCapacity) {
          const req = await upsertRequest(
            db,
            ctx.tenantId,
            orgUnitId,
            userId,
            "pending",
            false,
          );
          return { ok: true, outcome: "pending", request: toRequest(req) };
        }
        await enroll(db, ctx.tenantId, orgUnitId, userId, roleId);
        const req = await upsertRequest(
          db,
          ctx.tenantId,
          orgUnitId,
          userId,
          "approved",
          true,
        );
        return { ok: true, outcome: "enrolled", request: toRequest(req) };
      });
    },

    async listRequests(ctx, orgUnitId, status?: RequestStatus) {
      return withTenant(ctx, async (db: Db) => {
        const rows = status
          ? await db.$queryRawUnsafe<RequestRow[]>(
              `SELECT ${REQ_COLS} FROM self_registration_request
                WHERE org_unit_id = $1::uuid AND status = $2 ORDER BY created_at`,
              orgUnitId,
              status,
            )
          : await db.$queryRawUnsafe<RequestRow[]>(
              `SELECT ${REQ_COLS} FROM self_registration_request
                WHERE org_unit_id = $1::uuid ORDER BY created_at`,
              orgUnitId,
            );
        return rows.map(toRequest);
      });
    },

    async decide(ctx, requestId, decision, decidedBy = null): Promise<DecideResult> {
      return withTenant<DecideResult>(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<RequestRow[]>(
          `SELECT ${REQ_COLS} FROM self_registration_request
            WHERE id = $1::uuid LIMIT 1`,
          requestId,
        );
        const req = rows[0];
        if (!req) return { ok: false, reason: "not_found" };
        if (req.status !== "pending") return { ok: false, reason: "not_pending" };

        if (decision === "deny") {
          const updated = await db.$queryRawUnsafe<RequestRow[]>(
            `UPDATE self_registration_request
                SET status = 'denied', decided_at = now(), decided_by = $2::uuid
              WHERE id = $1::uuid RETURNING ${REQ_COLS}`,
            requestId,
            decidedBy,
          );
          return { ok: true, outcome: "denied", request: toRequest(updated[0]!) };
        }

        // approve
        const policy = await loadPolicy(db, req.org_unit_id);
        if (
          policy?.capacity != null &&
          (await activeCount(db, req.org_unit_id)) >= policy.capacity
        ) {
          return { ok: false, reason: "at_capacity" };
        }
        const roleId = await learnerRoleId(db);
        if (!roleId) return { ok: false, reason: "unknown_role" };
        await enroll(db, ctx.tenantId, req.org_unit_id, req.user_id, roleId);
        const updated = await db.$queryRawUnsafe<RequestRow[]>(
          `UPDATE self_registration_request
              SET status = 'approved', decided_at = now(), decided_by = $2::uuid
            WHERE id = $1::uuid RETURNING ${REQ_COLS}`,
          requestId,
          decidedBy,
        );
        return { ok: true, outcome: "enrolled", request: toRequest(updated[0]!) };
      });
    },
  };
}
