import type { StandardRole, TenantContext } from "@lms/types";

/** A user row joined with its optional local password credential. */
export interface AuthUserRecord {
  id: string;
  tenantId: string;
  displayName: string;
  status: "invited" | "active" | "inactive";
  /** Null for SSO-only users (no local password). */
  passwordHash: string | null;
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
}
