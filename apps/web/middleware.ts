import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Edge middleware: centralized unauthenticated -> /login redirect (AC3, #103).
 *
 * Deny-by-default. The matcher below makes EVERYTHING protected except the
 * listed public paths, so newly added pages are guarded automatically. This
 * performs a cheap, presence-only check of the access-token cookie; it does NOT
 * call /auth/me (Edge fetch on every navigation is slow/fragile). Token
 * validity remains the authority of getSession() at the page level, where an
 * expired-but-present cookie is caught and redirected. A missing access cookie
 * is the overwhelmingly common unauthenticated case and is handled here.
 *
 * The cookie name is the literal "lms_at" — it MUST stay in sync with
 * ACCESS_COOKIE in app/lib/auth.ts. We cannot import that module here because it
 * imports `next/headers`, which is illegal in Edge middleware; keeping the
 * middleware dependency-free is intentional.
 */
const ACCESS_COOKIE = "lms_at"; // == ACCESS_COOKIE in app/lib/auth.ts

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Belt-and-suspenders: always allow public auth paths through, even though
  // the matcher already excludes them.
  if (pathname === "/login" || pathname.startsWith("/api/auth")) {
    return NextResponse.next();
  }

  // Presence-only check. Missing access cookie => unauthenticated.
  if (!request.cookies.get(ACCESS_COOKIE)) {
    const loginUrl = new URL("/login", request.url);
    // Preserve the intended destination so login can return the user there.
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl, 307);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!login|api/auth|_next/static|_next/image|favicon.ico).*)"],
};
