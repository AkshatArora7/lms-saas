import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Session } from "./auth";

/**
 * Unit tests for the learner-app `resolveRequestLocale()` precedence (#88):
 * tenant default (seam, undefined) → user preference → `lms_locale` cookie →
 * Accept-Language → 'en'. `getSession`, `cookies()` and `headers()` are mocked.
 */

let sessionValue: Session | null = null;
let cookieValue: string | undefined;
let acceptLanguage: string | null = null;

vi.mock("./auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./auth")>();
  return {
    ...actual,
    getSession: () => Promise.resolve(sessionValue),
  };
});

vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) =>
      name === "lms_locale" && cookieValue !== undefined
        ? { name, value: cookieValue }
        : undefined,
  }),
  headers: () => ({
    get: (name: string) =>
      name === "accept-language" ? acceptLanguage : null,
  }),
}));

import { resolveRequestLocale } from "./i18n";

function session(locale: string): Session {
  return {
    userId: "u",
    tenantId: "t",
    tier: "pro",
    roles: [],
    scopes: [],
    locale,
  };
}

beforeEach(() => {
  sessionValue = null;
  cookieValue = undefined;
  acceptLanguage = null;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("resolveRequestLocale — precedence", () => {
  it("user preference outranks cookie and Accept-Language", async () => {
    sessionValue = session("es");
    cookieValue = "en";
    acceptLanguage = "en-US,en;q=0.9";
    expect(await resolveRequestLocale()).toBe("es");
  });

  it("cookie wins when there is no session (e.g. on /login)", async () => {
    sessionValue = null;
    cookieValue = "es";
    acceptLanguage = "en-US";
    expect(await resolveRequestLocale()).toBe("es");
  });

  it("falls through to Accept-Language when no session and no cookie", async () => {
    acceptLanguage = "es-MX,es;q=0.9,en;q=0.8";
    expect(await resolveRequestLocale()).toBe("es");
  });

  it("parses the FIRST Accept-Language tag and normalises the region", async () => {
    acceptLanguage = "es-419, en;q=0.5";
    expect(await resolveRequestLocale()).toBe("es");
  });

  it("falls back to 'en' when nothing is set", async () => {
    expect(await resolveRequestLocale()).toBe("en");
  });

  it("ignores an unsupported user locale and falls through to the cookie", async () => {
    sessionValue = session("fr"); // unsupported → must not short-circuit
    cookieValue = "es";
    expect(await resolveRequestLocale()).toBe("es");
  });

  it("ignores an unsupported Accept-Language and ends at 'en'", async () => {
    acceptLanguage = "de-DE,de;q=0.9";
    expect(await resolveRequestLocale()).toBe("en");
  });

  it("honours an explicit 'en' user preference", async () => {
    sessionValue = session("en");
    cookieValue = "es"; // must NOT override an explicit user choice
    expect(await resolveRequestLocale()).toBe("en");
  });
});
