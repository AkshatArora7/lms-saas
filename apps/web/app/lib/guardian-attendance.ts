import { TENANT_ID } from "./auth";
import type { AttendanceHistoryEntry } from "./attendance";

/**
 * Server-only client for the guardian-facing attendance reads.
 *
 * This is the BFF read boundary a guardian uses to view their LINKED children's
 * attendance. Two calls are forwarded to the attendance service, both carrying
 * the same trusted identity headers the gateway would stamp from verified claims
 * (mirroring `analytics-api.ts`): `x-tenant-id` (tenant scope) and `x-user-id`
 * (= the authenticated guardian's session userId). The guardian id is NEVER a
 * client-supplied value — it is the server-side session identity only, so the
 * attendance service's deny-by-default gate (a studentId not in the guardian's
 * authorized set yields a 404, never a leak) is authoritative.
 *
 * Both reads return a discriminated-union result rather than throwing, so the
 * Server Component renders clean error/empty/data states instead of crashing.
 */

export const ATTENDANCE_SERVICE_URL =
  process.env.ATTENDANCE_SERVICE_URL ?? "http://localhost:4025";

/** One child a guardian is currently authorized to view (active link + consent).
 * Mirrors the backend `GuardianChild` contract: id + relationship only, NO name. */
export interface GuardianChild {
  studentUserId: string;
  /** parent | guardian | other (and any "child" value) — DISPLAY only, never authz. */
  relationship: string;
}

export type GuardianChildrenResult =
  | { ok: true; children: GuardianChild[] }
  | { ok: false };

export type GuardianHistoryResult =
  | { ok: true; history: AttendanceHistoryEntry[] }
  /** denied = studentId is not in the guardian's authorized set (backend 404).
   * Surfaced separately from a transport error so the page can silently fall back
   * WITHOUT confirming the id exists (deny-by-default, defense in depth). */
  | { ok: false; denied: boolean };

/**
 * Trusted identity headers for a direct (non-gateway) BFF call. Forwards the same
 * headers the gateway stamps from verified claims: `x-tenant-id` (tenant scope)
 * and `x-user-id` (= the guardian's session userId). These come ONLY from the
 * server-side session, never from a client value.
 */
function callerHeaders(tenantId: string, guardianUserId: string): HeadersInit {
  return {
    "x-tenant-id": tenantId,
    "x-user-id": guardianUserId,
  };
}

/**
 * Fetch the authenticated guardian's authorized children (active link + consent
 * permitted), tenant-scoped. An empty list is a valid, non-error result. Returns
 * a discriminated union so the caller renders error/empty/data states without a
 * try/catch at the render site; never throws to the page.
 */
export async function getGuardianChildren(
  guardianUserId: string,
  tenantId: string = TENANT_ID,
): Promise<GuardianChildrenResult> {
  try {
    const url = `${ATTENDANCE_SERVICE_URL}/guardian/children`;
    const res = await fetch(url, {
      headers: callerHeaders(tenantId, guardianUserId),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false };
    const data = (await res.json()) as { children?: GuardianChild[] };
    return { ok: true, children: data.children ?? [] };
  } catch {
    return { ok: false };
  }
}

/**
 * Fetch one child's attendance history for the authenticated guardian. The
 * attendance service runs the deny-by-default gate: a `studentId` that is not in
 * the guardian's authorized set returns 404 (never confirms the id exists). We
 * map that 404 to `{ ok: false, denied: true }` so the page can silently fall
 * back to an authorized child instead of surfacing an error that would leak the
 * id's existence. Any other non-2xx maps to `{ ok: false, denied: false }`
 * (transport/service error).
 */
export async function getGuardianChildAttendance(
  guardianUserId: string,
  studentUserId: string,
  tenantId: string = TENANT_ID,
): Promise<GuardianHistoryResult> {
  try {
    const url = `${ATTENDANCE_SERVICE_URL}/guardian/children/${encodeURIComponent(
      studentUserId,
    )}/attendance`;
    const res = await fetch(url, {
      headers: callerHeaders(tenantId, guardianUserId),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, denied: res.status === 404 };
    const data = (await res.json()) as { history?: AttendanceHistoryEntry[] };
    return { ok: true, history: data.history ?? [] };
  } catch {
    return { ok: false, denied: false };
  }
}

/**
 * Map a raw backend relationship value (`parent` | `guardian` | `other`, and any
 * `child`) to the i18n relationship key suffix. Unknown values fall back to
 * `Other`, so the display label is always localized and never leaks a raw token.
 */
export function relationshipKey(
  relationship: string,
): "relationshipParent" | "relationshipGuardian" | "relationshipChild" | "relationshipOther" {
  switch (relationship.trim().toLowerCase()) {
    case "parent":
      return "relationshipParent";
    case "guardian":
      return "relationshipGuardian";
    case "child":
      return "relationshipChild";
    default:
      return "relationshipOther";
  }
}
