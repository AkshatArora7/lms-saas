import { withTenant } from "@lms/db";
import type { TenantContext } from "@lms/types";

import {
  DEFAULT_LAUNCH_TTL_SECONDS,
  type LtiDeployment,
  type LtiLaunchSession,
  type LtiRegistration,
  type LtiRole,
  type LtiStore,
  type NewLaunchSession,
  type NewRegistration,
} from "./store.js";

interface Db {
  $queryRawUnsafe<T>(sql: string, ...args: unknown[]): Promise<T>;
  $executeRawUnsafe(sql: string, ...args: unknown[]): Promise<number>;
}

interface RegistrationRow {
  id: string;
  tenant_id: string;
  issuer: string;
  client_id: string;
  auth_login_url: string;
  auth_token_url: string;
  jwks_url: string;
  role: LtiRole;
}

interface DeploymentRow {
  id: string;
  deployment_id: string;
  org_unit_id: string | null;
}

interface LaunchSessionRow {
  id: string;
  tenant_id: string;
  registration_id: string;
  state: string;
  nonce: string;
  target_link_uri: string | null;
  lti_message_hint: string | null;
  consumed_at: Date | string | null;
  expires_at: Date | string;
}

const REG_COLS = `id, tenant_id, issuer, client_id, auth_login_url,
  auth_token_url, jwks_url, role`;

const SESSION_COLS = `id, tenant_id, registration_id, state, nonce,
  target_link_uri, lti_message_hint, consumed_at, expires_at`;

function tsToString(v: Date | string | null): string | null {
  if (v == null) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

function toRegistration(row: RegistrationRow): LtiRegistration {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    issuer: row.issuer,
    clientId: row.client_id,
    authLoginUrl: row.auth_login_url,
    authTokenUrl: row.auth_token_url,
    jwksUrl: row.jwks_url,
    role: row.role,
  };
}

function toSession(row: LaunchSessionRow): LtiLaunchSession {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    registrationId: row.registration_id,
    state: row.state,
    nonce: row.nonce,
    targetLinkUri: row.target_link_uri,
    ltiMessageHint: row.lti_message_hint,
    consumedAt: tsToString(row.consumed_at),
    expiresAt: tsToString(row.expires_at)!,
  };
}

/**
 * Postgres-backed LtiStore. Every method runs through `withTenant` so RLS scopes
 * each query; all id params are cast `$N::uuid`. The consume is a single atomic
 * UPDATE...RETURNING that burns the row only if unconsumed AND unexpired —
 * replay protection by construction.
 */
export function createPrismaStore(): LtiStore {
  return {
    async findRegistration(
      ctx: TenantContext,
      issuer: string,
      clientId: string,
    ): Promise<LtiRegistration | null> {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<RegistrationRow[]>(
          `SELECT ${REG_COLS} FROM lti_registration
           WHERE tenant_id = $1::uuid AND issuer = $2 AND client_id = $3
           LIMIT 1`,
          ctx.tenantId,
          issuer,
          clientId,
        );
        return rows[0] ? toRegistration(rows[0]) : null;
      });
    },

    async getRegistrationById(
      ctx: TenantContext,
      registrationId: string,
    ): Promise<LtiRegistration | null> {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<RegistrationRow[]>(
          `SELECT ${REG_COLS} FROM lti_registration
           WHERE tenant_id = $1::uuid AND id = $2::uuid
           LIMIT 1`,
          ctx.tenantId,
          registrationId,
        );
        return rows[0] ? toRegistration(rows[0]) : null;
      });
    },

    async getDeployment(
      ctx: TenantContext,
      registrationId: string,
      deploymentId: string,
    ): Promise<LtiDeployment | null> {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<DeploymentRow[]>(
          `SELECT id, deployment_id, org_unit_id FROM lti_deployment
           WHERE tenant_id = $1::uuid AND registration_id = $2::uuid
             AND deployment_id = $3
           LIMIT 1`,
          ctx.tenantId,
          registrationId,
          deploymentId,
        );
        const row = rows[0];
        return row
          ? { id: row.id, deploymentId: row.deployment_id, orgUnitId: row.org_unit_id }
          : null;
      });
    },

    async createLaunchSession(
      ctx: TenantContext,
      s: NewLaunchSession,
    ): Promise<LtiLaunchSession> {
      const ttl = s.ttlSeconds ?? DEFAULT_LAUNCH_TTL_SECONDS;
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<LaunchSessionRow[]>(
          `INSERT INTO lti_launch_session
             (tenant_id, registration_id, state, nonce, target_link_uri,
              lti_message_hint, expires_at)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6,
                   now() + make_interval(secs => $7))
           RETURNING ${SESSION_COLS}`,
          ctx.tenantId,
          s.registrationId,
          s.state,
          s.nonce,
          s.targetLinkUri ?? null,
          s.ltiMessageHint ?? null,
          ttl,
        );
        return toSession(rows[0]!);
      });
    },

    async consumeLaunchSession(
      ctx: TenantContext,
      state: string,
    ): Promise<LtiLaunchSession | null> {
      return withTenant(ctx, async (db: Db) => {
        // Atomic single-use burn: only burns an unconsumed, unexpired row.
        const rows = await db.$queryRawUnsafe<LaunchSessionRow[]>(
          `UPDATE lti_launch_session
             SET consumed_at = now()
           WHERE tenant_id = $1::uuid AND state = $2
             AND consumed_at IS NULL AND expires_at > now()
           RETURNING ${SESSION_COLS}`,
          ctx.tenantId,
          state,
        );
        return rows[0] ? toSession(rows[0]) : null;
      });
    },

    async createRegistration(
      ctx: TenantContext,
      r: NewRegistration,
    ): Promise<LtiRegistration> {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<RegistrationRow[]>(
          `INSERT INTO lti_registration
             (tenant_id, issuer, client_id, auth_login_url, auth_token_url,
              jwks_url, role)
           VALUES ($1::uuid, $2, $3, $4, $5, $6, $7)
           RETURNING ${REG_COLS}`,
          ctx.tenantId,
          r.issuer,
          r.clientId,
          r.authLoginUrl,
          r.authTokenUrl,
          r.jwksUrl,
          r.role,
        );
        return toRegistration(rows[0]!);
      });
    },
  };
}
