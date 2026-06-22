import { beforeEach, describe, expect, it, vi } from "vitest";

import { defaultBrand } from "@lms/ui";

import type { EffectiveBranding } from "./tenant-api";

/**
 * Unit tests for the learner web branding resolver (#12).
 *
 * Pure unit tests — no Next runtime, no Postgres, no network:
 *  - the tenant-api client (`getTenantBranding`) is mocked so we can drive the
 *    effective-record / null (offline) inputs directly;
 *  - React's `cache()` is stubbed to a plain memoizer so the per-request brand
 *    holder is deterministic in Node (one shared instance per test, reset each
 *    test) — this lets us assert that `loadBranding` populates the holder and
 *    the synchronous `getBranding`/`getBrand` accessors read it back.
 *
 * Covers:
 *  - `brandFromEffective` mapper: accent ← accentColor; accentColor null falls
 *    back to primaryColor; invalid (non-#rrggbb) colors fall back to the default
 *    accent; name ← displayName; logoUrl ← logoUrl; a fully-null record yields a
 *    sane default Brand;
 *  - `loadBranding` + holder: a real effective record => holder/getBranding hold
 *    the mapped brand; a null record (service unreachable) => holder/getBranding
 *    fall back to the clean DEFAULT_BRAND.
 */

// React `cache()` -> identity memoizer so the brand holder is a single stable
// instance per test (deterministic in Node, no React request scope needed).
vi.mock("react", () => ({
  cache: <T extends (...args: never[]) => unknown>(fn: T): T => {
    let called = false;
    let value: ReturnType<T>;
    return ((...args: Parameters<T>) => {
      if (!called) {
        value = fn(...args) as ReturnType<T>;
        called = true;
      }
      return value;
    }) as T;
  },
}));

const getTenantBranding = vi.fn();
vi.mock("./tenant-api", () => ({
  getTenantBranding: (...args: unknown[]) => getTenantBranding(...args),
}));

import {
  brandFromEffective,
  getBrand,
  getBranding,
  loadBranding,
} from "./branding";

// The clean default the resolver falls back to (mirrors branding.ts DEFAULT_BRAND).
const DEFAULT_NAME = "LMS Learner";
const DEFAULT_TAGLINE = "Sign in to your learning experience.";
const DEFAULT_ACCENT = "#2952cc";

function effective(over: Partial<EffectiveBranding> = {}): EffectiveBranding {
  return {
    tenantId: "t-1",
    displayName: null,
    logoUrl: null,
    faviconUrl: null,
    primaryColor: null,
    secondaryColor: null,
    accentColor: null,
    theme: "light",
    customDomain: null,
    customCss: null,
    supportEmail: null,
    inheritParent: true,
    updatedAt: null,
    ...over,
  };
}

describe("brandFromEffective() mapper", () => {
  it("maps accent <- accentColor, name <- displayName, logoUrl <- logoUrl", () => {
    const brand = brandFromEffective(
      effective({
        accentColor: "#abcdef",
        primaryColor: "#111111",
        displayName: "Springfield High",
        logoUrl: "https://cdn.example/logo.svg",
      }),
    );

    expect(brand.accent).toBe("#abcdef");
    expect(brand.name).toBe("Springfield High");
    expect(brand.logoUrl).toBe("https://cdn.example/logo.svg");
  });

  it("falls back to primaryColor for accent when accentColor is null", () => {
    const brand = brandFromEffective(
      effective({ accentColor: null, primaryColor: "#0a0b0c" }),
    );
    expect(brand.accent).toBe("#0a0b0c");
  });

  it("falls back to the default accent when both accent and primary colors are null", () => {
    const brand = brandFromEffective(
      effective({ accentColor: null, primaryColor: null }),
    );
    expect(brand.accent).toBe(DEFAULT_ACCENT);
  });

  it("rejects an invalid (non-#rrggbb) accentColor and falls through to primaryColor", () => {
    const brand = brandFromEffective(
      effective({ accentColor: "red", primaryColor: "#123456" }),
    );
    expect(brand.accent).toBe("#123456");
  });

  it("rejects invalid accent AND primary colors, falling back to the default accent", () => {
    const brand = brandFromEffective(
      effective({ accentColor: "rgb(1,2,3)", primaryColor: "#abc" }),
    );
    expect(brand.accent).toBe(DEFAULT_ACCENT);
  });

  it("uses the default name when displayName is null or blank", () => {
    expect(brandFromEffective(effective({ displayName: null })).name).toBe(
      DEFAULT_NAME,
    );
    expect(brandFromEffective(effective({ displayName: "   " })).name).toBe(
      DEFAULT_NAME,
    );
  });

  it("trims displayName whitespace", () => {
    expect(
      brandFromEffective(effective({ displayName: "  Acme Academy  " })).name,
    ).toBe("Acme Academy");
  });

  it("yields a sane default Brand for a fully-null record", () => {
    const brand = brandFromEffective(effective());
    expect(brand).toEqual({
      name: DEFAULT_NAME,
      tagline: DEFAULT_TAGLINE,
      accent: DEFAULT_ACCENT,
      logoUrl: null,
    });
    // The default accent matches the @lms/ui fallback baseline.
    expect(brand.accent).toBe(defaultBrand.accent);
  });
});

describe("loadBranding() + per-request holder", () => {
  beforeEach(() => {
    getTenantBranding.mockReset();
  });

  it("populates the holder with the mapped brand when an effective record is returned; getBranding reads it back", async () => {
    getTenantBranding.mockResolvedValue(
      effective({ accentColor: "#ff8800", displayName: "Riverdale" }),
    );

    const record = await loadBranding("tenant-a");

    // loadBranding returns the raw effective record (for favicon/customCss).
    expect(record?.accentColor).toBe("#ff8800");
    // The synchronous accessors now reflect the mapped brand.
    expect(getBranding().name).toBe("Riverdale");
    expect(getBranding().accent).toBe("#ff8800");
    expect(getBrand().name).toBe("Riverdale");
  });

  it("falls back to DEFAULT_BRAND when getTenantBranding returns null (service unreachable); getBranding returns the default", async () => {
    getTenantBranding.mockResolvedValue(null);

    const record = await loadBranding("tenant-offline");

    expect(record).toBeNull();
    expect(getBranding()).toEqual({
      name: DEFAULT_NAME,
      tagline: DEFAULT_TAGLINE,
      accent: DEFAULT_ACCENT,
    });
    expect(getBrand().name).toBe(DEFAULT_NAME);
  });
});
