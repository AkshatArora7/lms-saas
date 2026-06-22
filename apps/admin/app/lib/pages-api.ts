import { TENANT_ID } from "./auth";

/**
 * Server-only client for the rich-page authoring surface of the content
 * microservice (#32). Mirrors `courses-api.ts`: every call forwards the
 * authenticated tenant as the trusted `x-tenant-id` header (the gateway injects
 * this in production and the content service's resolver expects it), so all
 * page data stays tenant-scoped. Mutations return discriminated-union results
 * rather than throwing so the BFF route handlers can surface a clean message.
 *
 * Used by the per-course Pages list (RSC) and by the BFF route handlers under
 * app/api/* that back the interactive editor client.
 */

export const CONTENT_SERVICE_URL =
  process.env.CONTENT_SERVICE_URL ?? "http://localhost:4006";

export type PageStatus = "draft" | "published";
export type PageVersionState = "draft" | "published";

export interface PageRecord {
  id: string;
  tenantId: string;
  courseId: string;
  title: string;
  slug: string;
  status: PageStatus;
  publishedVersionId: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PageVersionRecord {
  id: string;
  tenantId: string;
  pageId: string;
  versionNumber: number;
  body: string;
  state: PageVersionState;
  createdBy: string | null;
  createdAt: string;
}

export interface PageDetail extends PageRecord {
  currentVersion: PageVersionRecord | null;
}

/** Version row without the (potentially large) body — for the history list. */
export type VersionSummary = Omit<PageVersionRecord, "body">;

export interface SignedUpload {
  key: string;
  uploadUrl: string;
  blobUrl: string;
}

export interface UploadRequest {
  filename: string;
  contentType: string;
  sizeBytes: number;
}

export type ListPagesResult =
  | { ok: true; pages: PageRecord[] }
  | { ok: false; error: string };

export type PageResult =
  | { ok: true; page: PageDetail }
  | { ok: false; status: number; error: string };

export type VersionsResult =
  | { ok: true; versions: VersionSummary[] }
  | { ok: false; error: string };

export type VersionResult =
  | { ok: true; version: PageVersionRecord }
  | { ok: false; status: number; error: string };

export type SignResult =
  | { ok: true; upload: SignedUpload }
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
  "The content service is unreachable. Start it (CONTENT_STORE=memory pnpm dev in services/content) to author pages here.";

/** List all pages for a course (no version body). */
export async function listPages(
  courseId: string,
  tenantId: string = TENANT_ID,
): Promise<ListPagesResult> {
  try {
    const res = await fetch(
      `${CONTENT_SERVICE_URL}/courses/${courseId}/pages`,
      { headers: headers(tenantId), cache: "no-store" },
    );
    if (!res.ok) {
      return { ok: false, error: await readError(res, "Failed to load pages.") };
    }
    const data = (await res.json()) as { pages: PageRecord[] };
    return { ok: true, pages: data.pages };
  } catch {
    return { ok: false, error: OFFLINE };
  }
}

/** Fetch a single page with its current version body. */
export async function getPage(
  id: string,
  tenantId: string = TENANT_ID,
): Promise<PageResult> {
  try {
    const res = await fetch(`${CONTENT_SERVICE_URL}/pages/${id}`, {
      headers: headers(tenantId),
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: await readError(res, "Page not found."),
      };
    }
    const data = (await res.json()) as { page: PageDetail };
    return { ok: true, page: data.page };
  } catch {
    return { ok: false, status: 503, error: OFFLINE };
  }
}

export async function createPage(
  courseId: string,
  input: { title: string; slug?: string; body?: string },
  tenantId: string = TENANT_ID,
): Promise<PageResult> {
  try {
    const res = await fetch(
      `${CONTENT_SERVICE_URL}/courses/${courseId}/pages`,
      {
        method: "POST",
        headers: headers(tenantId),
        body: JSON.stringify(input),
        cache: "no-store",
      },
    );
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: await readError(res, "Failed to create page."),
      };
    }
    const data = (await res.json()) as { page: PageDetail };
    return { ok: true, page: data.page };
  } catch {
    return { ok: false, status: 503, error: OFFLINE };
  }
}

export async function updatePage(
  id: string,
  input: { title?: string; slug?: string; body?: string },
  tenantId: string = TENANT_ID,
): Promise<PageResult> {
  try {
    const res = await fetch(`${CONTENT_SERVICE_URL}/pages/${id}`, {
      method: "PATCH",
      headers: headers(tenantId),
      body: JSON.stringify(input),
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: await readError(res, "Failed to save page."),
      };
    }
    const data = (await res.json()) as { page: PageDetail };
    return { ok: true, page: data.page };
  } catch {
    return { ok: false, status: 503, error: OFFLINE };
  }
}

export async function publishPage(
  id: string,
  versionId: string | undefined,
  tenantId: string = TENANT_ID,
): Promise<PageResult> {
  try {
    const res = await fetch(`${CONTENT_SERVICE_URL}/pages/${id}/publish`, {
      method: "POST",
      headers: headers(tenantId),
      body: JSON.stringify(versionId ? { versionId } : {}),
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: await readError(res, "Failed to publish page."),
      };
    }
    const data = (await res.json()) as { page: PageDetail };
    return { ok: true, page: data.page };
  } catch {
    return { ok: false, status: 503, error: OFFLINE };
  }
}

export async function listVersions(
  id: string,
  tenantId: string = TENANT_ID,
): Promise<VersionsResult> {
  try {
    const res = await fetch(`${CONTENT_SERVICE_URL}/pages/${id}/versions`, {
      headers: headers(tenantId),
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        ok: false,
        error: await readError(res, "Couldn't load history."),
      };
    }
    const data = (await res.json()) as { versions: VersionSummary[] };
    return { ok: true, versions: data.versions };
  } catch {
    return { ok: false, error: OFFLINE };
  }
}

export async function getVersion(
  id: string,
  versionId: string,
  tenantId: string = TENANT_ID,
): Promise<VersionResult> {
  try {
    const res = await fetch(
      `${CONTENT_SERVICE_URL}/pages/${id}/versions/${versionId}`,
      { headers: headers(tenantId), cache: "no-store" },
    );
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: await readError(res, "Version not found."),
      };
    }
    const data = (await res.json()) as { version: PageVersionRecord };
    return { ok: true, version: data.version };
  } catch {
    return { ok: false, status: 503, error: OFFLINE };
  }
}

/** Request a signed upload URL for a media/file embed (reuses POST /uploads). */
export async function signUpload(
  input: UploadRequest,
  tenantId: string = TENANT_ID,
): Promise<SignResult> {
  try {
    const res = await fetch(`${CONTENT_SERVICE_URL}/uploads`, {
      method: "POST",
      headers: headers(tenantId),
      body: JSON.stringify(input),
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: await readError(res, "Upload could not be prepared."),
      };
    }
    const data = (await res.json()) as { upload: SignedUpload };
    return { ok: true, upload: data.upload };
  } catch {
    return { ok: false, status: 503, error: OFFLINE };
  }
}

/** Used only by the bodyless tenant-header guard in some service calls. */
export { tenantHeader };
