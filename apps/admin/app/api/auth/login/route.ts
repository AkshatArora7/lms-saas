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
 */
export async function POST(req: Request): Promise<NextResponse> {
  let body: { email?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const upstream = await fetch(`${IDENTITY_URL}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-tenant-id": TENANT_ID },
    body: JSON.stringify({ email: body.email, password: body.password }),
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
    return NextResponse.json(
      { error: data.error ?? "login_failed", message: data.message },
      { status: upstream.status === 200 ? 502 : upstream.status },
    );
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
