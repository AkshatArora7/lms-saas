import { controlPlane, withTenant } from "@lms/db";

import {
  canTransition,
  type BillingModel,
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

interface PlanRow {
  id: string;
  code: string;
  name: string;
  base_price_cents: number;
  billing_model: BillingModel;
  addons: unknown;
}

interface SubscriptionRow {
  id: string;
  tenant_id: string;
  plan_id: string;
  plan_code: string;
  status: SubscriptionStatus;
  seats: number | null;
  period_start: Date | string | null;
  period_end: Date | string | null;
  created_at: Date | string;
}

interface Db {
  $queryRawUnsafe<T>(sql: string, ...args: unknown[]): Promise<T>;
  $executeRawUnsafe(sql: string, ...args: unknown[]): Promise<number>;
}

function isoOrNull(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function asAddons(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function toPlan(row: PlanRow): PlanRecord {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    basePriceCents: row.base_price_cents,
    billingModel: row.billing_model,
    addons: asAddons(row.addons),
  };
}

function toSubscription(row: SubscriptionRow): SubscriptionRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    planId: row.plan_id,
    planCode: row.plan_code,
    status: row.status,
    seats: row.seats,
    periodStart: isoOrNull(row.period_start),
    periodEnd: isoOrNull(row.period_end),
    createdAt: row.created_at instanceof Date
      ? row.created_at.toISOString()
      : String(row.created_at),
  };
}

const SUB_SELECT = `
  SELECT s.id, s.tenant_id, s.plan_id, p.code AS plan_code, s.status, s.seats,
         s.period_start, s.period_end, s.created_at
    FROM subscription s
    JOIN plan p ON p.id = s.plan_id`;

/** Control-plane plan catalog (no tenant scope; the plan table is global). */
export function createPrismaPlanStore(): PlanStore {
  const cp = controlPlane() as unknown as Db;
  return {
    async listPlans(): Promise<PlanRecord[]> {
      const rows = await cp.$queryRawUnsafe<PlanRow[]>(
        `SELECT id, code, name, base_price_cents, billing_model, addons
           FROM plan ORDER BY base_price_cents`,
      );
      return rows.map(toPlan);
    },
    async getPlanByCode(code: string): Promise<PlanRecord | null> {
      const rows = await cp.$queryRawUnsafe<PlanRow[]>(
        `SELECT id, code, name, base_price_cents, billing_model, addons
           FROM plan WHERE code = $1 LIMIT 1`,
        code,
      );
      return rows[0] ? toPlan(rows[0]) : null;
    },
  };
}

/**
 * Tenant-scoped subscription store. Subscriptions are RLS-scoped via
 * `withTenant`; the plan lookup uses the global catalog. uuid params cast.
 */
export function createPrismaSubscriptionStore(
  plans: PlanStore = createPrismaPlanStore(),
): SubscriptionStore {
  return {
    async subscribe(ctx, input: NewSubscriptionInput): Promise<SubscribeResult> {
      const plan = await plans.getPlanByCode(input.planCode);
      if (!plan) return { ok: false, reason: "unknown_plan" };
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<{ id: string }[]>(
          `INSERT INTO subscription
             (tenant_id, plan_id, status, seats, period_start, period_end)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5::timestamptz, $6::timestamptz)
           RETURNING id`,
          ctx.tenantId,
          plan.id,
          input.status ?? "trialing",
          input.seats ?? null,
          input.periodStart ?? null,
          input.periodEnd ?? null,
        );
        const created = await db.$queryRawUnsafe<SubscriptionRow[]>(
          `${SUB_SELECT} WHERE s.id = $1::uuid`,
          rows[0]!.id,
        );
        return { ok: true, subscription: toSubscription(created[0]!) };
      });
    },

    async getCurrent(ctx): Promise<SubscriptionRecord | null> {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<SubscriptionRow[]>(
          `${SUB_SELECT} ORDER BY s.created_at DESC LIMIT 1`,
        );
        return rows[0] ? toSubscription(rows[0]) : null;
      });
    },

    async transition(ctx, subscriptionId, to): Promise<TransitionResult> {
      return withTenant<TransitionResult>(ctx, async (db: Db) => {
        const current = await db.$queryRawUnsafe<SubscriptionRow[]>(
          `${SUB_SELECT} WHERE s.id = $1::uuid LIMIT 1`,
          subscriptionId,
        );
        if (current.length === 0) return { ok: false, reason: "not_found" };
        if (!canTransition(current[0]!.status, to)) {
          return { ok: false, reason: "invalid_transition" };
        }
        await db.$executeRawUnsafe(
          `UPDATE subscription SET status = $1 WHERE id = $2::uuid`,
          to,
          subscriptionId,
        );
        const updated = await db.$queryRawUnsafe<SubscriptionRow[]>(
          `${SUB_SELECT} WHERE s.id = $1::uuid LIMIT 1`,
          subscriptionId,
        );
        return { ok: true, subscription: toSubscription(updated[0]!) };
      });
    },

    async setSeats(ctx, subscriptionId, seats): Promise<SetSeatsResult> {
      return withTenant<SetSeatsResult>(ctx, async (db: Db) => {
        const affected = await db.$executeRawUnsafe(
          `UPDATE subscription SET seats = $1 WHERE id = $2::uuid`,
          seats,
          subscriptionId,
        );
        if (affected === 0) return { ok: false, reason: "not_found" };
        const updated = await db.$queryRawUnsafe<SubscriptionRow[]>(
          `${SUB_SELECT} WHERE s.id = $1::uuid LIMIT 1`,
          subscriptionId,
        );
        return { ok: true, subscription: toSubscription(updated[0]!) };
      });
    },
  };
}
