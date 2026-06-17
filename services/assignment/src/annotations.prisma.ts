import { withTenant } from "@lms/db";
import { EVENT_TYPES } from "@lms/events";

import type {
  AnnotationRecord,
  AnnotationStore,
  CreateAnnotationResult,
  NewAnnotationInput,
  ReleaseResult,
  UpdateAnnotationInput,
} from "./annotations.js";

interface AnnotationRow {
  id: string;
  tenant_id: string;
  submission_id: string;
  author_id: string | null;
  body: string;
  anchor: unknown;
  released: boolean;
  created_at: Date | string;
}

interface Db {
  $queryRawUnsafe<T>(sql: string, ...args: unknown[]): Promise<T>;
  $executeRawUnsafe(sql: string, ...args: unknown[]): Promise<number>;
}

function asObject(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  if (typeof v === "string") {
    try {
      const p = JSON.parse(v);
      return p && typeof p === "object" ? p : {};
    } catch {
      return {};
    }
  }
  return {};
}

function toRecord(row: AnnotationRow): AnnotationRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    submissionId: row.submission_id,
    authorId: row.author_id,
    body: row.body,
    anchor: asObject(row.anchor),
    released: row.released,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
  };
}

const COLS = `id, tenant_id, submission_id, author_id, body, anchor, released, created_at`;

/**
 * Postgres-backed annotation store. RLS-scoped via withTenant; uuid params cast.
 * Releasing feedback flips visibility, returns the submission, and emits an
 * event (consumed by notification) — all in one transaction.
 */
export function createPrismaAnnotationStore(): AnnotationStore {
  return {
    async createAnnotation(
      ctx,
      submissionId,
      input: NewAnnotationInput,
    ): Promise<CreateAnnotationResult> {
      return withTenant<CreateAnnotationResult>(ctx, async (db: Db) => {
        const sub = await db.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id FROM submission WHERE id = $1::uuid LIMIT 1`,
          submissionId,
        );
        if (sub.length === 0) return { ok: false, reason: "submission_not_found" };
        const rows = await db.$queryRawUnsafe<AnnotationRow[]>(
          `INSERT INTO submission_annotation
             (tenant_id, submission_id, author_id, body, anchor)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::jsonb)
           RETURNING ${COLS}`,
          ctx.tenantId,
          submissionId,
          input.authorId ?? null,
          input.body,
          JSON.stringify(input.anchor ?? {}),
        );
        return { ok: true, annotation: toRecord(rows[0]!) };
      });
    },

    async listAnnotations(ctx, submissionId, opts = {}) {
      return withTenant(ctx, async (db: Db) => {
        const where = opts.releasedOnly
          ? `WHERE submission_id = $1::uuid AND released = true`
          : `WHERE submission_id = $1::uuid`;
        const rows = await db.$queryRawUnsafe<AnnotationRow[]>(
          `SELECT ${COLS} FROM submission_annotation ${where} ORDER BY created_at`,
          submissionId,
        );
        return rows.map(toRecord);
      });
    },

    async updateAnnotation(ctx, id, input: UpdateAnnotationInput) {
      return withTenant(ctx, async (db: Db) => {
        const sets: string[] = [];
        const params: unknown[] = [];
        if (input.body !== undefined) {
          params.push(input.body);
          sets.push(`body = $${params.length}`);
        }
        if (input.anchor !== undefined) {
          params.push(JSON.stringify(input.anchor));
          sets.push(`anchor = $${params.length}::jsonb`);
        }
        if (sets.length === 0) {
          const cur = await db.$queryRawUnsafe<AnnotationRow[]>(
            `SELECT ${COLS} FROM submission_annotation WHERE id = $1::uuid LIMIT 1`,
            id,
          );
          return cur[0] ? toRecord(cur[0]) : null;
        }
        params.push(id);
        const rows = await db.$queryRawUnsafe<AnnotationRow[]>(
          `UPDATE submission_annotation SET ${sets.join(", ")}
            WHERE id = $${params.length}::uuid RETURNING ${COLS}`,
          ...params,
        );
        return rows[0] ? toRecord(rows[0]) : null;
      });
    },

    async deleteAnnotation(ctx, id) {
      return withTenant(ctx, async (db: Db) => {
        const n = await db.$executeRawUnsafe(
          `DELETE FROM submission_annotation WHERE id = $1::uuid`,
          id,
        );
        return n > 0;
      });
    },

    async releaseFeedback(ctx, submissionId): Promise<ReleaseResult> {
      return withTenant<ReleaseResult>(ctx, async (db: Db) => {
        const sub = await db.$queryRawUnsafe<{ user_id: string }[]>(
          `SELECT user_id FROM submission WHERE id = $1::uuid LIMIT 1`,
          submissionId,
        );
        if (sub.length === 0) return { ok: false, reason: "submission_not_found" };
        const recipientId = sub[0]!.user_id;

        const released = await db.$executeRawUnsafe(
          `UPDATE submission_annotation SET released = true
            WHERE submission_id = $1::uuid AND released = false`,
          submissionId,
        );
        await db.$executeRawUnsafe(
          `UPDATE submission SET status = 'returned' WHERE id = $1::uuid`,
          submissionId,
        );
        await db.$executeRawUnsafe(
          `INSERT INTO event_outbox (tenant_id, type, payload)
           VALUES ($1::uuid, $2, $3::jsonb)`,
          ctx.tenantId,
          EVENT_TYPES.SUBMISSION_FEEDBACK_RELEASED,
          JSON.stringify({
            submissionId,
            recipientIds: [recipientId],
            title: "Feedback is ready on your submission",
          }),
        );
        return { ok: true, released, recipientId };
      });
    },
  };
}
