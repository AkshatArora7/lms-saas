import { withTenant } from "@lms/db";

import {
  buildSearchText,
  TYPEAHEAD_LIMIT,
  type IndexDocumentInput,
  type SearchDocumentRecord,
  type SearchFilter,
  type SearchHit,
  type SearchStore,
} from "./store.js";

interface DocumentRow {
  id: string;
  tenant_id: string;
  org_unit_id: string | null;
  entity_type: string;
  entity_id: string;
  title: string;
  body: string | null;
  search_text: string;
  embedding: unknown;
  updated_at: Date | string;
  created_at: Date | string;
}

interface HitRow {
  entity_type: string;
  entity_id: string;
  title: string;
  org_unit_id: string | null;
  score: number | string | null;
}

interface Db {
  $queryRawUnsafe<T>(sql: string, ...args: unknown[]): Promise<T>;
  $executeRawUnsafe(sql: string, ...args: unknown[]): Promise<number>;
}

function asIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function parseEmbedding(value: unknown): number[] | null {
  if (Array.isArray(value)) return value.map((n) => Number(n));
  if (typeof value === "string" && value.length > 0) {
    // pgvector text form: "[0.1,0.2,...]".
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) return parsed.map((n) => Number(n));
    } catch {
      return null;
    }
  }
  return null;
}

function toRecord(row: DocumentRow): SearchDocumentRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    orgUnitId: row.org_unit_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    title: row.title,
    body: row.body,
    searchText: row.search_text,
    embedding: parseEmbedding(row.embedding),
    updatedAt: asIso(row.updated_at),
    createdAt: asIso(row.created_at),
  };
}

function toHit(row: HitRow): SearchHit {
  return {
    entityType: row.entity_type,
    entityId: row.entity_id,
    title: row.title,
    orgUnitId: row.org_unit_id,
    score: row.score === null ? 0 : Number(row.score),
  };
}

/**
 * Build the WHERE clause and bound params for the permission + entity-type
 * filter, starting at parameter index `$startIndex`. Keyword/limit params are
 * appended by the caller.
 */
function buildFilterClause(
  filter: SearchFilter | undefined,
  startIndex: number,
): { clause: string; params: unknown[]; nextIndex: number } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let index = startIndex;
  if (filter?.entityTypes && filter.entityTypes.length > 0) {
    conditions.push(`entity_type = ANY($${index}::text[])`);
    params.push(filter.entityTypes);
    index += 1;
  }
  if (filter?.allowedOrgUnitIds) {
    conditions.push(
      `(org_unit_id IS NULL OR org_unit_id = ANY($${index}::uuid[]))`,
    );
    params.push(filter.allowedOrgUnitIds);
    index += 1;
  }
  const clause = conditions.length > 0 ? ` AND ${conditions.join(" AND ")}` : "";
  return { clause, params, nextIndex: index };
}

/**
 * RLS-scoped search index store (uuid params cast; idempotent upsert keyed on
 * the (tenant_id, entity_type, entity_id) UNIQUE constraint). Keyword ranking
 * uses pg_trgm `similarity`. Semantic blending via pgvector `<=>` is a prod
 * follow-up; keyword-only here keeps memory↔prod behaviour identical and the
 * build green.
 */
export function createPrismaStore(): SearchStore {
  return {
    async indexDocument(
      ctx,
      input: IndexDocumentInput,
    ): Promise<SearchDocumentRecord> {
      const searchText = buildSearchText(input.title, input.body);
      const embedding = input.embedding
        ? JSON.stringify(input.embedding)
        : null;
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<DocumentRow[]>(
          `INSERT INTO search_document
             (tenant_id, org_unit_id, entity_type, entity_id, title, body,
              search_text, embedding)
           VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5, $6, $7, $8::vector)
           ON CONFLICT (tenant_id, entity_type, entity_id) DO UPDATE
             SET org_unit_id = EXCLUDED.org_unit_id,
                 title = EXCLUDED.title,
                 body = EXCLUDED.body,
                 search_text = EXCLUDED.search_text,
                 embedding = EXCLUDED.embedding,
                 updated_at = now()
           RETURNING id, tenant_id, org_unit_id, entity_type, entity_id, title,
                     body, search_text, embedding, updated_at, created_at`,
          ctx.tenantId,
          input.orgUnitId ?? null,
          input.entityType,
          input.entityId,
          input.title,
          input.body ?? null,
          searchText,
          embedding,
        );
        return toRecord(rows[0]!);
      });
    },

    async deleteDocument(
      ctx,
      entityType: string,
      entityId: string,
    ): Promise<boolean> {
      return withTenant(ctx, async (db: Db) => {
        const affected = await db.$executeRawUnsafe(
          `DELETE FROM search_document
            WHERE entity_type = $1 AND entity_id = $2::uuid`,
          entityType,
          entityId,
        );
        return affected > 0;
      });
    },

    async search(
      ctx,
      query: string,
      filter?: SearchFilter,
    ): Promise<SearchHit[]> {
      const limit = filter?.limit ?? 50;
      return withTenant(ctx, async (db: Db) => {
        const { clause, params, nextIndex } = buildFilterClause(filter, 1);
        const qIndex = nextIndex;
        const limitIndex = nextIndex + 1;
        // Keyword (pg_trgm) ranking; gin(search_text) index serves this.
        // Semantic merge (embedding <=>) is a prod follow-up.
        const rows = await db.$queryRawUnsafe<HitRow[]>(
          `SELECT entity_type, entity_id, title, org_unit_id,
                  similarity(search_text, $${qIndex}) AS score
             FROM search_document
            WHERE TRUE${clause}
            ORDER BY score DESC, title ASC, entity_id ASC
            LIMIT $${limitIndex}`,
          ...params,
          query,
          limit,
        );
        return rows.map(toHit);
      });
    },

    async typeahead(
      ctx,
      query: string,
      filter?: SearchFilter,
    ): Promise<SearchHit[]> {
      const limit = filter?.limit ?? TYPEAHEAD_LIMIT;
      return withTenant(ctx, async (db: Db) => {
        const { clause, params, nextIndex } = buildFilterClause(filter, 1);
        const qIndex = nextIndex;
        const limitIndex = nextIndex + 1;
        // Title-only keyword match; gin(title) index serves the latency budget.
        const rows = await db.$queryRawUnsafe<HitRow[]>(
          `SELECT entity_type, entity_id, title, org_unit_id,
                  similarity(title, $${qIndex}) AS score
             FROM search_document
            WHERE TRUE${clause}
            ORDER BY score DESC, title ASC, entity_id ASC
            LIMIT $${limitIndex}`,
          ...params,
          query,
          limit,
        );
        return rows.map(toHit);
      });
    },
  };
}
