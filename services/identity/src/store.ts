import type { StandardRole, TenantContext } from "@lms/types";

/** A user row joined with its optional local password credential. */
export interface AuthUserRecord {
  id: string;
  tenantId: string;
  displayName: string;
  status: "invited" | "active" | "inactive";
  /** Null for SSO-only users (no local password). */
  passwordHash: string | null;
  /** Display-language preference (`app_user.locale`); defaults to 'en'. */
  locale?: string;
}

/** A stored refresh token (hash only; the raw token is never persisted). */
export interface RefreshRecord {
  id: string;
  tenantId: string;
  userId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedBy: string | null;
}

export interface NewRefreshRecord {
  id: string;
  tenantId: string;
  userId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
}

export interface RolesAndScopes {
  roles: StandardRole[];
  scopes: string[];
}

/** A configured external identity provider for a (sub-)tenant. */
export interface IdentityProviderRecord {
  id: string;
  tenantId: string;
  kind: "saml" | "oidc" | "ldap" | "cas";
  displayName: string;
  /** Provider-specific settings (endpoints, client id/secret, etc.). */
  config: Record<string, unknown>;
  isEnabled: boolean;
}

/** Input for just-in-time SSO user provisioning / identity linking. */
export interface SsoProvisionInput {
  providerId: string;
  /** Stable subject/NameID from the IdP. */
  subject: string;
  email: string;
  displayName: string;
  /** Roles/scopes granted to a brand-new JIT user (existing users keep theirs). */
  defaultRoles?: StandardRole[];
  defaultScopes?: string[];
}

/**
 * Persistence boundary for the identity service. The Fastify routes depend only
 * on this interface, so production uses an RLS-scoped Postgres implementation
 * while tests inject an in-memory one (no database required).
 */
export interface IdentityStore {
  findUserByEmail(
    ctx: TenantContext,
    email: string,
  ): Promise<AuthUserRecord | null>;

  getRolesAndScopes(
    ctx: TenantContext,
    userId: string,
  ): Promise<RolesAndScopes>;

  /**
   * The owning parent tenant id for a sub-tenant, or null for a top-level
   * tenant. Read from the control-plane `tenant` registry so the access token
   * can carry the hierarchy. Falls back to `ctx.parentTenantId` when the
   * gateway already resolved it.
   */
  getParentTenantId(ctx: TenantContext): Promise<string | null>;

  insertRefreshToken(
    ctx: TenantContext,
    rec: NewRefreshRecord,
  ): Promise<void>;

  findRefreshByHash(
    ctx: TenantContext,
    tokenHash: string,
  ): Promise<RefreshRecord | null>;

  /** Revoke a single token, optionally recording its successor. */
  revokeRefreshToken(
    ctx: TenantContext,
    id: string,
    replacedBy?: string | null,
  ): Promise<void>;

  /** Revoke every still-active token in a rotation family (reuse/logout). */
  revokeFamily(ctx: TenantContext, familyId: string): Promise<void>;

  /** Load a configured identity provider by id (used for SSO federation). */
  findIdentityProvider(
    ctx: TenantContext,
    providerId: string,
  ): Promise<IdentityProviderRecord | null>;

  /**
   * Just-in-time SSO provisioning. Resolves the user behind an IdP subject:
   *   1. an existing `user_identity` link (provider + subject), else
   *   2. an existing `app_user` with the same email (links a new identity), else
   *   3. a brand-new active `app_user` (with `external_id = subject`) + identity.
   * Always returns the resolved/active user record.
   */
  upsertSsoUser(
    ctx: TenantContext,
    input: SsoProvisionInput,
  ): Promise<AuthUserRecord>;

  /**
   * The authenticated user's display-language preference (`app_user.locale`)
   * within their tenant, or null when the user row is not visible to this
   * tenant. Tenant-scoped: the lookup is keyed by user id AND tenant.
   */
  getUserLocale(ctx: TenantContext, userId: string): Promise<string | null>;

  /**
   * Update the authenticated user's own `app_user.locale` within their tenant.
   * Returns true when a row was updated (the user is visible to this tenant),
   * false otherwise. The caller must pass the id derived from the verified
   * session — never from request input — so this can only touch the caller's
   * own record (IDOR-safe), and the write stays tenant-scoped.
   */
  updateUserLocale(
    ctx: TenantContext,
    userId: string,
    locale: string,
  ): Promise<boolean>;
}

/** Locales the platform ships catalogs for; others are rejected with 400. */
export const SUPPORTED_LOCALES = ["en", "es"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/** Pure guard: is `value` a supported locale code? (unit-testable, no store). */
export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return (
    typeof value === "string" &&
    (SUPPORTED_LOCALES as readonly string[]).includes(value)
  );
}
