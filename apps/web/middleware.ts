import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Edge middleware. Two responsibilities, in order:
 *
 *  1. Custom-domain → tenant resolution (#12). For a request arriving on a
 *     custom host (e.g. learn.school.edu, school.lms.app), resolve the host to a
 *     tenant id via the tenant service's pre-auth, control-plane by-domain
 *     lookup and forward it to the server layer on the `x-lms-tenant` request
 *     header. The root layout reads that header (resolveCurrentTenantId) so the
 *     custom-domain landing/login screen already carries the school's brand,
 *     BEFORE any session exists. Requests on the default app domain (and
 *     localhost) skip the lookup and fall back to the session/pinned tenant.
 *
 *  2. Centralized unauthenticated → /login redirect (deny-by-default, #103). A
 *     cheap presence-only check of the access-token cookie; token validity stays
 *     the authority of getSession() at the page level.
 *
 * The cookie/header names are literals — they MUST stay in sync with
 * ACCESS_COOKIE and TENANT_HEADER in app/lib/auth.ts. We cannot import that
 * module here because it imports `next/headers`, which is illegal in Edge
 * middleware; keeping the middleware dependency-free is intentional. Edge
 * fetch to the tenant service is allowed (the runtime supports global fetch).
 */
const ACCESS_COOKIE = "lms_at"; // == ACCESS_COOKIE in app/lib/auth.ts
const TENANT_HEADER = "x-lms-tenant"; // == TENANT_HEADER in app/lib/auth.ts

const TENANT_SERVICE_URL =
  process.env.TENANT_SERVICE_URL ?? "http://localhost:4002";
/**
 * The platform's own app domain. Requests on this host or any of its subdomains
 * are first-party and use the session/pinned tenant — only genuinely custom
 * domains hit the by-domain lookup. Defaults to localhost for local dev.
 */
const APP_DOMAIN = (process.env.APP_DOMAIN ?? "localhost").toLowerCase();

/** Strip port and trailing dot; lower-case. Empty → null. */
function normalizeHost(raw: string | null): string | null {
  if (!raw) return null;
  const host = (raw.trim().toLowerCase().split(":")[0] ?? "").replace(/\.$/, "");
  return host || null;
}

/** A first-party host needs no by-domain lookup (uses session/pinned tenant). */
function isFirstPartyHost(host: string): boolean {
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") {
    return true;
  }
  return host === APP_DOMAIN || host.endsWith(`.${APP_DOMAIN}`);
}

/**
 * Resolve a custom host to a tenant id via the tenant service. Returns null on
 * any failure/404 so the app falls back to the session/pinned tenant — host
 * resolution must never block navigation.
 */
async function resolveTenantByDomain(host: string): Promise<string | null> {
  try {
    const res = await fetch(
      `${TENANT_SERVICE_URL}/tenants/by-domain/${encodeURIComponent(host)}`,
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { tenantId?: string };
    return data.tenantId ?? null;
  } catch {
    return null;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // (1) Custom-domain → tenant resolution. Forward the resolved tenant to the
  // server layer on a request header. Skip first-party hosts entirely.
  const host = normalizeHost(request.headers.get("host"));
  let tenantId: string | null = null;
  if (host && !isFirstPartyHost(host)) {
    tenantId = await resolveTenantByDomain(host);
  }

  const requestHeaders = new Headers(request.headers);
  // Never trust an inbound copy of our internal header — strip then set.
  requestHeaders.delete(TENANT_HEADER);
  if (tenantId) {
    requestHeaders.set(TENANT_HEADER, tenantId);
  }
  const forward = { request: { headers: requestHeaders } };

  // (2) Auth redirect. Always allow public auth paths through (the matcher
  // already excludes them; belt-and-suspenders), preserving the tenant header.
  if (pathname === "/login" || pathname.startsWith("/api/auth")) {
    return NextResponse.next(forward);
  }

  // Presence-only check. Missing access cookie => unauthenticated.
  if (!request.cookies.get(ACCESS_COOKIE)) {
    const loginUrl = new URL("/login", request.url);
    // Preserve the intended destination so login can return the user there.
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl, 307);
  }

  return NextResponse.next(forward);
}

// NOTE: `/login` is intentionally NOT excluded from the matcher (unlike the
// auth-only middleware before #12): the middleware must run on the login route
// so a custom-domain sign-in screen carries the school's brand BEFORE any
// session exists. The handler short-circuits the auth redirect for `/login`
// and `/api/auth` (returning next() with the tenant header), so this is safe.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
