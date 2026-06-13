import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  IDENTITY_URL,
  SSO_PROVIDER_ID,
  SSO_STATE_COOKIE,
  TENANT_ID,
  cookieBase,
} from "../../../../lib/auth";

/**
 * OIDC redirect target. The IdP sends the browser here with `?code=&state=`.
 * We verify the returned state matches the one we issued (stored httpOnly),
 * exchange it via the identity service for first-party tokens, and drop the
 * session cookies before sending the user to the app.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const origin = url.origin;
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  const jar = cookies();
  const cookieState = jar.get(SSO_STATE_COOKIE)?.value;

  const fail = (reason: string): NextResponse => {
    const res = NextResponse.redirect(
      new URL(`/login?error=${reason}`, origin),
      { status: 303 },
    );
    res.cookies.set(SSO_STATE_COOKIE, "", { ...cookieBase, maxAge: 0 });
    return res;
  };

  if (!code || !returnedState || !cookieState || returnedState !== cookieState) {
    return fail("sso_state");
  }

  const upstream = await fetch(
    `${IDENTITY_URL}/auth/sso/${SSO_PROVIDER_ID}/callback`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-tenant-id": TENANT_ID },
      body: JSON.stringify({ code, state: returnedState }),
      cache: "no-store",
    },
  );

  const data = (await upstream.json().catch(() => ({}))) as {
    accessToken?: string;
    refreshToken?: string;
    expiresIn?: number;
  };
  if (!upstream.ok || !data.accessToken || !data.refreshToken) {
    return fail("sso_failed");
  }

  const res = NextResponse.redirect(new URL("/", origin), { status: 303 });
  res.cookies.set(SSO_STATE_COOKIE, "", { ...cookieBase, maxAge: 0 });
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
