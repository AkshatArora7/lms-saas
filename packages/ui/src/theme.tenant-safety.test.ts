import { describe, expect, it } from "vitest";

import { themeToCssVars, type Brand, type Tone } from "./theme.js";

/**
 * TENANT-SAFETY INVARIANT (AC1 / AC3)
 * -----------------------------------
 * The dual-tone mechanism selects ONLY neutrals + semantics + type scale +
 * shadows + density. It must NEVER override a tenant's brand fields
 * (accent / accentHover / accentContrast / accentSoft / font / radius*).
 *
 * `buildTheme` is internal, so we assert through the exported public surface
 * `themeToCssVars(brand, tone)`: the brand-driven CSS custom properties must be
 * byte-identical across the "admin" and "web" tones for the same brand, while a
 * tone-driven property (e.g. `--lms-bg`) must differ — proving the tone switch
 * is actually doing something and the equality above is meaningful, not a no-op.
 */

/** Parse the `themeToCssVars` blob into a `--lms-*` → value map. */
function cssVarMap(css: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const rawLine of css.split("\n")) {
    const line = rawLine.trim();
    const match = /^(--lms-[a-z0-9-]+):\s*(.+);$/.exec(line);
    const name = match?.[1];
    const value = match?.[2];
    if (name && value !== undefined) {
      map[name] = value;
    }
  }
  return map;
}

/** A representative tenant brand exercising accent + custom font + sharp radius. */
const brand: Brand = {
  name: "Northwind Academy",
  tagline: "Welcome back.",
  accent: "#0f7b6c",
  fontFamily: "Georgia, serif",
  radius: "sharp",
};

const BRAND_VARS = [
  "--lms-accent",
  "--lms-accent-hover",
  "--lms-accent-contrast",
  "--lms-accent-soft",
  "--lms-font-sans",
  "--lms-radius-sm",
  "--lms-radius-md",
  "--lms-radius-lg",
] as const;

describe("dual-tone tenant-safety invariant", () => {
  const admin = cssVarMap(themeToCssVars(brand, "admin"));
  const web = cssVarMap(themeToCssVars(brand, "web"));

  it("emits every brand-driven CSS var in both tones", () => {
    for (const name of BRAND_VARS) {
      expect(admin[name], `admin missing ${name}`).toBeDefined();
      expect(web[name], `web missing ${name}`).toBeDefined();
    }
  });

  it("never lets tone override a tenant brand var (identical across admin/web)", () => {
    for (const name of BRAND_VARS) {
      expect(web[name], `${name} must not change with tone`).toBe(admin[name]);
    }
  });

  it("still reflects the tenant's actual brand values (not a fallback)", () => {
    // Sanity: the brand-driven vars carry the tenant's input, so an accidental
    // hardcode-to-fallback can't masquerade as a passing equality check.
    expect(admin["--lms-accent"]).toBe("#0f7b6c");
    expect(admin["--lms-font-sans"]).toBe("Georgia, serif");
    expect(admin["--lms-radius-lg"]).toBe("10px"); // sharp.lg
  });

  it("DOES switch tone-driven vars across admin/web (mechanism is live)", () => {
    // If this were equal too, the test above would be meaningless.
    expect(web["--lms-bg"]).not.toBe(admin["--lms-bg"]);
    expect(web["--lms-font-size"]).toBeDefined();
    expect(admin["--lms-density"]).toBe("compact");
    expect(web["--lms-density"]).toBe("comfortable");
  });

  it("holds the invariant for every supported tone permutation", () => {
    const tones: Tone[] = ["admin", "web"];
    const reference = cssVarMap(themeToCssVars(brand, tones[0]));
    for (const tone of tones) {
      const vars = cssVarMap(themeToCssVars(brand, tone));
      for (const name of BRAND_VARS) {
        expect(vars[name], `${name} drifted for tone="${tone}"`).toBe(reference[name]);
      }
    }
  });
});
