import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  IDENTITY_URL,
  TENANT_ID,
} from "../../../lib/auth";

/**
 * BFF logout: revokes the refresh-token family upstream (best-effort) and
 * clears the session cookies. Always succeeds from the client's perspective.
 */
export async function POST(): Promise<NextResponse> {
  const jar = cookies();
  const refreshToken = jar.get(REFRESH_COOKIE)?.value;

  if (refreshToken) {
    try {
      await fetch(`${IDENTITY_URL}/auth/logout`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-tenant-id": TENANT_ID,
        },
        body: JSON.stringify({ refreshToken }),
        cache: "no-store",
      });
    } catch {
      // Ignore upstream failures; we still clear the local session.
    }
  }

  jar.delete(ACCESS_COOKIE);
  jar.delete(REFRESH_COOKIE);
  return NextResponse.json({ ok: true });
}
