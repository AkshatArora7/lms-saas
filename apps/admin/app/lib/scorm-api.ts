import { TENANT_ID } from "./auth";
import { CONTENT_SERVICE_URL } from "./pages-api";

/**
 * Server-only client for the SCORM surface of the content microservice (#31).
 * Mirrors `pages-api.ts`: every call forwards the authenticated tenant as the
 * trusted `x-tenant-id` header (the gateway injects this in production and the
 * content service's resolver expects it), so all package data stays
 * tenant-scoped. The import mutation returns a discriminated-union result rather
 * than throwing so the BFF route handler can surface a clean, recoverable
 * message and map the backend's typed 400 reasons.
 *
 * Used by the admin import BFF route under app/api/scorm/*.
 */

export type ScormVersion = "1.2" | "2004";

export interface ScormPackageRecord {
  id: string;
  version: ScormVersion;
  title: string | null;
  launchHref: string;
  masteryScore: number | null;
  blobUrl: string;
  topicId?: string | null;
}

export interface CreateScormPackageInput {
  manifestXml: string;
  blobUrl: string;
  topicId?: string | null;
}

/** The typed reasons the content service returns on a 400. */
export type ScormImportReason =
  | "invalid_manifest"
  | "no_launchable_resource"
  | "unsafe_href";

export type CreateScormPackageResult =
  | { ok: true; package: ScormPackageRecord }
  | {
      ok: false;
      status: number;
      /** Machine-readable reason when the backend supplied one. */
      reason?: ScormImportReason;
      error: string;
    };

function headers(tenantId: string): HeadersInit {
  return { "content-type": "application/json", "x-tenant-id": tenantId };
}

const OFFLINE =
  "The content service is unavailable. Start it (CONTENT_STORE=memory pnpm dev in services/content) to import packages.";

/** Import a SCORM package: parse the manifest + store a launchable entry. */
export async function createScormPackage(
  input: CreateScormPackageInput,
  tenantId: string = TENANT_ID,
): Promise<CreateScormPackageResult> {
  try {
    const res = await fetch(`${CONTENT_SERVICE_URL}/scorm/packages`, {
      method: "POST",
      headers: headers(tenantId),
      body: JSON.stringify(input),
      cache: "no-store",
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
      };
      const reason =
        data.error === "invalid_manifest" ||
        data.error === "no_launchable_resource" ||
        data.error === "unsafe_href"
          ? (data.error as ScormImportReason)
          : undefined;
      return {
        ok: false,
        status: res.status,
        reason,
        error: data.message ?? data.error ?? "The package could not be imported.",
      };
    }
    const data = (await res.json()) as { package: ScormPackageRecord };
    return { ok: true, package: data.package };
  } catch {
    return { ok: false, status: 503, error: OFFLINE };
  }
}
