import { TENANT_ID } from "./auth";

/**
 * Server-only client for the SCORM surface of the content microservice (#31),
 * for the learner web app. Every call forwards the authenticated tenant as the
 * trusted `x-tenant-id` header (the gateway injects this in production and the
 * content service's resolver expects it), so all package + attempt data stays
 * tenant-scoped.
 *
 * The runtime read/write calls take an explicit `learnerId` — the callers (the
 * RSC page and the BFF route handlers under app/api/scorm/*) ALWAYS pass the
 * server-resolved `session.userId`, never a client-supplied value, so a learner
 * can't report progress as someone else. Mutations return discriminated-union
 * results so the BFF route handlers can surface a clean message.
 */

export const CONTENT_SERVICE_URL =
  process.env.CONTENT_SERVICE_URL ?? "http://localhost:4006";

export type ScormVersion = "1.2" | "2004";

export type ScormCompletionStatus =
  | "completed"
  | "incomplete"
  | "not_attempted"
  | "unknown";

export type ScormSuccessStatus = "passed" | "failed" | "unknown";

export interface ScormPackageRecord {
  id: string;
  version: ScormVersion;
  title: string | null;
  launchHref: string;
  masteryScore: number | null;
  blobUrl: string;
  topicId?: string | null;
}

export interface ScormAttemptRecord {
  id: string;
  packageId: string;
  learnerId: string;
  completionStatus: ScormCompletionStatus;
  successStatus: ScormSuccessStatus;
  scoreScaled: number | null;
  scoreRaw: number | null;
  lessonStatus: string | null;
  sessionTime: string | null;
  totalTime: string | null;
  attemptedAt: string;
  updatedAt: string;
}

/** Runtime save input (cmi subset). learnerId is injected server-side. */
export interface SaveScormRuntimeInput {
  completionStatus?: ScormCompletionStatus;
  successStatus?: ScormSuccessStatus;
  scoreRaw?: number;
  scoreMax?: number;
  scoreScaled?: number;
  lessonStatus?: string;
  sessionTime?: string;
}

export type GetScormPackageResult =
  | { ok: true; package: ScormPackageRecord }
  | { ok: false; status: number; error: string };

export type GetScormAttemptResult =
  | { ok: true; attempt: ScormAttemptRecord | null }
  | { ok: false; status: number; error: string };

export type SaveScormAttemptResult =
  | { ok: true; attempt: ScormAttemptRecord }
  | { ok: false; status: number; error: string };

function headers(tenantId: string): HeadersInit {
  return { "content-type": "application/json", "x-tenant-id": tenantId };
}

function tenantHeader(tenantId: string): HeadersInit {
  return { "x-tenant-id": tenantId };
}

async function readError(res: Response, fallback: string): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { message?: string };
  return data.message ?? fallback;
}

const OFFLINE =
  "The content service is unavailable. Start it (CONTENT_STORE=memory pnpm dev in services/content) to play this module.";

/** Fetch launch info for a package. */
export async function getScormPackage(
  id: string,
  tenantId: string = TENANT_ID,
): Promise<GetScormPackageResult> {
  try {
    const res = await fetch(`${CONTENT_SERVICE_URL}/scorm/packages/${id}`, {
      headers: tenantHeader(tenantId),
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: await readError(res, "This SCORM module no longer exists or was moved."),
      };
    }
    const data = (await res.json()) as { package: ScormPackageRecord };
    return { ok: true, package: data.package };
  } catch {
    return { ok: false, status: 503, error: OFFLINE };
  }
}

/** Read back the learner's current attempt (or null if none yet). */
export async function getScormAttempt(
  id: string,
  learnerId: string,
  tenantId: string = TENANT_ID,
): Promise<GetScormAttemptResult> {
  try {
    const res = await fetch(
      `${CONTENT_SERVICE_URL}/scorm/packages/${id}/runtime?learnerId=${encodeURIComponent(learnerId)}`,
      { headers: tenantHeader(tenantId), cache: "no-store" },
    );
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: await readError(res, "Couldn't load your progress."),
      };
    }
    const data = (await res.json()) as { attempt: ScormAttemptRecord | null };
    return { ok: true, attempt: data.attempt };
  } catch {
    return { ok: false, status: 503, error: OFFLINE };
  }
}

/** Save (upsert) the learner's runtime state. learnerId comes from the session. */
export async function saveScormAttempt(
  id: string,
  learnerId: string,
  input: SaveScormRuntimeInput,
  tenantId: string = TENANT_ID,
): Promise<SaveScormAttemptResult> {
  try {
    const res = await fetch(`${CONTENT_SERVICE_URL}/scorm/packages/${id}/runtime`, {
      method: "PUT",
      headers: headers(tenantId),
      body: JSON.stringify({ ...input, learnerId }),
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: await readError(res, "Couldn't save your progress."),
      };
    }
    const data = (await res.json()) as { attempt: ScormAttemptRecord };
    return { ok: true, attempt: data.attempt };
  } catch {
    return { ok: false, status: 503, error: OFFLINE };
  }
}
