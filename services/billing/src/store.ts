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
