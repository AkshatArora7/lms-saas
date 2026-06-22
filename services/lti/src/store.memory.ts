import { randomUUID } from "node:crypto";

import type { TenantContext } from "@lms/types";

import {
  DEFAULT_LAUNCH_TTL_SECONDS,
  type LtiDeployment,
  type LtiLaunchSession,
  type LtiRegistration,
  type LtiStore,
  type NewLaunchSession,
  type NewRegistration,
} from "./store.js";

export const DEMO_TENANT_ID = "11111111-1111-1111-1111-111111111111";

/**
 * In-memory LtiStore. All access is tenant-filtered to emulate RLS. The
 * constructor takes an injectable `now` clock so expiry/consume are deterministic
 * under test (mirrors MemoryBrandingStore). The consume is an atomic
 * check-then-set on a single-threaded event loop, matching the SQL UPDATE.
 */
export class MemoryLtiStore implements LtiStore {
  private readonly registrations = new Map<string, LtiRegistration>();
  private readonly deployments = new Map<string, LtiDeployment & { tenantId: string; registrationId: string }>();
  private readonly sessions = new Map<string, LtiLaunchSession>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  /** Seed a registration (returns its id) for tests/dev. */
  seedRegistration(
    tenantId: string,
    r: NewRegistration & { id?: string },
  ): LtiRegistration {
    const reg: LtiRegistration = {
      id: r.id ?? randomUUID(),
      tenantId,
      issuer: r.issuer,
      clientId: r.clientId,
      authLoginUrl: r.authLoginUrl,
      authTokenUrl: r.authTokenUrl,
      jwksUrl: r.jwksUrl,
      role: r.role,
    };
    this.registrations.set(reg.id, reg);
    return reg;
  }

  /** Seed a deployment under a registration for tests/dev. */
  seedDeployment(
    tenantId: string,
    registrationId: string,
    deploymentId: string,
    orgUnitId: string | null = null,
  ): LtiDeployment {
    const dep = { id: randomUUID(), deploymentId, orgUnitId, tenantId, registrationId };
    this.deployments.set(dep.id, dep);
    return { id: dep.id, deploymentId: dep.deploymentId, orgUnitId: dep.orgUnitId };
  }

  async findRegistration(
    ctx: TenantContext,
    issuer: string,
    clientId: string,
  ): Promise<LtiRegistration | null> {
    for (const r of this.registrations.values()) {
      if (
        r.tenantId === ctx.tenantId &&
        r.issuer === issuer &&
        r.clientId === clientId
      ) {
        return r;
      }
    }
    return null;
  }

  async getRegistrationById(
    ctx: TenantContext,
    registrationId: string,
  ): Promise<LtiRegistration | null> {
    const r = this.registrations.get(registrationId);
    return r && r.tenantId === ctx.tenantId ? r : null;
  }

  async getDeployment(
    ctx: TenantContext,
    registrationId: string,
    deploymentId: string,
  ): Promise<LtiDeployment | null> {
    for (const d of this.deployments.values()) {
      if (
        d.tenantId === ctx.tenantId &&
        d.registrationId === registrationId &&
        d.deploymentId === deploymentId
      ) {
        return { id: d.id, deploymentId: d.deploymentId, orgUnitId: d.orgUnitId };
      }
    }
    return null;
  }

  async createLaunchSession(
    ctx: TenantContext,
    s: NewLaunchSession,
  ): Promise<LtiLaunchSession> {
    const ttl = s.ttlSeconds ?? DEFAULT_LAUNCH_TTL_SECONDS;
    const expiresAt = new Date(this.now().getTime() + ttl * 1000);
    const session: LtiLaunchSession = {
      id: randomUUID(),
      tenantId: ctx.tenantId,
      registrationId: s.registrationId,
      state: s.state,
      nonce: s.nonce,
      targetLinkUri: s.targetLinkUri ?? null,
      ltiMessageHint: s.ltiMessageHint ?? null,
      consumedAt: null,
      expiresAt: expiresAt.toISOString(),
    };
    this.sessions.set(session.id, session);
    return session;
  }

  async consumeLaunchSession(
    ctx: TenantContext,
    state: string,
  ): Promise<LtiLaunchSession | null> {
    const now = this.now();
    for (const session of this.sessions.values()) {
      if (session.tenantId !== ctx.tenantId || session.state !== state) continue;
      // Atomic burn: only succeed if unconsumed AND unexpired.
      if (session.consumedAt !== null) return null;
      if (new Date(session.expiresAt).getTime() <= now.getTime()) return null;
      session.consumedAt = now.toISOString();
      return session;
    }
    return null;
  }

  async createRegistration(
    ctx: TenantContext,
    r: NewRegistration,
  ): Promise<LtiRegistration> {
    return this.seedRegistration(ctx.tenantId, r);
  }
}
