import { controlPlane, withTenant } from "@lms/db";

import {
  canTransition,
  type BillingModel,
  type ConsolidatedInvoice,
  type InvoiceRecord,
  type InvoiceStatus,
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

// ===========================================================================
// Usage metering & invoicing (#72)
// ===========================================================================

interface UsageRow {
  id: string;
  tenant_id: string;
  metric: string;
  quantity: number | string;
  window_start: Date | string;
  window_end: Date | string;
}

interface InvoiceRow {
  id: string;
  tenant_id: string;
  subscription_id: string | null;
  number: string;
  status: InvoiceStatus;
  amount_cents: number;
  currency: string;
  period_start: Date | string | null;
  period_end: Date | string | null;
  issued_at: Date | string | null;
  paid_at: Date | string | null;
}

function toUsage(row: UsageRow): UsageMeterRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    metric: row.metric,
    quantity: Number(row.quantity),
    windowStart: isoOrNull(row.window_start) ?? "",
    windowEnd: isoOrNull(row.window_end) ?? "",
  };
}

function toInvoice(row: InvoiceRow): InvoiceRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    subscriptionId: row.subscription_id,
    number: row.number,
    status: row.status,
    amountCents: row.amount_cents,
    currency: row.currency,
    periodStart: isoOrNull(row.period_start),
    periodEnd: isoOrNull(row.period_end),
    issuedAt: isoOrNull(row.issued_at),
    paidAt: isoOrNull(row.paid_at),
  };
}

const INVOICE_SELECT = `
  SELECT id, tenant_id, subscription_id, number, status, amount_cents, currency,
         period_start, period_end, issued_at, paid_at
    FROM invoice`;

/** Tenant-scoped usage meter store (RLS via withTenant; uuid params cast). */
export function createPrismaMeterStore(): MeterStore {
  return {
    async recordUsage(ctx, input: RecordUsageInput): Promise<UsageMeterRecord> {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<UsageRow[]>(
          `INSERT INTO usage_meter
             (tenant_id, metric, quantity, window_start, window_end)
           VALUES ($1::uuid, $2, $3, $4::timestamptz, $5::timestamptz)
           RETURNING id, tenant_id, metric, quantity, window_start, window_end`,
          ctx.tenantId,
          input.metric,
          input.quantity,
          input.windowStart,
          input.windowEnd,
        );
        return toUsage(rows[0]!);
      });
    },

    async rollup(ctx, metric, window?: UsageWindow): Promise<number> {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<{ total: number | string }[]>(
          `SELECT COALESCE(SUM(quantity), 0) AS total
             FROM usage_meter
            WHERE metric = $1
              AND ($2::timestamptz IS NULL OR window_start >= $2::timestamptz)
              AND ($3::timestamptz IS NULL OR window_start < $3::timestamptz)`,
          metric,
          window?.from ?? null,
          window?.to ?? null,
        );
        return Number(rows[0]?.total ?? 0);
      });
    },

    async listUsage(ctx, metric?): Promise<UsageMeterRecord[]> {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<UsageRow[]>(
          `SELECT id, tenant_id, metric, quantity, window_start, window_end
             FROM usage_meter
            WHERE ($1::text IS NULL OR metric = $1)
            ORDER BY window_start DESC`,
          metric ?? null,
        );
        return rows.map(toUsage);
      });
    },
  };
}

/**
 * Tenant-scoped invoice store. Per-tenant reads/writes go through RLS; the
 * district roll-up reads control-plane but is bounded to `tenant_subtree`.
 */
export function createPrismaInvoiceStore(): InvoiceStore {
  return {
    async createInvoice(ctx, input: NewInvoiceInput): Promise<InvoiceRecord> {
      return withTenant(ctx, async (db: Db) => {
        const counted = await db.$queryRawUnsafe<{ n: number | string }[]>(
          `SELECT COUNT(*) AS n FROM invoice`,
        );
        const seq = Number(counted[0]?.n ?? 0) + 1;
        const number = `INV-${String(seq).padStart(5, "0")}`;
        const status = input.status ?? "open";
        const rows = await db.$queryRawUnsafe<InvoiceRow[]>(
          `INSERT INTO invoice
             (tenant_id, subscription_id, number, status, amount_cents, currency,
              period_start, period_end, issued_at)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6,
                   $7::timestamptz, $8::timestamptz,
                   CASE WHEN $4 = 'draft' THEN NULL ELSE now() END)
           RETURNING id, tenant_id, subscription_id, number, status, amount_cents,
                     currency, period_start, period_end, issued_at, paid_at`,
          ctx.tenantId,
          input.subscriptionId ?? null,
          number,
          status,
          input.amountCents,
          input.currency ?? "USD",
          input.periodStart ?? null,
          input.periodEnd ?? null,
        );
        return toInvoice(rows[0]!);
      });
    },

    async listInvoices(ctx): Promise<InvoiceRecord[]> {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<InvoiceRow[]>(
          `${INVOICE_SELECT} ORDER BY number`,
        );
        return rows.map(toInvoice);
      });
    },

    async consolidate(districtTenantId): Promise<ConsolidatedInvoice> {
      const cp = controlPlane() as unknown as Db;
      const rows = await cp.$queryRawUnsafe<InvoiceRow[]>(
        `${INVOICE_SELECT}
          WHERE tenant_id IN (SELECT id FROM tenant_subtree($1::uuid))
          ORDER BY tenant_id, number`,
        districtTenantId,
      );
      const invoices = rows.map(toInvoice);
      return {
        districtTenantId,
        currency: invoices[0]?.currency ?? "USD",
        totalCents: invoices.reduce((sum, r) => sum + r.amountCents, 0),
        invoices,
      };
    },
  };
}
