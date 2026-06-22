import { NextResponse } from "next/server";

import { getSession, isAdmin } from "../../../lib/auth";
import { getPage, updatePage } from "../../../lib/pages-api";
import { sanitizeHtml } from "../../../lib/sanitize-html";

/**
 * BFF for a single page (#32): read the page + current version, or PATCH it
 * (title/slug, and a body change creates a new draft version server-side). The
 * body is sanitized server-side before reaching the store (stored-XSS gate).
 */

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const result = await getPage(params.id, session.tenantId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ page: result.page });
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
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
  const patch: { title?: string; slug?: string; body?: string } = {};
  if (body.title !== undefined) {
    if (typeof body.title !== "string" || !body.title.trim()) {
      return NextResponse.json(
        { error: "Title must not be empty." },
        { status: 400 },
      );
    }
    patch.title = body.title.trim();
  }
  if (body.slug !== undefined) {
    if (typeof body.slug !== "string" || !body.slug.trim()) {
      return NextResponse.json(
        { error: "Slug must not be empty." },
        { status: 400 },
      );
    }
    patch.slug = body.slug.trim();
  }
  if (body.body !== undefined) {
    if (typeof body.body !== "string") {
      return NextResponse.json({ error: "Invalid body." }, { status: 400 });
    }
    patch.body = sanitizeHtml(body.body);
  }
  const result = await updatePage(params.id, patch, session.tenantId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ page: result.page });
}
