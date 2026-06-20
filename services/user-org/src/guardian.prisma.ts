import { withTenant } from "@lms/db";
import { EVENT_TYPES } from "@lms/events";

import type {
  CreateRelationshipInput,
  CreateRelationshipResult,
  GuardianKind,
  GuardianRelationshipRecord,
  GuardianStatus,
  GuardianStore,
} from "./guardian.js";

interface GuardianRow {
  id: string;
  tenant_id: string;
  guardian_user_id: string;
  student_user_id: string;
  relationship: GuardianKind;
  status: GuardianStatus;
  consent_id: string | null;
  note: string | null;
  created_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  revoked_at: Date | string | null;
}

/** Minimal raw-SQL surface, so the store can run inside withTenant's tx. */
interface Db {
  $queryRawUnsafe<T>(sql: string, ...args: unknown[]): Promise<T>;
  $executeRawUnsafe(sql: string, ...args: unknown[]): Promise<number>;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function isoOrNull(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function toRelationship(row: GuardianRow): GuardianRelationshipRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    guardianUserId: row.guardian_user_id,
    studentUserId: row.student_user_id,
    relationship: row.relationship,
    status: row.status,
    consentId: row.consent_id,
    note: row.note,
    createdBy: row.created_by,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    revokedAt: isoOrNull(row.revoked_at),
  };
}

const COLUMNS = `id, tenant_id, guardian_user_id, student_user_id, relationship,
  status, consent_id, note, created_by, created_at, updated_at, revoked_at`;

/**
 * Write a transactional outbox row in the SAME tx as the domain change (mirrors
 * the org/user store). Runs under the tenant GUC set by withTenant, so the
 * outbox RLS WITH CHECK (tenant_id = current_tenant_id()) passes.
 */
async function emitEvent(
  db: Db,
  tenantId: string,
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await db.$executeRawUnsafe(
    `INSERT INTO event_outbox (tenant_id, type, org_unit_id, payload)
     VALUES ($1::uuid, $2, $3::uuid, $4::jsonb)`,
    tenantId,
    type,
    null,
    JSON.stringify(payload),
  );
}

/**
 * Postgres-backed guardian-relationship store. Every call runs through
 * `withTenant`, so all statements execute inside an RLS-scoped transaction —
 * rows can never leak across tenants. Every uuid parameter is explicitly cast
 * (`$n::uuid`) because Prisma's $queryRawUnsafe binds string args as text.
 */
export function createPrismaGuardianStore(): GuardianStore {
  return {
    async createRelationship(
      ctx,
      input: CreateRelationshipInput,
    ): Promise<CreateRelationshipResult> {
      return withTenant<CreateRelationshipResult>(ctx, async (db: Db) => {
        const guardian = await db.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id FROM app_user WHERE id = $1::uuid LIMIT 1`,
          input.guardianUserId,
        );
        if (guardian.length === 0) {
          return { ok: false, reason: "guardian_not_found" };
        }
        const student = await db.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id FROM app_user WHERE id = $1::uuid LIMIT 1`,
          input.studentUserId,
        );
        if (student.length === 0) {
          return { ok: false, reason: "student_not_found" };
        }

        const rows = await db.$queryRawUnsafe<GuardianRow[]>(
          `INSERT INTO guardian_relationship
             (tenant_id, guardian_user_id, student_user_id, relationship,
              status, note, created_by)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'pending', $5, $6::uuid)
           ON CONFLICT (tenant_id, guardian_user_id, student_user_id)
           DO NOTHING
           RETURNING ${COLUMNS}`,
          ctx.tenantId,
          input.guardianUserId,
          input.studentUserId,
          input.relationship ?? "guardian",
          input.note ?? null,
          input.createdBy ?? null,
        );
        if (rows.length === 0) return { ok: false, reason: "link_exists" };

        const relationship = toRelationship(rows[0]!);
        await emitEvent(db, ctx.tenantId, EVENT_TYPES.GUARDIAN_LINKED, {
          guardianUserId: relationship.guardianUserId,
          studentUserId: relationship.studentUserId,
          status: relationship.status,
        });
        return { ok: true, relationship };
      });
    },

    async listGuardiansForStudent(ctx, studentUserId) {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<GuardianRow[]>(
          `SELECT ${COLUMNS} FROM guardian_relationship
            WHERE student_user_id = $1::uuid
            ORDER BY created_at`,
          studentUserId,
        );
        return rows.map(toRelationship);
      });
    },

    async listStudentsForGuardian(ctx, guardianUserId) {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<GuardianRow[]>(
          `SELECT ${COLUMNS} FROM guardian_relationship
            WHERE guardian_user_id = $1::uuid
            ORDER BY created_at`,
          guardianUserId,
        );
        return rows.map(toRelationship);
      });
    },

    async getRelationshipById(ctx, id) {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<GuardianRow[]>(
          `SELECT ${COLUMNS} FROM guardian_relationship
            WHERE id = $1::uuid LIMIT 1`,
          id,
        );
        return rows[0] ? toRelationship(rows[0]) : null;
      });
    },

    async activateRelationship(ctx, id, consentId) {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<GuardianRow[]>(
          `UPDATE guardian_relationship
              SET status = 'active', consent_id = $2::uuid
            WHERE id = $1::uuid
            RETURNING ${COLUMNS}`,
          id,
          consentId,
        );
        if (rows.length === 0) return null;
        const relationship = toRelationship(rows[0]!);
        await emitEvent(db, ctx.tenantId, EVENT_TYPES.GUARDIAN_LINKED, {
          guardianUserId: relationship.guardianUserId,
          studentUserId: relationship.studentUserId,
          status: relationship.status,
        });
        return relationship;
      });
    },

    async revokeRelationship(ctx, id) {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<GuardianRow[]>(
          `UPDATE guardian_relationship
              SET status = 'revoked', revoked_at = now()
            WHERE id = $1::uuid
            RETURNING ${COLUMNS}`,
          id,
        );
        if (rows.length === 0) return null;
        const relationship = toRelationship(rows[0]!);
        await emitEvent(db, ctx.tenantId, EVENT_TYPES.GUARDIAN_REVOKED, {
          guardianUserId: relationship.guardianUserId,
          studentUserId: relationship.studentUserId,
          status: relationship.status,
        });
        return relationship;
      });
    },

    async getRelationship(ctx, guardianUserId, studentUserId) {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<GuardianRow[]>(
          `SELECT ${COLUMNS} FROM guardian_relationship
            WHERE guardian_user_id = $1::uuid
              AND student_user_id = $2::uuid
            LIMIT 1`,
          guardianUserId,
          studentUserId,
        );
        return rows[0] ? toRelationship(rows[0]) : null;
      });
    },
  };
}
