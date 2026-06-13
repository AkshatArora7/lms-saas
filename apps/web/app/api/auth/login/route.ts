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
 * BFF login: forwards credentials to the identity service with the resolved
 * tenant, then stores the returned tokens in httpOnly cookies. The client only
 * ever sees a success/failure flag — never a token.
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
