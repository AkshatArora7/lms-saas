import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { SUPPORTED_LOCALES } from "@lms/i18n";

import { ACCESS_COOKIE, IDENTITY_URL, TENANT_ID } from "../../lib/auth";
import { LOCALE_COOKIE } from "../../lib/i18n";

/**
 * BFF locale route for the admin console (#88). Mirrors the learner app:
 * authenticated → forward to identity `PATCH /users/me/locale` with the bearer
 * token + `x-tenant-id` (token never leaves the server, user id derived from the
 * token by identity → IDOR-safe); unauthenticated → cookie only. The
 * `lms_locale` cookie mirror is always set so the next RSC render picks the new
 * locale after the client calls `router.refresh()`.
 */
export async function POST(req: Request): Promise<NextResponse> {
  let locale: unknown;
  try {
    const body = (await req.json()) as { locale?: unknown };
    locale = body.locale;
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  if (
    typeof locale !== "string" ||
    !(SUPPORTED_LOCALES as string[]).includes(locale)
  ) {
    return NextResponse.json({ error: "unsupported_locale" }, { status: 400 });
  }

  const token = cookies().get(ACCESS_COOKIE)?.value;

  if (token) {
    try {
      const upstream = await fetch(`${IDENTITY_URL}/users/me/locale`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
          "x-tenant-id": TENANT_ID,
        },
        body: JSON.stringify({ locale }),
        cache: "no-store",
      });
      if (!upstream.ok) {
        return NextResponse.json(
          { error: "persist_failed" },
          { status: upstream.status === 200 ? 502 : upstream.status },
        );
      }
    } catch {
      return NextResponse.json({ error: "persist_failed" }, { status: 502 });
    }
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(LOCALE_COOKIE, locale, {
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}
