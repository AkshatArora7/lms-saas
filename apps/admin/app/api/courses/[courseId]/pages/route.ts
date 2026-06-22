import { NextResponse } from "next/server";

import { getSession, isAdmin } from "../../../../lib/auth";
import { createPage, listPages } from "../../../../lib/pages-api";
import { sanitizeHtml } from "../../../../lib/sanitize-html";

/**
 * BFF for the per-course pages collection (#32). Re-checks the session + admin
 * role server-side (never trust the client) and forwards the authenticated
 * tenant to the content service. On create, the page body is sanitized
 * server-side before it ever reaches the store (stored-XSS gate, architect D3).
 */

export async function GET(
  _req: Request,
  { params }: { params: { courseId: string } },
): Promise<NextResponse> {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const result = await listPages(params.courseId, session.tenantId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }
  return NextResponse.json({ pages: result.pages });
}

export async function POST(
  req: Request,
  { params }: { params: { courseId: string } },
): Promise<NextResponse> {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    title?: unknown;
    slug?: unknown;
    body?: unknown;
  };
  if (typeof body.title !== "string" || !body.title.trim()) {
    return NextResponse.json({ error: "Title is required." }, { status: 400 });
  }
  const result = await createPage(
    params.courseId,
    {
      title: body.title.trim(),
      ...(typeof body.slug === "string" && body.slug.trim()
        ? { slug: body.slug.trim() }
        : {}),
      ...(typeof body.body === "string"
        ? { body: sanitizeHtml(body.body) }
        : {}),
    },
    session.tenantId,
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ page: result.page }, { status: 201 });
}
