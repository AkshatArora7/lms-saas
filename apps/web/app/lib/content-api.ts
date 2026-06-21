import { TENANT_ID } from "./auth";

/**
 * Server-only client for the content microservice.
 *
 * BFF read boundary for a course's modules and their topics (content items).
 * Forwards the authenticated tenant as `x-tenant-id`; reads return `[]` on
 * failure so the Server Component can render a clean empty/offline state.
 */

export const CONTENT_SERVICE_URL =
  process.env.CONTENT_SERVICE_URL ?? "http://localhost:4006";

export type TopicKind = "html" | "file" | "link" | "scorm" | "lti" | "video";

export interface Module {
  id: string;
  tenantId: string;
  courseId: string;
  parentId: string | null;
  title: string;
  position: number;
  createdAt: string;
}

export interface Topic {
  id: string;
  tenantId: string;
  moduleId: string;
  title: string;
  kind: TopicKind;
  body: string | null;
  blobUrl: string | null;
  position: number;
  isRequired: boolean;
  createdAt: string;
}

function tenantHeader(tenantId: string): HeadersInit {
  return { "x-tenant-id": tenantId };
}

/** List a course's modules, ordered by the service. Returns `[]` on error. */
export async function listModules(
  courseId: string,
  tenantId: string = TENANT_ID,
): Promise<Module[]> {
  try {
    const res = await fetch(
      `${CONTENT_SERVICE_URL}/courses/${encodeURIComponent(courseId)}/modules`,
      { headers: tenantHeader(tenantId), cache: "no-store" },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { modules: Module[] };
    return data.modules ?? [];
  } catch {
    return [];
  }
}

/** List a module's topics (content items). Returns `[]` on error. */
export async function listTopics(
  moduleId: string,
  tenantId: string = TENANT_ID,
): Promise<Topic[]> {
  try {
    const res = await fetch(
      `${CONTENT_SERVICE_URL}/modules/${encodeURIComponent(moduleId)}/topics`,
      { headers: tenantHeader(tenantId), cache: "no-store" },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { topics: Topic[] };
    return data.topics ?? [];
  } catch {
    return [];
  }
}
