import { describe, expect, it } from "vitest";

import {
  DEFAULT_LOCALE,
  LOCALES,
  SUPPORTED_LOCALES,
  getMessages,
  resolveLocale,
  t,
  type Messages,
} from "./core.js";

describe("t() — interpolation", () => {
  it("substitutes a single {var} token", () => {
    const messages = getMessages("en");
    expect(t(messages, "roster.title", { course: "Algebra I" })).toBe(
      "Algebra I — roster",
    );
  });

  it("leaves unknown placeholders untouched and never emits 'undefined'", () => {
    const messages = getMessages("en");
    // No vars supplied for a templated key: the literal token stays.
    expect(t(messages, "roster.title")).toBe("{course} — roster");
    // A var the template doesn't reference is simply ignored.
    expect(t(messages, "common.user", { unused: "x" })).toBe("User");
  });

  it("interpolates numbers as strings", () => {
    const messages = getMessages("en");
    // Use a key with a placeholder; supply a numeric var.
    expect(t(messages, "roster.title", { course: 7 })).toBe("7 — roster");
  });

  it("returns the localized value for the active locale", () => {
    const es = getMessages("es");
    expect(t(es, "common.user")).toBe("Usuario");
  });
});

describe("t() — fallback chain (locale → en → key)", () => {
  it("falls back to the en value when the active catalog is missing the key", () => {
    // Simulate a runtime-divergent catalog (untyped data) that drops a key.
    const partial = {
      common: { user: undefined },
    } as unknown as Messages;
    // es/partial value absent → en value "User".
    expect(t(partial, "common.user")).toBe("User");
  });

  it("falls back to the en value when the active value is an empty string", () => {
    const partial = {
      common: { user: "" },
    } as unknown as Messages;
    expect(t(partial, "common.user")).toBe("User");
  });

  it("returns the literal key when neither catalog nor en has the key", () => {
    const empty = {} as unknown as Messages;
    // Cast the key: this exercises the runtime guard for a key absent everywhere.
    const missingKey = "common.doesNotExist" as never;
    expect(t(empty, missingKey)).toBe("common.doesNotExist");
  });

  it("never throws and never returns undefined", () => {
    const empty = {} as unknown as Messages;
    const result = t(empty, "common.user");
    expect(result).toBeDefined();
    expect(typeof result).toBe("string");
  });
});

describe("resolveLocale() — normalisation", () => {
  it("maps a regional tag to its primary subtag (es-MX → es)", () => {
    expect(resolveLocale("es-MX")).toBe("es");
  });

  it("normalises case and underscores (EN, es_ES)", () => {
    expect(resolveLocale("EN")).toBe("en");
    expect(resolveLocale("es_ES")).toBe("es");
  });

  it("parses an Accept-Language fragment (first tag, ignores q-weights)", () => {
    expect(resolveLocale("es-419;q=0.9")).toBe("es");
  });

  it("maps unsupported locales to the default (fr → en)", () => {
    expect(resolveLocale("fr")).toBe("en");
    expect(resolveLocale("de-DE")).toBe("en");
  });

  it("maps null/undefined/empty to the default", () => {
    expect(resolveLocale(null)).toBe(DEFAULT_LOCALE);
    expect(resolveLocale(undefined)).toBe(DEFAULT_LOCALE);
    expect(resolveLocale("")).toBe(DEFAULT_LOCALE);
  });
});

describe("LOCALES — direction metadata", () => {
  it("declares every supported locale with code/label/nativeLabel/direction", () => {
    for (const code of SUPPORTED_LOCALES) {
      const meta = LOCALES[code];
      expect(meta.code).toBe(code);
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.nativeLabel.length).toBeGreaterThan(0);
      expect(["ltr", "rtl"]).toContain(meta.direction);
    }
  });

  it("en and es are both ltr (RTL wiring exists but no RTL locale yet)", () => {
    expect(LOCALES.en.direction).toBe("ltr");
    expect(LOCALES.es.direction).toBe("ltr");
  });

  it("es uses the Spanish endonym for the switcher", () => {
    expect(LOCALES.es.nativeLabel).toBe("Español");
  });
});

describe("getMessages()", () => {
  it("returns the requested catalog", () => {
    expect(getMessages("es").common.user).toBe("Usuario");
    expect(getMessages("en").common.user).toBe("User");
  });
});
