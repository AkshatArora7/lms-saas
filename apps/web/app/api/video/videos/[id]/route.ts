import { NextResponse } from "next/server";

import { getSession } from "../../../../lib/auth";
import { getVideo } from "../../../../lib/video-api";

/**
 * BFF read used by the client status poller (teacher uploader + library) and the
 * student player's still-processing auto-refresh (#320). Mirrors the SCORM
 * runtime route: resolves the session and stamps the SERVER-TRUSTED identity
 * (`x-tenant-id` + `x-user-id` + `x-user-roles`) so the video service's
 * course-access gate (#319 — deny = 404, existence-hiding) is authoritative and
 * the client never supplies its own identity.
 *
 *   GET -> { video }   (404/403 from the service is passed through as-is)
 */
export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await getVideo(
    params.id,
    { userId: session.userId, roles: session.roles },
    session.tenantId,
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ video: result.video });
}
