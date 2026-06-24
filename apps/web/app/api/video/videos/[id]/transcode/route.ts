import { NextResponse } from "next/server";

import { getSession } from "../../../../../lib/auth";
import { retranscodeVideo } from "../../../../../lib/video-api";

/**
 * BFF that re-runs the transcode pipeline for a video (#320) — used by the
 * teacher "Retry processing" action. Mirrors the SCORM runtime route: resolves
 * the session and stamps the SERVER-TRUSTED identity (`x-tenant-id` +
 * `x-user-id` + `x-user-roles`) so the service's owner/admin guard is
 * authoritative and the client cannot forge who it is.
 *
 *   POST -> { video }
 */
export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await retranscodeVideo(
    params.id,
    { userId: session.userId, roles: session.roles },
    session.tenantId,
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ video: result.video });
}
