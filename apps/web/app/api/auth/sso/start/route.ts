import { NextResponse } from "next/server";

import {
  IDENTITY_URL,
  SSO_PROVIDER_ID,
  SSO_STATE_COOKIE,
  TENANT_ID,
  cookieBase,
} from "../../../../lib/auth";

/**
 * Begin SSO sign-in. Asks the identity service to start an OIDC flow, stashes
 * the signed `state` in a short-lived httpOnly cookie (replayed on callback to
 * defeat CSRF), and redirects the browser to the school's identity provider.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const origin = new URL(req.url).origin;

  const upstream = await fetch(
    `${IDENTITY_URL}/auth/sso/${SSO_PROVIDER_ID}/start`,
    {
      method: "POST",
      headers: { "x-tenant-id": TENANT_ID },
      cache: "no-store",
    },
  );

  const data = (await upstream.json().catch(() => ({}))) as {
    authorizationUrl?: string;
    state?: string;
  };
  if (!upstream.ok || !data.authorizationUrl || !data.state) {
    return NextResponse.redirect(
      new URL("/login?error=sso_unavailable", origin),
      { status: 303 },
    );
  }

  const res = NextResponse.redirect(data.authorizationUrl, { status: 303 });
  res.cookies.set(SSO_STATE_COOKIE, data.state, {
    ...cookieBase,
    maxAge: 600,
  });
  return res;
}
