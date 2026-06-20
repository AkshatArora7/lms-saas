import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  IDENTITY_URL,
  TENANT_ID,
  cookieBase,
} from "../../../lib/auth";

/**
 * BFF login for the admin console. Forwards credentials to the identity service
 * and stores the returned tokens in httpOnly cookies. Role gating happens when
 * rendering the console, not here, so a non-admin still gets a session and a
 * clear "not authorized" message rather than a silent failure.
 *
 * Two transports are supported so credentials never end up in a URL:
 *  - JSON (the hydrated client's fetch): responds with a {ok}/{error} flag.
 *  - form-encoded (the no-JS / pre-hydration native form submit): the form
 *    POSTs with method="post", so fields travel in the request body — never the
 *    query string — and we answer with a 303 redirect. On failure we redirect
 *    back to /login with an error *code* only, never the submitted credentials.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const contentType = req.headers.get("content-type") ?? "";
  const isForm =
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data");

  let email: unknown;
  let password: unknown;

  if (isForm) {
    const form = await req.formData().catch(() => null);
    if (!form) return loginRedirect(req, "invalid_request");
    email = form.get("email");
    password = form.get("password");
  } else {
    try {
      const body = (await req.json()) as {
        email?: unknown;
        password?: unknown;
      };
      email = body.email;
      password = body.password;
    } catch {
      return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    }
  }

  const upstream = await fetch(`${IDENTITY_URL}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-tenant-id": TENANT_ID },
    body: JSON.stringify({ email, password }),
    cache: "no-store",
  });

  const data = (await upstream.json().catch(() => ({}))) as {
    accessToken?: string;
    refreshToken?: string;
    expiresIn?: number;
    error?: string;
    message?: string;
  };

  if (!upstream.ok || !data.accessToken || !data.refreshToken) {
    if (isForm) return loginRedirect(req, data.error ?? "login_failed");
    return NextResponse.json(
      { error: data.error ?? "login_failed", message: data.message },
      { status: upstream.status === 200 ? 502 : upstream.status },
    );
  }

  if (isForm) {
    const res = NextResponse.redirect(new URL("/", req.url), { status: 303 });
    res.cookies.set(ACCESS_COOKIE, data.accessToken, {
      ...cookieBase,
      maxAge: data.expiresIn ?? 900,
    });
    res.cookies.set(REFRESH_COOKIE, data.refreshToken, {
      ...cookieBase,
      maxAge: 60 * 60 * 24 * 30,
    });
    return res;
  }

  const jar = cookies();
  jar.set(ACCESS_COOKIE, data.accessToken, {
    ...cookieBase,
    maxAge: data.expiresIn ?? 900,
  });
  jar.set(REFRESH_COOKIE, data.refreshToken, {
    ...cookieBase,
    maxAge: 60 * 60 * 24 * 30,
  });

  return NextResponse.json({ ok: true });
}

/** Redirect a no-JS form submit back to the sign-in page with an error *code*
 * only — never the submitted email or password. */
function loginRedirect(req: Request, error: string): NextResponse {
  const url = new URL("/login", req.url);
  url.searchParams.set("error", error);
  return NextResponse.redirect(url, { status: 303 });
}
