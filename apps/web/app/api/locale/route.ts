import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { SUPPORTED_LOCALES } from "@lms/i18n";

import { ACCESS_COOKIE, IDENTITY_URL, TENANT_ID } from "../../lib/auth";
import { LOCALE_COOKIE } from "../../lib/i18n";

/**
 * BFF locale route (#88). Persists the chosen locale.
 *
 *  - Authenticated (access cookie present): forwards to identity
 *    `PATCH /users/me/locale` with the bearer token + `x-tenant-id` so
 *    `app_user.locale` is updated server-side. The browser never sees the token.
 *  - Unauthenticated (e.g. on /login): no DB write — only the `lms_locale`
 *    cookie is set so the choice survives until sign-in.
 *
 * In BOTH cases the `lms_locale` cookie mirror is set so `resolveRequestLocale()`
 * picks the new locale on the next RSC render (client calls `router.refresh()`).
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

  // Authenticated → persist to identity. The target user id is derived from the
  // verified token by identity (IDOR-safe); we never send a user id.
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

  // Cookie mirror (httpOnly: false so it is a plain preference, not a secret).
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
