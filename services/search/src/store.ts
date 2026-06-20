import type { TenantContext } from "@lms/types";

/**
 * Global tenant-scoped search service (issue #69). Owns a single denormalized
 * read model (`search_document`) that other services populate via index
 * endpoints (and, later, events). Every query is tenant-scoped (RLS via
 * `withTenant` in prod, `tenantId` filter in memory) and permission-filtered by
 * the caller-supplied `allowedOrgUnitIds`. Ranking blends a keyword score
 * (pg_trgm `similarity` in prod, a pure trigram reimplementation in memory) with
 * an optional semantic score (pgvector cosine) so behaviour is identical across
 * stores when no embedding/query-vector is present.
 */

/** One indexable entity (course, content topic, assignment, person, ...). */
export interface SearchDocumentRecord {
  id: string;
  tenantId: string;
  orgUnitId: string | null;
  entityType: string;
  entityId: string;
  title: string;
  body: string | null;
  searchText: string;
  embedding: number[] | null;
  updatedAt: string;
  createdAt: string;
}

/** Upsert payload for a single document (idempotent on entityType+entityId). */
export interface IndexDocumentInput {
  entityType: string;
  entityId: string;
  title: string;
  body?: string | null;
  orgUnitId?: string | null;
  embedding?: number[] | null;
}

/**
 * Permission + shape filter applied to a query. `allowedOrgUnitIds` omitted
 * means no org-unit restriction (tenant-only). When provided, a row is visible
 * if its `orgUnitId` is NULL (tenant-global) or in the allowed set.
 */
export interface SearchFilter {
  allowedOrgUnitIds?: string[];
  entityTypes?: string[];
  limit?: number;
  queryEmbedding?: number[];
}

/** A ranked search result (no body/embedding — projection for the wire). */
export interface SearchHit {
  entityType: string;
  entityId: string;
  title: string;
  orgUnitId: string | null;
  score: number;
}

/** Tenant-scoped search index persistence (RLS via withTenant in prod). */
export interface SearchStore {
  /** Idempotent upsert keyed on (tenant, entityType, entityId). */
  indexDocument(
    ctx: TenantContext,
    input: IndexDocumentInput,
  ): Promise<SearchDocumentRecord>;

  /** Remove a document from the index. Returns true if a row was deleted. */
  deleteDocument(
    ctx: TenantContext,
    entityType: string,
    entityId: string,
  ): Promise<boolean>;

  /** Full search: keyword (+ optional semantic) ranking, permission-filtered. */
  search(ctx: TenantContext, query: string, filter?: SearchFilter): Promise<SearchHit[]>;

  /** Fast prefix/typeahead on title only, keyword-only, permission-filtered. */
  typeahead(
    ctx: TenantContext,
    query: string,
    filter?: SearchFilter,
  ): Promise<SearchHit[]>;
}

const TYPEAHEAD_DEFAULT_LIMIT = 10;
const KEYWORD_WEIGHT = 0.6;
const SEMANTIC_WEIGHT = 0.4;

/** Default typeahead result cap (latency budget). */
export const TYPEAHEAD_LIMIT = TYPEAHEAD_DEFAULT_LIMIT;

/** Compose the indexed `search_text` from a document's title and body. */
export function buildSearchText(title: string, body?: string | null): string {
  return `${title} ${body ?? ""}`.trim();
}

/** Build the multiset of padded 3-grams for a lowercased string. */
function trigrams(value: string): Set<string> {
  const normalized = value.toLowerCase().trim();
  if (normalized.length === 0) return new Set();
  // Mirror pg_trgm: pad with two leading spaces and one trailing space, then
  // collapse runs of whitespace inside the padded form into single spaces.
  const padded = `  ${normalized} `.replace(/\s+/g, " ");
  const grams = new Set<string>();
  for (let i = 0; i + 3 <= padded.length; i += 1) {
    grams.add(padded.slice(i, i + 3));
  }
  return grams;
}

/**
 * Reimplementation of Postgres `pg_trgm` `similarity(text, query)` in [0,1]:
 * Jaccard index over the two strings' sets of padded 3-grams
 * (|A ∩ B| / |A ∪ B|), 0 when the union is empty.
 */
export function trigramSimilarity(text: string, query: string): number {
  const a = trigrams(text);
  const b = trigrams(query);
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const gram of a) {
    if (b.has(gram)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Cosine similarity (1 - cosine distance) of two equal-length vectors. */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    magA += a[i]! * a[i]!;
    magB += b[i]! * b[i]!;
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/** A row participating in ranking (search index projection). */
export type RankableRow = Pick<
  SearchDocumentRecord,
  "entityType" | "entityId" | "title" | "orgUnitId" | "searchText" | "embedding"
>;

export interface RankOptions {
  queryEmbedding?: number[];
  limit?: number;
}

/**
 * Pure ranking, identical across memory and prod. Keyword score is the trigram
 * similarity of `searchText` vs `query`. When a row has an `embedding` AND
 * `opts.queryEmbedding` is supplied, the final score blends keyword (0.6) and
 * semantic cosine (0.4); otherwise it is keyword-only. Stable sort: score desc,
 * then title asc, then entityId asc. `opts.limit` caps the result count.
 */
export function rankResults(
  rows: RankableRow[],
  query: string,
  opts: RankOptions = {},
): SearchHit[] {
  const queryEmbedding = opts.queryEmbedding;
  const hits = rows.map((row) => {
    const keyword = trigramSimilarity(row.searchText, query);
    let score = keyword;
    if (row.embedding && queryEmbedding && row.embedding.length > 0) {
      const semantic = cosineSimilarity(row.embedding, queryEmbedding);
      score = KEYWORD_WEIGHT * keyword + SEMANTIC_WEIGHT * semantic;
    }
    return {
      entityType: row.entityType,
      entityId: row.entityId,
      title: row.title,
      orgUnitId: row.orgUnitId,
      score,
    };
  });
  hits.sort(
    (a, b) =>
      b.score - a.score ||
      a.title.localeCompare(b.title) ||
      a.entityId.localeCompare(b.entityId),
  );
  return opts.limit !== undefined ? hits.slice(0, opts.limit) : hits;
}
