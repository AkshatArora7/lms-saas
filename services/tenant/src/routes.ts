import type { AppConfig } from "@lms/config";
import type { TenantContext } from "@lms/types";
import type { FastifyInstance, FastifyReply } from "fastify";

import {
  BRANDING_THEMES,
  type BrandingPatch,
  type BrandingStore,
  type BrandingTheme,
} from "./branding.js";
import {
  SETTING_CATALOG,
  effectiveSettings,
  validateSetting,
  type SettingsStore,
} from "./settings.js";
import { isValidSlug, type TenantStore } from "./store.js";

export interface TenantRouteDeps {
  config: AppConfig;
  store: TenantStore;
  /** Tenant-scoped governance settings (RLS); keyed on the path tenant id. */
  settingsStore: SettingsStore;
  /** Tenant-scoped white-label branding (RLS); keyed on the path tenant id. */
  brandingStore: BrandingStore;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function badRequest(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(400).send({ error: "invalid_request", message });
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

interface ProvisionBody {
  slug?: unknown;
  name?: unknown;
  region?: unknown;
  plan?: unknown;
}

/**
 * Register the tenant CONTROL-PLANE surface: provision and read tenants.
 *
 * These routes intentionally have NO `x-tenant-id` resolver. This is the
 * control plane (the tenant registry), not a tenant-scoped domain service: a
 * caller provisioning a tenant has no tenant context yet, and the `tenant`
 * table is outside RLS. Authorization for this surface is an upstream concern
 * (gateway / platform admin), not per-tenant scoping.
 */
export function registerTenantRoutes(
  app: FastifyInstance,
  deps: TenantRouteDeps,
): void {
  app.post("/tenants", async (req, reply) => {
    const body = (req.body ?? {}) as ProvisionBody;

    if (!isNonEmptyString(body.slug)) {
      return badRequest(reply, "slug is required.");
    }
    if (!isValidSlug(body.slug)) {
      return badRequest(
        reply,
        "slug must be a lowercase DNS label (a-z, 0-9, hyphens).",
      );
    }
    if (!isNonEmptyString(body.name)) {
      return badRequest(reply, "name is required.");
    }
    if (body.region !== undefined && typeof body.region !== "string") {
      return badRequest(reply, "region must be a string.");
    }
    if (body.plan !== undefined && typeof body.plan !== "string") {
      return badRequest(reply, "plan must be a string.");
    }

    const result = await deps.store.provisionTenant({
      slug: body.slug.trim(),
      name: body.name.trim(),
      region: body.region?.trim(),
      plan: body.plan?.trim(),
    });

    if (!result.ok) {
      if (result.reason === "slug_taken") {
        return reply.code(409).send({
          error: "slug_taken",
          message: "A tenant with this slug already exists.",
        });
      }
      return reply.code(400).send({
        error: "unknown_plan",
        message: "Unknown plan code.",
      });
    }

    return reply.code(201).send({ tenant: result.tenant });
  });

  app.get<{ Params: { id: string } }>("/tenants/:id", async (req, reply) => {
    const tenant = await deps.store.getTenant(req.params.id);
    if (!tenant) {
      return reply
        .code(404)
        .send({ error: "not_found", message: "Tenant not found." });
    }
    return reply.code(200).send({ tenant });
  });

  app.get("/tenants", async (_req, reply) => {
    const tenants = await deps.store.listTenants();
    return reply.code(200).send({ tenants });
  });

  // --- Per-tenant governance settings (#90) ------------------------------
  // The catalog of known keys (no tenant context needed) — drives admin UIs.
  app.get("/settings/catalog", async (_req, reply) => {
    return reply.code(200).send({ catalog: SETTING_CATALOG });
  });

  // Settings are addressed by tenant id in the path and stored under RLS, so we
  // build the TenantContext from the path id (this surface is gated upstream).
  const ctxFor = (id: string): TenantContext => ({
    tenantId: id,
    tier: deps.config.DEFAULT_TENANT_TIER,
    databaseUrl: deps.config.DATABASE_URL,
  });

  app.put<{ Params: { id: string; key: string } }>(
    "/tenants/:id/settings/:key",
    async (req, reply) => {
      const { id, key } = req.params;
      if (!UUID_RE.test(id)) {
        return badRequest(reply, "tenant id must be a uuid.");
      }
      const value = (req.body as { value?: unknown } | undefined)?.value;
      if (value === undefined) {
        return badRequest(reply, "Body must include a 'value'.");
      }
      const check = validateSetting(key, value);
      if (!check.ok) {
        return reply
          .code(check.reason === "unknown_key" ? 404 : 400)
          .send({ error: check.reason, message: check.message });
      }
      const setting = await deps.settingsStore.putSetting(ctxFor(id), key, value);
      return reply.code(200).send({ setting });
    },
  );

  app.get<{ Params: { id: string } }>(
    "/tenants/:id/settings",
    async (req, reply) => {
      const { id } = req.params;
      if (!UUID_RE.test(id)) {
        return badRequest(reply, "tenant id must be a uuid.");
      }
      const stored = await deps.settingsStore.listStored(ctxFor(id));
      return reply
        .code(200)
        .send({ settings: effectiveSettings(stored), overrides: stored });
    },
  );

  app.get<{ Params: { id: string; key: string } }>(
    "/tenants/:id/settings/:key",
    async (req, reply) => {
      const { id, key } = req.params;
      if (!UUID_RE.test(id)) {
        return badRequest(reply, "tenant id must be a uuid.");
      }
      if (!SETTING_CATALOG[key]) {
        return reply
          .code(404)
          .send({ error: "unknown_key", message: `Unknown setting key: ${key}.` });
      }
      const stored = await deps.settingsStore.listStored(ctxFor(id));
      const value = effectiveSettings(stored)[key];
      return reply.code(200).send({ key, value });
    },
  );

  // --- White-label branding (#89) ----------------------------------------
  app.put<{ Params: { id: string } }>(
    "/tenants/:id/branding",
    async (req, reply) => {
      const { id } = req.params;
      if (!UUID_RE.test(id)) return badRequest(reply, "tenant id must be a uuid.");
      const body = (req.body ?? {}) as Record<string, unknown>;
      const patch: BrandingPatch = {};
      const strFields: [keyof BrandingPatch, string][] = [
        ["displayName", "displayName"],
        ["logoUrl", "logoUrl"],
        ["faviconUrl", "faviconUrl"],
        ["primaryColor", "primaryColor"],
        ["secondaryColor", "secondaryColor"],
        ["accentColor", "accentColor"],
        ["customDomain", "customDomain"],
        ["customCss", "customCss"],
        ["supportEmail", "supportEmail"],
      ];
      for (const [key, field] of strFields) {
        const v = body[field];
        if (v === undefined) continue;
        if (v !== null && typeof v !== "string") {
          return badRequest(reply, `${field} must be a string or null.`);
        }
        (patch[key] as string | null) = v as string | null;
      }
      if (body.theme !== undefined) {
        if (!isBrandingTheme(body.theme)) {
          return badRequest(reply, `theme must be one of: ${BRANDING_THEMES.join(", ")}.`);
        }
        patch.theme = body.theme;
      }
      if (body.inheritParent !== undefined) {
        if (typeof body.inheritParent !== "boolean") {
          return badRequest(reply, "inheritParent must be a boolean.");
        }
        patch.inheritParent = body.inheritParent;
      }
      // Validate hex colours when provided.
      for (const c of ["primaryColor", "secondaryColor", "accentColor"] as const) {
        const v = patch[c];
        if (typeof v === "string" && !/^#[0-9a-fA-F]{6}$/.test(v)) {
          return badRequest(reply, `${c} must be a #rrggbb hex colour.`);
        }
      }
      const branding = await deps.brandingStore.putBranding(ctxFor(id), patch);
      return reply.code(200).send({ branding });
    },
  );

  app.get<{ Params: { id: string } }>(
    "/tenants/:id/branding",
    async (req, reply) => {
      const { id } = req.params;
      if (!UUID_RE.test(id)) return badRequest(reply, "tenant id must be a uuid.");
      const [effective, overrides] = await Promise.all([
        deps.brandingStore.getEffectiveBranding(id),
        deps.brandingStore.getOwnBranding(ctxFor(id)),
      ]);
      return reply.code(200).send({ branding: effective, overrides });
    },
  );
}

function isBrandingTheme(value: unknown): value is BrandingTheme {
  return (
    typeof value === "string" && (BRANDING_THEMES as readonly string[]).includes(value)
  );
}
