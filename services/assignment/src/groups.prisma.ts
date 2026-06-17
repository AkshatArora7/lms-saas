import { withTenant } from "@lms/db";

import type {
  AddMemberResult,
  CreateGroupResult,
  GroupDetail,
  GroupRecord,
  GroupStore,
} from "./groups.js";

interface GroupRow {
  id: string;
  tenant_id: string;
  assignment_id: string;
  name: string;
  created_at: Date | string;
}

interface Db {
  $queryRawUnsafe<T>(sql: string, ...args: unknown[]): Promise<T>;
  $executeRawUnsafe(sql: string, ...args: unknown[]): Promise<number>;
}

function toGroup(row: GroupRow): GroupRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    assignmentId: row.assignment_id,
    name: row.name,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
  };
}

async function membersOf(db: Db, groupId: string): Promise<string[]> {
  const rows = await db.$queryRawUnsafe<{ user_id: string }[]>(
    `SELECT user_id FROM assignment_group_member WHERE group_id = $1::uuid
      ORDER BY added_at`,
    groupId,
  );
  return rows.map((r) => r.user_id);
}

const COLS = `id, tenant_id, assignment_id, name, created_at`;

/**
 * Postgres-backed group store. RLS-scoped via withTenant; uuid params cast.
 * A learner is kept to one group per assignment by checking sibling groups.
 */
export function createPrismaGroupStore(): GroupStore {
  return {
    async createGroup(ctx, assignmentId, name): Promise<CreateGroupResult> {
      return withTenant<CreateGroupResult>(ctx, async (db: Db) => {
        const a = await db.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id FROM assignment WHERE id = $1::uuid LIMIT 1`,
          assignmentId,
        );
        if (a.length === 0) return { ok: false, reason: "assignment_not_found" };
        const rows = await db.$queryRawUnsafe<GroupRow[]>(
          `INSERT INTO assignment_group (tenant_id, assignment_id, name)
           VALUES ($1::uuid, $2::uuid, $3) RETURNING ${COLS}`,
          ctx.tenantId,
          assignmentId,
          name,
        );
        return { ok: true, group: toGroup(rows[0]!) };
      });
    },

    async listGroups(ctx, assignmentId): Promise<GroupDetail[]> {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<GroupRow[]>(
          `SELECT ${COLS} FROM assignment_group WHERE assignment_id = $1::uuid
            ORDER BY name`,
          assignmentId,
        );
        const out: GroupDetail[] = [];
        for (const row of rows) {
          out.push({ ...toGroup(row), members: await membersOf(db, row.id) });
        }
        return out;
      });
    },

    async getGroup(ctx, id): Promise<GroupDetail | null> {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<GroupRow[]>(
          `SELECT ${COLS} FROM assignment_group WHERE id = $1::uuid LIMIT 1`,
          id,
        );
        if (rows.length === 0) return null;
        return { ...toGroup(rows[0]!), members: await membersOf(db, id) };
      });
    },

    async deleteGroup(ctx, id): Promise<boolean> {
      return withTenant(ctx, async (db: Db) => {
        const n = await db.$executeRawUnsafe(
          `DELETE FROM assignment_group WHERE id = $1::uuid`,
          id,
        );
        return n > 0;
      });
    },

    async addMember(ctx, groupId, userId): Promise<AddMemberResult> {
      return withTenant<AddMemberResult>(ctx, async (db: Db) => {
        const grp = await db.$queryRawUnsafe<{ assignment_id: string }[]>(
          `SELECT assignment_id FROM assignment_group WHERE id = $1::uuid LIMIT 1`,
          groupId,
        );
        if (grp.length === 0) return { ok: false, reason: "group_not_found" };
        // Reject if the user is already in a sibling group of this assignment.
        const dupe = await db.$queryRawUnsafe<{ one: number }[]>(
          `SELECT 1 AS one
             FROM assignment_group_member m
             JOIN assignment_group g ON g.id = m.group_id
            WHERE g.assignment_id = $1::uuid AND m.user_id = $2::uuid
              AND m.group_id <> $3::uuid
            LIMIT 1`,
          grp[0]!.assignment_id,
          userId,
          groupId,
        );
        if (dupe.length > 0) return { ok: false, reason: "already_in_a_group" };
        await db.$executeRawUnsafe(
          `INSERT INTO assignment_group_member (tenant_id, group_id, user_id)
           VALUES ($1::uuid, $2::uuid, $3::uuid)
           ON CONFLICT (group_id, user_id) DO NOTHING`,
          ctx.tenantId,
          groupId,
          userId,
        );
        return { ok: true, members: await membersOf(db, groupId) };
      });
    },

    async removeMember(ctx, groupId, userId): Promise<boolean> {
      return withTenant(ctx, async (db: Db) => {
        const n = await db.$executeRawUnsafe(
          `DELETE FROM assignment_group_member
            WHERE group_id = $1::uuid AND user_id = $2::uuid`,
          groupId,
          userId,
        );
        return n > 0;
      });
    },

    async groupForUser(ctx, assignmentId, userId): Promise<GroupRecord | null> {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<GroupRow[]>(
          `SELECT g.id, g.tenant_id, g.assignment_id, g.name, g.created_at
             FROM assignment_group g
             JOIN assignment_group_member m ON m.group_id = g.id
            WHERE g.assignment_id = $1::uuid AND m.user_id = $2::uuid
            LIMIT 1`,
          assignmentId,
          userId,
        );
        return rows[0] ? toGroup(rows[0]) : null;
      });
    },
  };
}
