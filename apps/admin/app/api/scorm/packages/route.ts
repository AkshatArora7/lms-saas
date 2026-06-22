import { NextResponse } from "next/server";

import { getSession, isAdmin } from "../../../lib/auth";
import { createScormPackage } from "../../../lib/scorm-api";

/**
 * BFF: import a SCORM package (#31). Re-checks the admin session (import is
 * org_admin+ only, matching courses/new) and forwards the trusted tenant as
 * x-tenant-id to the content service POST /scorm/packages — mirroring
 * app/api/uploads/route.ts. The client first uploads the .zip via the existing
 * signed-upload flow (POST /api/uploads) and passes the returned blobUrl here
 * alongside the imsmanifest.xml. The backend's typed 400 reasons
 * (invalid_manifest | no_launchable_resource | unsafe_href) are passed through
 * so the form can map each to recoverable copy.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    manifestXml?: unknown;
    blobUrl?: unknown;
    topicId?: unknown;
  };

  if (typeof body.manifestXml !== "string" || !body.manifestXml.trim()) {
    return NextResponse.json(
      { error: "An imsmanifest.xml is required." },
      { status: 400 },
    );
  }
  if (typeof body.blobUrl !== "string" || !body.blobUrl.trim()) {
    return NextResponse.json(
      { error: "Upload the .zip archive first." },
      { status: 400 },
    );
  }
  const topicId =
    typeof body.topicId === "string" && body.topicId.trim()
      ? body.topicId.trim()
      : null;

  const result = await createScormPackage(
    {
      manifestXml: body.manifestXml,
      blobUrl: body.blobUrl.trim(),
      topicId,
    },
    session.tenantId,
  );

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, reason: result.reason },
      { status: result.status },
    );
  }
  return NextResponse.json({ package: result.package }, { status: 201 });
}
