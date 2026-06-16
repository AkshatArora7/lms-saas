import { randomUUID } from "node:crypto";

import type { TenantContext } from "@lms/types";

import {
  canTransition,
  type NewSubscriptionInput,
  type PlanRecord,
  type PlanStore,
  type SetSeatsResult,
  type SubscribeResult,
  type SubscriptionRecord,
  type SubscriptionStatus,
  type SubscriptionStore,
  type TransitionResult,
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
