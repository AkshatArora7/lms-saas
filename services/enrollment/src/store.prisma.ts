import { withTenant } from "@lms/db";

import type {
  CreateEnrollmentResult,
  EnrollmentRecord,
  EnrollmentStatus,
  EnrollmentStore,
  NewEnrollmentInput,
  UpdateEnrollmentResult,
} from "./store.js";

interface EnrollmentRow {
  id: string;
  tenant_id: string;
  user_id: string;
  org_unit_id: string;
  role: string | null;
  status: EnrollmentStatus;
  enrolled_at: Date | string;
}

function toRecord(row: EnrollmentRow): EnrollmentRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    orgUnitId: row.org_unit_id,
    role: row.role ?? "",
    status: row.status,
    enrolledAt:
      row.enrolled_at instanceof Date
        ? row.enrolled_at.toISOString()
        : String(row.enrolled_at),
  };
}

const SELECT_JOINED = `
  SELECT e.id, e.tenant_id, e.user_id, e.org_unit_id, r.name AS role,
         e.status, e.enrolled_at
    FROM enrollment e
    LEFT JOIN role r ON r.id = e.role_id`;

/**
 * Postgres-backed enrollment store. Every call runs through `withTenant`, so all
 * statements execute inside an RLS-scoped transaction (pool) or against the
 * tenant's silo database — rows can never leak across tenants. Role names are
 * resolved against the per-tenant `role` table.
 */
export function createPrismaStore(): EnrollmentStore {
  return {
    async createEnrollment(ctx, input: NewEnrollmentInput) {
      return withTenant<CreateEnrollmentResult>(ctx, async (db) => {
        const roleRows = await db.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id FROM role WHERE name = $1 LIMIT 1`,
          input.role,
        );
        const roleId = roleRows[0]?.id;
        if (!roleId) return { ok: false, reason: "unknown_role" };

        const inserted = await db.$queryRawUnsafe<{ id: string }[]>(
          `INSERT INTO enrollment (tenant_id, user_id, org_unit_id, role_id)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid)
           ON CONFLICT (user_id, org_unit_id) DO NOTHING
           RETURNING id`,
          ctx.tenantId,
          input.userId,
          input.orgUnitId,
          roleId,
        );
        if (inserted.length === 0) {
          return { ok: false, reason: "already_enrolled" };
        }
        const rows = await db.$queryRawUnsafe<EnrollmentRow[]>(
          `${SELECT_JOINED} WHERE e.id = $1::uuid`,
          inserted[0]!.id,
        );
        return { ok: true, enrollment: toRecord(rows[0]!) };
      });
    },

    async getEnrollment(ctx, id) {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<EnrollmentRow[]>(
          `${SELECT_JOINED} WHERE e.id = $1::uuid LIMIT 1`,
          id,
        );
        const row = rows[0];
        return row ? toRecord(row) : null;
      });
    },

    async dropEnrollment(ctx, id) {
      return withTenant(ctx, async (db) => {
        const updated = await db.$executeRawUnsafe(
          `UPDATE enrollment SET status = 'withdrawn' WHERE id = $1::uuid`,
          id,
        );
        if (updated === 0) return null;
        const rows = await db.$queryRawUnsafe<EnrollmentRow[]>(
          `${SELECT_JOINED} WHERE e.id = $1::uuid LIMIT 1`,
          id,
        );
        return rows[0] ? toRecord(rows[0]) : null;
      });
    },

    async updateEnrollmentRole(ctx, id, role) {
      return withTenant<UpdateEnrollmentResult>(ctx, async (db) => {
        const roleRows = await db.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id FROM role WHERE name = $1 LIMIT 1`,
          role,
        );
        const roleId = roleRows[0]?.id;
        if (!roleId) return { ok: false, reason: "unknown_role" };

        const updated = await db.$executeRawUnsafe(
          `UPDATE enrollment SET role_id = $1::uuid WHERE id = $2::uuid`,
          roleId,
          id,
        );
        if (updated === 0) return { ok: false, reason: "not_found" };
        const rows = await db.$queryRawUnsafe<EnrollmentRow[]>(
          `${SELECT_JOINED} WHERE e.id = $1::uuid LIMIT 1`,
          id,
        );
        return { ok: true, enrollment: toRecord(rows[0]!) };
      });
    },

    async completeEnrollment(ctx, id) {
      return withTenant(ctx, async (db) => {
        const updated = await db.$executeRawUnsafe(
          `UPDATE enrollment SET status = 'completed' WHERE id = $1::uuid`,
          id,
        );
        if (updated === 0) return null;
        const rows = await db.$queryRawUnsafe<EnrollmentRow[]>(
          `${SELECT_JOINED} WHERE e.id = $1::uuid LIMIT 1`,
          id,
        );
        return rows[0] ? toRecord(rows[0]) : null;
      });
    },

    async getRoster(ctx, orgUnitId) {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<EnrollmentRow[]>(
          `${SELECT_JOINED}
            WHERE e.org_unit_id = $1::uuid AND e.status = 'active'
            ORDER BY e.enrolled_at`,
          orgUnitId,
        );
        return rows.map(toRecord);
      });
    },

    async listForUser(ctx, userId) {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<EnrollmentRow[]>(
          `${SELECT_JOINED} WHERE e.user_id = $1::uuid ORDER BY e.enrolled_at`,
          userId,
        );
        return rows.map(toRecord);
      });
    },
  };
}
