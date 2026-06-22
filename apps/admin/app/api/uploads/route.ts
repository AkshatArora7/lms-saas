import { NextResponse } from "next/server";

import { getSession, isAdmin } from "../../lib/auth";
import { signUpload } from "../../lib/pages-api";

/**
 * BFF: request a signed upload URL for a media/file embed (#32, architect D4 —
 * reuses the content service's existing POST /uploads). Re-checks the admin
 * session and forwards the tenant; the client then PUTs bytes straight to the
 * returned uploadUrl and embeds the blobUrl inline in the page HTML.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    filename?: unknown;
    contentType?: unknown;
    sizeBytes?: unknown;
  };
  if (typeof body.filename !== "string" || !body.filename.trim()) {
    return NextResponse.json({ error: "A filename is required." }, { status: 400 });
  }
  if (typeof body.contentType !== "string" || !body.contentType.trim()) {
    return NextResponse.json(
      { error: "A content type is required." },
      { status: 400 },
    );
  }
  if (typeof body.sizeBytes !== "number" || body.sizeBytes <= 0) {
    return NextResponse.json(
      { error: "A valid file size is required." },
      { status: 400 },
    );
  }
  const result = await signUpload(
    {
      filename: body.filename.trim(),
      contentType: body.contentType.trim(),
      sizeBytes: body.sizeBytes,
    },
    session.tenantId,
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ upload: result.upload }, { status: 201 });
}
