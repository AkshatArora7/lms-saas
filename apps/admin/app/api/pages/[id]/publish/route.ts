import { NextResponse } from "next/server";

import { getSession, isAdmin } from "../../../../lib/auth";
import { publishPage } from "../../../../lib/pages-api";

/** BFF: promote a draft version of a page to published (#32, route 5). */
export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as { versionId?: unknown };
  const versionId =
    typeof body.versionId === "string" && body.versionId.trim()
      ? body.versionId.trim()
      : undefined;
  const result = await publishPage(params.id, versionId, session.tenantId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ page: result.page });
}
