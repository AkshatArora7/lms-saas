import type { TenantContext } from "@lms/types";

export type BillingModel = "per_active_user" | "per_fte" | "flat";

export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled";

export const SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = [
  "trialing",
  "active",
  "past_due",
  "canceled",
];

/** Allowed lifecycle transitions. `canceled` is terminal. */
const ALLOWED_TRANSITIONS: Record<SubscriptionStatus, SubscriptionStatus[]> = {
  trialing: ["active", "canceled"],
  active: ["past_due", "canceled"],
  past_due: ["active", "canceled"],
  canceled: [],
};

/** Pure guard for the subscription state machine. */
export function canTransition(
  from: SubscriptionStatus,
  to: SubscriptionStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export interface PlanRecord {
  id: string;
  code: string;
  name: string;
  basePriceCents: number;
  billingModel: BillingModel;
  /** Available add-ons for the plan (e.g. { "performance_plus": {...} }). */
  addons: Record<string, unknown>;
}

export interface SubscriptionRecord {
  id: string;
  tenantId: string;
  planId: string;
  planCode: string;
  status: SubscriptionStatus;
  seats: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  createdAt: string;
}

export interface NewSubscriptionInput {
  planCode: string;
  seats?: number | null;
  status?: SubscriptionStatus;
  periodStart?: string | null;
  periodEnd?: string | null;
}

export type SubscribeResult =
  | { ok: true; subscription: SubscriptionRecord }
  | { ok: false; reason: "unknown_plan" };

export type TransitionResult =
  | { ok: true; subscription: SubscriptionRecord }
  | { ok: false; reason: "not_found" | "invalid_transition" };

export type SetSeatsResult =
  | { ok: true; subscription: SubscriptionRecord }
  | { ok: false; reason: "not_found" };

/** Result of a seat-enforcement check against the current active-user count. */
export interface SeatCheck {
  /** Whether the active-user count is within the subscribed seats. */
  withinLimit: boolean;
  /** null seats means unlimited/unmetered. */
  seats: number | null;
  activeUsers: number;
}

/** Control-plane plan catalog (the `plan` table is global, not RLS-scoped). */
export interface PlanStore {
  listPlans(): Promise<PlanRecord[]>;
  getPlanByCode(code: string): Promise<PlanRecord | null>;
}

/** Tenant-scoped subscriptions (RLS via withTenant on the path tenant id). */
export interface SubscriptionStore {
  subscribe(
    ctx: TenantContext,
    input: NewSubscriptionInput,
  ): Promise<SubscribeResult>;

  /** The tenant's current (latest) subscription, or null. */
  getCurrent(ctx: TenantContext): Promise<SubscriptionRecord | null>;

  transition(
    ctx: TenantContext,
    subscriptionId: string,
    to: SubscriptionStatus,
  ): Promise<TransitionResult>;

  setSeats(
    ctx: TenantContext,
    subscriptionId: string,
    seats: number | null,
  ): Promise<SetSeatsResult>;
}

/** Pure seat-enforcement check (shared by stores and routes). */
export function seatCheck(
  subscription: SubscriptionRecord | null,
  activeUsers: number,
): SeatCheck {
  const seats = subscription?.seats ?? null;
  return {
    withinLimit: seats === null ? true : activeUsers <= seats,
    seats,
    activeUsers,
  };
}

// ===========================================================================
// Usage metering & invoicing (#72)
// ===========================================================================

/** A recorded usage rollup row for a metric over a time window. */
export interface UsageMeterRecord {
  id: string;
  tenantId: string;
  metric: string;
  quantity: number;
  windowStart: string;
  windowEnd: string;
}

export interface RecordUsageInput {
  metric: string;
  quantity: number;
  windowStart: string;
  windowEnd: string;
}

/** Optional [from, to) filter applied to a usage rollup (by window_start). */
export interface UsageWindow {
  from?: string;
  to?: string;
}

/**
 * The metric a billing model meters on, or null for flat plans (which have no
 * metered component). Mirrors the `usage_meter.metric` vocabulary.
 */
export function meteredMetric(model: BillingModel): string | null {
  switch (model) {
    case "per_active_user":
      return "active_users";
    case "per_fte":
      return "fte";
    case "flat":
      return null;
  }
}

/**
 * Invoice amount for a period. Flat plans bill the base price; metered plans
 * bill the base price per whole unit (active user / FTE) of measured usage.
 * Pure so it is identical in dev/test and prod.
 */
export function computeInvoiceAmountCents(args: {
  basePriceCents: number;
  billingModel: BillingModel;
  meteredQuantity: number;
}): number {
  if (args.billingModel === "flat") return args.basePriceCents;
  return args.basePriceCents * Math.ceil(Math.max(0, args.meteredQuantity));
}

export type InvoiceStatus =
  | "draft"
  | "open"
  | "paid"
  | "void"
  | "uncollectible";

export const INVOICE_STATUSES: readonly InvoiceStatus[] = [
  "draft",
  "open",
  "paid",
  "void",
  "uncollectible",
];

export interface InvoiceRecord {
  id: string;
  tenantId: string;
  subscriptionId: string | null;
  number: string;
  status: InvoiceStatus;
  amountCents: number;
  currency: string;
  periodStart: string | null;
  periodEnd: string | null;
  issuedAt: string | null;
  paidAt: string | null;
}

/** Persistence input; the store assigns the per-tenant invoice number. */
export interface NewInvoiceInput {
  subscriptionId?: string | null;
  amountCents: number;
  currency?: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  status?: InvoiceStatus;
}

/** A district-level roll-up of invoices across the tenant subtree. */
export interface ConsolidatedInvoice {
  districtTenantId: string;
  currency: string;
  totalCents: number;
  invoices: InvoiceRecord[];
}

/** Tenant-scoped usage meter store (RLS via withTenant). */
export interface MeterStore {
  recordUsage(
    ctx: TenantContext,
    input: RecordUsageInput,
  ): Promise<UsageMeterRecord>;

  /** Sum of `quantity` for a metric within an optional window. */
  rollup(
    ctx: TenantContext,
    metric: string,
    window?: UsageWindow,
  ): Promise<number>;

  listUsage(ctx: TenantContext, metric?: string): Promise<UsageMeterRecord[]>;
}

/** Tenant-scoped invoice store, plus the subtree-bounded district roll-up. */
export interface InvoiceStore {
  createInvoice(
    ctx: TenantContext,
    input: NewInvoiceInput,
  ): Promise<InvoiceRecord>;

  listInvoices(ctx: TenantContext): Promise<InvoiceRecord[]>;

  /**
   * District-consolidated invoice across the tenant subtree. This is a
   * deliberate control-plane roll-up bounded to `tenant_subtree(districtId)` —
   * per-tenant rows stay RLS-isolated everywhere else (see schema.sql).
   */
  consolidate(districtTenantId: string): Promise<ConsolidatedInvoice>;
}
