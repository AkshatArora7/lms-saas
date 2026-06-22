import { randomUUID } from "node:crypto";

import { EVENT_TYPES } from "@lms/events";

import {
  normalizeSlug,
  subdomainFor,
  type ChildTenantFilter,
  type OutboxEvent,
  type ProvisionTenantInput,
  type ProvisionTenantResult,
  type TenantRecord,
  type TenantStore,
  type TenantTier,
} from "./store.js";

/** Plan codes the demo control plane knows about; mirrors seeded `plan` rows. */
export const KNOWN_PLAN_CODES: readonly string[] = ["core", "performance_plus"];

/**
 * In-memory TenantStore. Emulates the control-plane tenant registry in an
 * array (the registry is NOT RLS-scoped, so there is no tenant filtering here —
 * see store.ts). Used by the test suite and `TENANT_STORE=memory`.
 *
 * The transactional outbox is modelled too: every successful provision appends
 * a `tenant.provisioned` event to an in-memory array, exposed via
 * `emittedEvents()`, so tests can assert the event was written alongside the
 * tenant row (the Prisma store writes both in one control-plane transaction).
 */
export class MemoryTenantStore implements TenantStore {
  private tenants: TenantRecord[] = [];
  private outbox: OutboxEvent[] = [];

  constructor(
    private readonly generateId: () => string = randomUUID,
    private readonly now: () => Date = () => new Date(),
    private readonly knownPlanCodes: readonly string[] = KNOWN_PLAN_CODES,
  ) {}

  seed(tenant: TenantRecord): void {
    this.tenants.push(tenant);
  }

  /** Outbox events recorded so far (test accessor). */
  emittedEvents(): readonly OutboxEvent[] {
    return this.outbox;
  }

  async provisionTenant(
    input: ProvisionTenantInput,
  ): Promise<ProvisionTenantResult> {
    const slug = normalizeSlug(input.slug);

    // citext slug uniqueness — compare normalised (lowercased) slugs.
    const taken = this.tenants.some((t) => normalizeSlug(t.slug) === slug);
    if (taken) return { ok: false, reason: "slug_taken" };

    // Resolve the parent (district) first when creating a sub-tenant.
    let parent: TenantRecord | undefined;
    if (input.parentTenantId != null) {
      parent = this.tenants.find((t) => t.id === input.parentTenantId);
      if (!parent) return { ok: false, reason: "unknown_parent" };
    }

    let planId: string | null = null;
    if (input.plan !== undefined) {
      if (!this.knownPlanCodes.includes(input.plan)) {
        return { ok: false, reason: "unknown_plan" };
      }
      // The Prisma store resolves the plan *code* to a plan id; in memory we
      // use the code itself as a stand-in identifier.
      planId = input.plan;
    } else if (parent) {
      // A sub-tenant inherits plan/billing from its parent unless overridden.
      planId = parent.planId;
    }

    const region = input.region ?? parent?.region ?? "us-east";
    const timestamp = this.now().toISOString();

    // Model the provisioning lifecycle explicitly: a tenant is born
    // "provisioning", and for a pool tenant (shared infra, nothing to stand
    // up) provisioning completes synchronously, so it transitions to "active".
    const tenant: TenantRecord = {
      id: this.generateId(),
      slug,
      name: input.name,
      kind: parent ? "sub" : "standalone",
      parentId: parent?.id ?? null,
      tier: "pool",
      status: "provisioning",
      region,
      planId,
      databaseRef: null,
      subdomain: subdomainFor(slug),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    tenant.status = "active";
    this.tenants.push(tenant);

    // Promote a standalone parent to a district the first time it gains a child.
    if (parent && parent.kind === "standalone") {
      parent.kind = "parent";
      parent.updatedAt = timestamp;
    }

    // Transactional outbox: record the event in the same logical step as the
    // tenant insert (one transaction in the Prisma store).
    this.outbox.push({
      tenantId: tenant.id,
      type: EVENT_TYPES.TENANT_PROVISIONED,
      payload: {
        slug: tenant.slug,
        name: tenant.name,
        region: tenant.region,
        tier: tenant.tier,
        subdomain: tenant.subdomain,
        planId: tenant.planId,
      },
    });

    return { ok: true, tenant };
  }

  async getTenant(id: string): Promise<TenantRecord | null> {
    return this.tenants.find((t) => t.id === id) ?? null;
  }

  async setStatus(
    id: string,
    status: TenantRecord["status"],
  ): Promise<TenantRecord | null> {
    const tenant = this.tenants.find((t) => t.id === id);
    if (!tenant) return null;
    tenant.status = status;
    tenant.updatedAt = this.now().toISOString();
    return tenant;
  }

  async setDatabaseRef(
    id: string,
    databaseRef: string | null,
  ): Promise<TenantRecord | null> {
    const tenant = this.tenants.find((t) => t.id === id);
    if (!tenant) return null;
    tenant.databaseRef = databaseRef;
    tenant.updatedAt = this.now().toISOString();
    return tenant;
  }

  async setTier(id: string, tier: TenantTier): Promise<TenantRecord | null> {
    const tenant = this.tenants.find((t) => t.id === id);
    if (!tenant) return null;
    tenant.tier = tier;
    tenant.updatedAt = this.now().toISOString();
    return tenant;
  }

  async getTenantBySlug(slug: string): Promise<TenantRecord | null> {
    const normalized = normalizeSlug(slug);
    return this.tenants.find((t) => normalizeSlug(t.slug) === normalized) ?? null;
  }

  async listTenants(): Promise<TenantRecord[]> {
    return [...this.tenants];
  }

  async listChildren(
    parentId: string,
    filter?: ChildTenantFilter,
  ): Promise<TenantRecord[]> {
    const q = filter?.q?.trim().toLowerCase();
    return this.tenants.filter(
      (t) =>
        t.parentId === parentId &&
        (q === undefined ||
          q === "" ||
          t.name.toLowerCase().includes(q) ||
          t.slug.toLowerCase().includes(q)),
    );
  }

  async listSubtree(rootId: string): Promise<TenantRecord[]> {
    const ids = new Set<string>([rootId]);
    let grew = true;
    let guard = 0;
    while (grew && guard < 64) {
      grew = false;
      guard += 1;
      for (const t of this.tenants) {
        if (t.parentId && ids.has(t.parentId) && !ids.has(t.id)) {
          ids.add(t.id);
          grew = true;
        }
      }
    }
    return this.tenants.filter((t) => ids.has(t.id));
  }
}

/** Build a MemoryTenantStore pre-seeded with a demo tenant for local dev. */
export function createSeededMemoryStore(
  generateId: () => string = randomUUID,
  now: () => Date = () => new Date(),
): MemoryTenantStore {
  const store = new MemoryTenantStore(generateId, now);
  store.seed({
    id: "11111111-1111-1111-1111-111111111111",
    slug: "demo",
    name: "Demo Academy",
    kind: "standalone",
    parentId: null,
    tier: "pool",
    status: "active",
    region: "us-east",
    planId: null,
    databaseRef: null,
    subdomain: subdomainFor("demo"),
    createdAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
    updatedAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
  });
  return store;
}
