import { NextResponse } from "next/server";

import { getSession } from "../../../lib/auth";
import { requestUpload } from "../../../lib/video-api";

/**
 * BFF for the signed-upload step of the teacher video flow (#320). Mirrors the
 * SCORM runtime route: it resolves the authenticated session and stamps the
 * SERVER-TRUSTED identity (`x-tenant-id` + `x-user-id` + `x-user-roles`) onto
 * the call to the video service, so the client never supplies its own identity
 * and the service's uploader-role guard is authoritative.
 *
 * The service validates the content-type allow-list + max size and returns 413
 * (too large) / 415 (unsupported type); we pass those statuses through so the
 * uploader can show a friendly message.
 *
 *   POST -> { upload: { key, uploadUrl, blobUrl } }
 */
export async function POST(req: Request): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const filename = typeof body.filename === "string" ? body.filename : "";
  const contentType =
    typeof body.contentType === "string" ? body.contentType : "";
  const sizeBytes = typeof body.sizeBytes === "number" ? body.sizeBytes : NaN;

  if (!filename || !contentType || !Number.isFinite(sizeBytes)) {
    return NextResponse.json(
      { error: "filename, contentType and sizeBytes are required." },
      { status: 400 },
    );
  }

  const result = await requestUpload(
    { filename, contentType, sizeBytes },
    { userId: session.userId, roles: session.roles },
    session.tenantId,
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ upload: result.upload }, { status: 201 });
}
