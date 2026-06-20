import { randomUUID } from "node:crypto";

import type { TenantContext } from "@lms/types";

import {
  canTransition,
  type ConsolidatedInvoice,
  type InvoiceRecord,
  type InvoiceStore,
  type MeterStore,
  type NewInvoiceInput,
  type NewSubscriptionInput,
  type PlanRecord,
  type PlanStore,
  type RecordUsageInput,
  type SetSeatsResult,
  type SubscribeResult,
  type SubscriptionRecord,
  type SubscriptionStatus,
  type SubscriptionStore,
  type TransitionResult,
  type UsageMeterRecord,
  type UsageWindow,
} from "./store.js";

export const DEMO_TENANT_ID = "11111111-1111-1111-1111-111111111111";

/** A small default plan catalog mirroring the `plan` table seed. */
export const DEFAULT_PLANS: PlanRecord[] = [
  {
    id: "plan-core",
    code: "core",
    name: "Core",
    basePriceCents: 0,
    billingModel: "per_active_user",
    addons: {},
  },
  {
    id: "plan-pro",
    code: "pro",
    name: "Professional",
    basePriceCents: 50_000,
    billingModel: "per_active_user",
    addons: {
      performance_plus: { name: "Performance+" },
      creator_plus: { name: "Creator+" },
    },
  },
];

/** In-memory plan catalog (control-plane; not tenant-scoped). */
export class MemoryPlanStore implements PlanStore {
  constructor(private readonly plans: PlanRecord[] = DEFAULT_PLANS) {}
  async listPlans(): Promise<PlanRecord[]> {
    return this.plans.slice();
  }
  async getPlanByCode(code: string): Promise<PlanRecord | null> {
    return this.plans.find((p) => p.code === code) ?? null;
  }
}

/**
 * In-memory subscription store. Rows are filtered by tenant id to emulate the
 * RLS isolation Postgres enforces on `subscription`.
 */
export class MemorySubscriptionStore implements SubscriptionStore {
  private subs: SubscriptionRecord[] = [];

  constructor(
    private readonly plans: PlanStore = new MemoryPlanStore(),
    private readonly generateId: () => string = randomUUID,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async subscribe(
    ctx: TenantContext,
    input: NewSubscriptionInput,
  ): Promise<SubscribeResult> {
    const plan = await this.plans.getPlanByCode(input.planCode);
    if (!plan) return { ok: false, reason: "unknown_plan" };
    const subscription: SubscriptionRecord = {
      id: this.generateId(),
      tenantId: ctx.tenantId,
      planId: plan.id,
      planCode: plan.code,
      status: input.status ?? "trialing",
      seats: input.seats ?? null,
      periodStart: input.periodStart ?? null,
      periodEnd: input.periodEnd ?? null,
      createdAt: this.now().toISOString(),
    };
    this.subs.push(subscription);
    return { ok: true, subscription };
  }

  async getCurrent(ctx: TenantContext): Promise<SubscriptionRecord | null> {
    const mine = this.subs.filter((s) => s.tenantId === ctx.tenantId);
    return mine.length > 0 ? mine[mine.length - 1]! : null;
  }

  private find(
    ctx: TenantContext,
    id: string,
  ): SubscriptionRecord | undefined {
    return this.subs.find((s) => s.id === id && s.tenantId === ctx.tenantId);
  }

  async transition(
    ctx: TenantContext,
    id: string,
    to: SubscriptionStatus,
  ): Promise<TransitionResult> {
    const sub = this.find(ctx, id);
    if (!sub) return { ok: false, reason: "not_found" };
    if (!canTransition(sub.status, to)) {
      return { ok: false, reason: "invalid_transition" };
    }
    sub.status = to;
    return { ok: true, subscription: sub };
  }

  async setSeats(
    ctx: TenantContext,
    id: string,
    seats: number | null,
  ): Promise<SetSeatsResult> {
    const sub = this.find(ctx, id);
    if (!sub) return { ok: false, reason: "not_found" };
    sub.seats = seats;
    return { ok: true, subscription: sub };
  }
}

/** In-memory usage meter store; rows filtered by tenant id to emulate RLS. */
export class MemoryMeterStore implements MeterStore {
  private rows: UsageMeterRecord[] = [];

  constructor(private readonly generateId: () => string = randomUUID) {}

  async recordUsage(
    ctx: TenantContext,
    input: RecordUsageInput,
  ): Promise<UsageMeterRecord> {
    const row: UsageMeterRecord = {
      id: this.generateId(),
      tenantId: ctx.tenantId,
      metric: input.metric,
      quantity: input.quantity,
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
    };
    this.rows.push(row);
    return row;
  }

  async rollup(
    ctx: TenantContext,
    metric: string,
    window?: UsageWindow,
  ): Promise<number> {
    return this.rows
      .filter(
        (r) =>
          r.tenantId === ctx.tenantId &&
          r.metric === metric &&
          (window?.from === undefined || r.windowStart >= window.from) &&
          (window?.to === undefined || r.windowStart < window.to),
      )
      .reduce((sum, r) => sum + r.quantity, 0);
  }

  async listUsage(
    ctx: TenantContext,
    metric?: string,
  ): Promise<UsageMeterRecord[]> {
    return this.rows.filter(
      (r) =>
        r.tenantId === ctx.tenantId &&
        (metric === undefined || r.metric === metric),
    );
  }
}

/**
 * In-memory invoice store. Own-tenant access is RLS-emulated; `consolidate`
 * walks a seeded parent chain (the control-plane subtree) to roll up a
 * district's sub-tenants.
 */
export class MemoryInvoiceStore implements InvoiceStore {
  private rows: InvoiceRecord[] = [];
  private readonly parentOf = new Map<string, string>();
  private readonly seqByTenant = new Map<string, number>();

  constructor(private readonly generateId: () => string = randomUUID) {}

  /** Seed the tenant hierarchy used for the district roll-up. */
  seedParent(childId: string, parentId: string): void {
    this.parentOf.set(childId, parentId);
  }

  async createInvoice(
    ctx: TenantContext,
    input: NewInvoiceInput,
  ): Promise<InvoiceRecord> {
    const seq = (this.seqByTenant.get(ctx.tenantId) ?? 0) + 1;
    this.seqByTenant.set(ctx.tenantId, seq);
    const row: InvoiceRecord = {
      id: this.generateId(),
      tenantId: ctx.tenantId,
      subscriptionId: input.subscriptionId ?? null,
      number: `INV-${String(seq).padStart(5, "0")}`,
      status: input.status ?? "open",
      amountCents: input.amountCents,
      currency: input.currency ?? "USD",
      periodStart: input.periodStart ?? null,
      periodEnd: input.periodEnd ?? null,
      issuedAt: input.status === "draft" ? null : new Date().toISOString(),
      paidAt: null,
    };
    this.rows.push(row);
    return row;
  }

  async listInvoices(ctx: TenantContext): Promise<InvoiceRecord[]> {
    return this.rows.filter((r) => r.tenantId === ctx.tenantId);
  }

  private subtree(root: string): Set<string> {
    const ids = new Set<string>([root]);
    let grew = true;
    let guard = 0;
    while (grew && guard < 64) {
      grew = false;
      guard += 1;
      for (const [child, parent] of this.parentOf) {
        if (ids.has(parent) && !ids.has(child)) {
          ids.add(child);
          grew = true;
        }
      }
    }
    return ids;
  }

  async consolidate(districtTenantId: string): Promise<ConsolidatedInvoice> {
    const ids = this.subtree(districtTenantId);
    const invoices = this.rows.filter((r) => ids.has(r.tenantId));
    return {
      districtTenantId,
      currency: invoices[0]?.currency ?? "USD",
      totalCents: invoices.reduce((sum, r) => sum + r.amountCents, 0),
      invoices,
    };
  }
}
