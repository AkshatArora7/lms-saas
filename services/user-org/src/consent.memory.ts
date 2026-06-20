import { randomUUID } from "node:crypto";

import type { TenantContext } from "@lms/types";

import type {
  AgeBand,
  ConsentRecord,
  ConsentStore,
  RecordConsentInput,
} from "./consent.js";

/**
 * In-memory consent store. Rows are filtered by tenant id to emulate the RLS
 * isolation Postgres enforces on `parental_consent`. Upsert keyed on
 * (tenant, subject, consent_type) mirrors the table's UNIQUE constraint.
 */
export class MemoryConsentStore implements ConsentStore {
  private rows: ConsentRecord[] = [];

  constructor(
    private readonly generateId: () => string = randomUUID,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async recordConsent(
    ctx: TenantContext,
    input: RecordConsentInput,
  ): Promise<ConsentRecord> {
    const status = input.status ?? "pending";
    const existing = this.rows.find(
      (r) =>
        r.tenantId === ctx.tenantId &&
        r.subjectUserId === input.subjectUserId &&
        r.consentType === input.consentType,
    );
    const base: ConsentRecord = {
      id: existing?.id ?? this.generateId(),
      tenantId: ctx.tenantId,
      subjectUserId: input.subjectUserId,
      ageBand: input.ageBand,
      consentType: input.consentType,
      status,
      guardianName: input.guardianName ?? null,
      guardianEmail: input.guardianEmail ?? null,
      method: input.method ?? null,
      recordedBy: input.recordedBy ?? null,
      recordedAt: this.now().toISOString(),
      revokedAt: status === "revoked" ? this.now().toISOString() : null,
    };
    if (existing) {
      Object.assign(existing, base);
      return existing;
    }
    this.rows.push(base);
    return base;
  }

  async revokeConsent(
    ctx: TenantContext,
    id: string,
  ): Promise<ConsentRecord | null> {
    const row = this.rows.find(
      (r) => r.id === id && r.tenantId === ctx.tenantId,
    );
    if (!row) return null;
    row.status = "revoked";
    row.revokedAt = this.now().toISOString();
    return row;
  }

  async listConsents(
    ctx: TenantContext,
    subjectUserId: string,
  ): Promise<ConsentRecord[]> {
    return this.rows.filter(
      (r) => r.tenantId === ctx.tenantId && r.subjectUserId === subjectUserId,
    );
  }

  async getAgeBand(
    ctx: TenantContext,
    subjectUserId: string,
  ): Promise<AgeBand> {
    const mine = this.rows
      .filter(
        (r) => r.tenantId === ctx.tenantId && r.subjectUserId === subjectUserId,
      )
      .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
    return mine[0]?.ageBand ?? "unknown";
  }
}
