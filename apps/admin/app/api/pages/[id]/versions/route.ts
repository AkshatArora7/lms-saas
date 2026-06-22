import { NextResponse } from "next/server";

import { getSession, isAdmin } from "../../../../lib/auth";
import { listVersions } from "../../../../lib/pages-api";

/** BFF: list a page's versions newest-first, no body (#32, route 6). */
export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const result = await listVersions(params.id, session.tenantId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }
  return NextResponse.json({ versions: result.versions });
}
