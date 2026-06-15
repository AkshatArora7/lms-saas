import { randomUUID } from "node:crypto";

import type { TenantContext } from "@lms/types";

import {
  isVisible,
  type AnnouncementRecord,
  type AnnouncementStore,
  type NewAnnouncementInput,
  type UpdateAnnouncementInput,
} from "./store.js";

/** The demo tenant the local dev seed and the web BFFs agree on. */
export const DEMO_TENANT_ID = "11111111-1111-1111-1111-111111111111";

/**
 * In-memory AnnouncementStore. Rows are filtered by tenant id to emulate the
 * row-level isolation Postgres RLS enforces in production. Used by the test
 * suite and `ANNOUNCEMENT_STORE=memory`.
 */
export class MemoryAnnouncementStore implements AnnouncementStore {
  private rows: AnnouncementRecord[] = [];

  constructor(
    private readonly generateId: () => string = randomUUID,
    private readonly now: () => Date = () => new Date(),
  ) {}

  seed(row: AnnouncementRecord): void {
    this.rows.push(row);
  }

  async create(
    ctx: TenantContext,
    input: NewAnnouncementInput,
  ): Promise<AnnouncementRecord> {
    const created = this.now().toISOString();
    const record: AnnouncementRecord = {
      id: this.generateId(),
      tenantId: ctx.tenantId,
      orgUnitId: input.orgUnitId,
      authorId: input.authorId ?? null,
      title: input.title,
      body: input.body,
      publishAt: input.publishAt ?? created,
      expiresAt: input.expiresAt ?? null,
      createdAt: created,
    };
    this.rows.push(record);
    return record;
  }

  async get(ctx: TenantContext, id: string): Promise<AnnouncementRecord | null> {
    return (
      this.rows.find((r) => r.id === id && r.tenantId === ctx.tenantId) ?? null
    );
  }

  async listForOrgUnit(
    ctx: TenantContext,
    orgUnitId: string,
    opts: { visibleOnly?: boolean; now?: Date } = {},
  ): Promise<AnnouncementRecord[]> {
    const now = opts.now ?? this.now();
    return this.rows
      .filter((r) => r.tenantId === ctx.tenantId && r.orgUnitId === orgUnitId)
      .filter((r) => (opts.visibleOnly ? isVisible(r, now) : true))
      .sort((a, b) => b.publishAt.localeCompare(a.publishAt));
  }

  async update(
    ctx: TenantContext,
    id: string,
    input: UpdateAnnouncementInput,
  ): Promise<AnnouncementRecord | null> {
    const record = this.rows.find(
      (r) => r.id === id && r.tenantId === ctx.tenantId,
    );
    if (!record) return null;
    if (input.title !== undefined) record.title = input.title;
    if (input.body !== undefined) record.body = input.body;
    if (input.publishAt !== undefined) {
      record.publishAt = input.publishAt ?? record.publishAt;
    }
    if (input.expiresAt !== undefined) record.expiresAt = input.expiresAt;
    return record;
  }

  async publishNow(
    ctx: TenantContext,
    id: string,
    now?: Date,
  ): Promise<AnnouncementRecord | null> {
    const record = this.rows.find(
      (r) => r.id === id && r.tenantId === ctx.tenantId,
    );
    if (!record) return null;
    record.publishAt = (now ?? this.now()).toISOString();
    return record;
  }

  async remove(ctx: TenantContext, id: string): Promise<boolean> {
    const before = this.rows.length;
    this.rows = this.rows.filter(
      (r) => !(r.id === id && r.tenantId === ctx.tenantId),
    );
    return this.rows.length < before;
  }
}

/** Build a MemoryAnnouncementStore pre-seeded with a demo announcement. */
export function createSeededMemoryStore(
  generateId: () => string = randomUUID,
  now: () => Date = () => new Date(),
): MemoryAnnouncementStore {
  const store = new MemoryAnnouncementStore(generateId, now);
  store.seed({
    id: "demo-ann-1",
    tenantId: DEMO_TENANT_ID,
    orgUnitId: "demo-course",
    authorId: "demo-instructor",
    title: "Welcome to the course",
    body: "Please review the syllabus before our first session.",
    publishAt: new Date(0).toISOString(),
    expiresAt: null,
    createdAt: new Date(0).toISOString(),
  });
  // Seeded under a teacher demo course (alg-101) so the instructor announcement
  // console renders a real published + scheduled happy path in local dev.
  store.seed({
    id: "demo-alg-ann-1",
    tenantId: DEMO_TENANT_ID,
    orgUnitId: "alg-101",
    authorId: "demo-instructor",
    title: "Unit 1 quiz is live",
    body: "The Unit 1 quiz is now open. You have until Friday to complete it.",
    publishAt: new Date(0).toISOString(),
    expiresAt: null,
    createdAt: new Date(0).toISOString(),
  });
  store.seed({
    id: "demo-alg-ann-2",
    tenantId: DEMO_TENANT_ID,
    orgUnitId: "alg-101",
    authorId: "demo-instructor",
    title: "Office hours moved to Thursday",
    body: "Starting next week, office hours move to Thursday 3-4pm.",
    publishAt: new Date("2999-01-01T00:00:00.000Z").toISOString(),
    expiresAt: null,
    createdAt: new Date(0).toISOString(),
  });
  return store;
}
