import { randomUUID } from "node:crypto";

import type { TenantContext } from "@lms/types";

import {
  buildSearchText,
  rankResults,
  trigramSimilarity,
  TYPEAHEAD_LIMIT,
  type IndexDocumentInput,
  type SearchDocumentRecord,
  type SearchFilter,
  type SearchHit,
  type SearchStore,
} from "./store.js";

export const DEMO_TENANT_ID = "11111111-1111-1111-1111-111111111111";

/**
 * Whether `row` is visible under a query's permission filter:
 * - `entityTypes` unset → any type; else the type must be in the set.
 * - `allowedOrgUnitIds` unset → no org restriction; else the row must be
 *   tenant-global (orgUnitId null) or in the allowed set.
 */
function passesFilter(row: SearchDocumentRecord, filter?: SearchFilter): boolean {
  if (filter?.entityTypes && !filter.entityTypes.includes(row.entityType)) {
    return false;
  }
  if (filter?.allowedOrgUnitIds) {
    if (row.orgUnitId !== null && !filter.allowedOrgUnitIds.includes(row.orgUnitId)) {
      return false;
    }
  }
  return true;
}

/**
 * In-memory search index. Rows are tenant-filtered to emulate RLS. Upserts are
 * keyed on (tenantId, entityType, entityId) — re-indexing the same entity
 * updates in place with no duplicate. Ranking is keyword-only (no semantic) via
 * the pure helpers, so it matches the prod keyword path exactly.
 */
export class MemorySearchStore implements SearchStore {
  private docs: SearchDocumentRecord[] = [];

  constructor(
    private readonly generateId: () => string = randomUUID,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async indexDocument(
    ctx: TenantContext,
    input: IndexDocumentInput,
  ): Promise<SearchDocumentRecord> {
    const nowIso = this.now().toISOString();
    const searchText = buildSearchText(input.title, input.body);
    const existing = this.docs.find(
      (d) =>
        d.tenantId === ctx.tenantId &&
        d.entityType === input.entityType &&
        d.entityId === input.entityId,
    );
    if (existing) {
      existing.title = input.title;
      existing.body = input.body ?? null;
      existing.orgUnitId = input.orgUnitId ?? null;
      existing.embedding = input.embedding ?? null;
      existing.searchText = searchText;
      existing.updatedAt = nowIso;
      return existing;
    }
    const doc: SearchDocumentRecord = {
      id: this.generateId(),
      tenantId: ctx.tenantId,
      orgUnitId: input.orgUnitId ?? null,
      entityType: input.entityType,
      entityId: input.entityId,
      title: input.title,
      body: input.body ?? null,
      searchText,
      embedding: input.embedding ?? null,
      updatedAt: nowIso,
      createdAt: nowIso,
    };
    this.docs.push(doc);
    return doc;
  }

  async deleteDocument(
    ctx: TenantContext,
    entityType: string,
    entityId: string,
  ): Promise<boolean> {
    const before = this.docs.length;
    this.docs = this.docs.filter(
      (d) =>
        !(
          d.tenantId === ctx.tenantId &&
          d.entityType === entityType &&
          d.entityId === entityId
        ),
    );
    return this.docs.length < before;
  }

  async search(
    ctx: TenantContext,
    query: string,
    filter?: SearchFilter,
  ): Promise<SearchHit[]> {
    const rows = this.docs.filter(
      (d) => d.tenantId === ctx.tenantId && passesFilter(d, filter),
    );
    return rankResults(rows, query, {
      ...(filter?.limit !== undefined ? { limit: filter.limit } : {}),
    });
  }

  async typeahead(
    ctx: TenantContext,
    query: string,
    filter?: SearchFilter,
  ): Promise<SearchHit[]> {
    const limit = filter?.limit ?? TYPEAHEAD_LIMIT;
    const rows = this.docs.filter(
      (d) => d.tenantId === ctx.tenantId && passesFilter(d, filter),
    );
    // Title-only keyword match (the pure helper scores searchText, so score on
    // title directly here to stay title-only).
    const hits = rows
      .map((row) => ({
        entityType: row.entityType,
        entityId: row.entityId,
        title: row.title,
        orgUnitId: row.orgUnitId,
        score: trigramSimilarity(row.title, query),
      }))
      .sort(
        (a, b) =>
          b.score - a.score ||
          a.title.localeCompare(b.title) ||
          a.entityId.localeCompare(b.entityId),
      );
    return hits.slice(0, limit);
  }
}

/** Seed a memory store with a few demo-tenant documents for local dev. */
export function createSeededMemoryStore(): MemorySearchStore {
  const store = new MemorySearchStore();
  const ctx: TenantContext = {
    tenantId: DEMO_TENANT_ID,
    tier: "pool",
    databaseUrl: "postgres://demo:demo@localhost:5432/demo",
  };
  void store.indexDocument(ctx, {
    entityType: "course",
    entityId: "00000000-0000-0000-0000-000000000001",
    title: "Introduction to Algebra",
    body: "Linear equations, polynomials, and functions.",
  });
  void store.indexDocument(ctx, {
    entityType: "app_user",
    entityId: "00000000-0000-0000-0000-000000000002",
    title: "Ada Lovelace",
    body: "Mathematics instructor.",
  });
  return store;
}
