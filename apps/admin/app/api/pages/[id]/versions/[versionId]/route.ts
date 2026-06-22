import { NextResponse } from "next/server";

import { getSession, isAdmin } from "../../../../../lib/auth";
import { getVersion } from "../../../../../lib/pages-api";
import { sanitizeHtml } from "../../../../../lib/sanitize-html";

/**
 * BFF: read one full version including its body (#32, route 7). The stored body
 * is sanitized again on the way out (defense in depth — output sanitize gate).
 */
export async function GET(
  _req: Request,
  { params }: { params: { id: string; versionId: string } },
): Promise<NextResponse> {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const result = await getVersion(params.id, params.versionId, session.tenantId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({
    version: { ...result.version, body: sanitizeHtml(result.version.body) },
  });
}
