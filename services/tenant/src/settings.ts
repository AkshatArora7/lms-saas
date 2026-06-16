import type { TenantContext } from "@lms/types";

/**
 * Per-tenant governance settings: a namespaced `key -> JSON value` store under
 * RLS, separate from the control-plane tenant registry. Values are validated
 * against a known catalog so a tenant can only set policies the platform
 * understands, and the owning services read the effective value to enforce
 * behaviour (e.g. identity reads `password.min_length`).
 */

export type SettingType = "number" | "boolean" | "string";

export interface SettingDef {
  type: SettingType;
  default: unknown;
  description: string;
  /** Extra validation beyond the JS type (range, allowed values, …). */
  validate?: (value: unknown) => boolean;
}

/** The known governance keys. Unknown keys are rejected. */
export const SETTING_CATALOG: Record<string, SettingDef> = {
  "password.min_length": {
    type: "number",
    default: 8,
    description: "Minimum password length for local credentials.",
    validate: (v) => Number.isInteger(v) && (v as number) >= 6 && (v as number) <= 128,
  },
  "quiz.lockdown_default": {
    type: "boolean",
    default: false,
    description: "Whether new quizzes default to lockdown (restricted) mode.",
  },
  "grading.scheme_default": {
    type: "string",
    default: "percentage",
    description: "Default grading scheme code applied to new courses.",
    validate: (v) => typeof v === "string" && (v as string).trim().length > 0,
  },
  "enrollment.self_registration": {
    type: "boolean",
    default: false,
    description: "Whether learners may self-register (subject to approval).",
  },
};

export type ValidateResult =
  | { ok: true }
  | { ok: false; reason: "unknown_key" | "invalid_value"; message: string };

/** Validate a `key -> value` pair against the catalog. Pure. */
export function validateSetting(key: string, value: unknown): ValidateResult {
  const def = SETTING_CATALOG[key];
  if (!def) {
    return {
      ok: false,
      reason: "unknown_key",
      message: `Unknown setting key: ${key}.`,
    };
  }
  const typeOk =
    def.type === "number"
      ? typeof value === "number" && Number.isFinite(value)
      : def.type === "boolean"
        ? typeof value === "boolean"
        : typeof value === "string";
  if (!typeOk) {
    return {
      ok: false,
      reason: "invalid_value",
      message: `Setting ${key} must be a ${def.type}.`,
    };
  }
  if (def.validate && !def.validate(value)) {
    return {
      ok: false,
      reason: "invalid_value",
      message: `Value for ${key} is out of range or not allowed.`,
    };
  }
  return { ok: true };
}

/** Defaults for every catalog key (the effective value when none is set). */
export function defaultSettings(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, def] of Object.entries(SETTING_CATALOG)) {
    out[key] = def.default;
  }
  return out;
}

export interface SettingRecord {
  key: string;
  value: unknown;
  updatedAt: string;
}

/**
 * Tenant-scoped persistence for governance settings. Unlike the control-plane
 * `TenantStore`, these run through `withTenant` (RLS) keyed on the tenant id in
 * the request path.
 */
export interface SettingsStore {
  /** Upsert a setting (caller validates against the catalog first). */
  putSetting(
    ctx: TenantContext,
    key: string,
    value: unknown,
  ): Promise<SettingRecord>;

  /** Stored overrides only (no defaults), as a key -> value map. */
  listStored(ctx: TenantContext): Promise<Record<string, unknown>>;
}

/** Effective settings = catalog defaults overlaid with stored overrides. */
export function effectiveSettings(
  stored: Record<string, unknown>,
): Record<string, unknown> {
  return { ...defaultSettings(), ...stored };
}
