import { NextResponse } from "next/server";

import { getSession } from "../../../lib/auth";
import { createVideo } from "../../../lib/video-api";

/**
 * BFF that creates the video asset after the bytes are uploaded to Blob (#320).
 * Mirrors the SCORM runtime route: resolves the session and stamps the
 * SERVER-TRUSTED identity (`x-tenant-id` + `x-user-id` + `x-user-roles`) so the
 * service stamps the owner from a value the client cannot forge and the
 * uploader-role guard is authoritative.
 *
 *   POST { title, sourceBlobUrl, courseId? } -> { video }
 */
export async function POST(req: Request): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const sourceBlobUrl =
    typeof body.sourceBlobUrl === "string" ? body.sourceBlobUrl.trim() : "";
  const courseId =
    typeof body.courseId === "string" && body.courseId.trim().length > 0
      ? body.courseId.trim()
      : undefined;

  if (!title || !sourceBlobUrl) {
    return NextResponse.json(
      { error: "title and sourceBlobUrl are required." },
      { status: 400 },
    );
  }

  const result = await createVideo(
    { title, sourceBlobUrl, courseId },
    { userId: session.userId, roles: session.roles },
    session.tenantId,
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ video: result.video }, { status: 201 });
}
