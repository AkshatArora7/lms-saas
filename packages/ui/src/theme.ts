export interface Brand {
  name: string;
  tagline: string;
  logoUrl?: string | null;
  accent: string;
  accentContrast?: string;
  fontFamily?: string;
  radius?: "sharp" | "soft" | "round";
}

/**
 * Dual-tone selector. `admin` renders a data-dense, professional B2B console;
 * `web` renders an approachable, roomy learner/teacher experience. Tone only
 * ever selects NEUTRALS + SEMANTICS + TYPE SCALE + SHADOWS + DENSITY — it NEVER
 * touches tenant-owned brand fields (accent / accentHover / accentContrast /
 * accentSoft / fontSans / radius*), which keeps every tenant's brand intact in
 * both tones. Default is `web` for backward compatibility.
 */
export type Tone = "admin" | "web";
export const defaultTone: Tone = "web";

export interface Theme {
  brand: Brand;
  values: {
    bg: string;
    surface: string;
    surface2: string;
    border: string;
    text: string;
    textMuted: string;
    accent: string;
    accentHover: string;
    accentContrast: string;
    accentSoft: string;
    danger: string;
    dangerContrast: string;
    success: string;
    successContrast: string;
    warning: string;
    warningContrast: string;
    focus: string;
    fontSans: string;
    fontSize: string;
    fontSizeSm: string;
    line: string;
    radiusSm: string;
    radiusMd: string;
    radiusLg: string;
    radiusPill: string;
    shadowSm: string;
    shadowMd: string;
    shadowLg: string;
    space0: string;
    space1: string;
    space2: string;
    space3: string;
    space4: string;
    space5: string;
    space6: string;
    space7: string;
    space8: string;
    // Density (tone-driven)
    density: string;
    cardPad: string;
    rowPadY: string;
    controlH: string;
    // Extended neutrals (tone-driven)
    surface2Hover: string;
    borderStrong: string;
    textSubtle: string;
    overlayScrim: string;
    // Soft semantic pairs (tone-driven)
    successSoftBg: string;
    successSoftText: string;
    warningSoftBg: string;
    warningSoftText: string;
    dangerSoftBg: string;
    dangerSoftText: string;
    info: string;
    infoContrast: string;
    infoSoftBg: string;
    infoSoftText: string;
  };
}

/**
 * Tone-driven token set. CRITICAL TENANT-SAFETY INVARIANT: this table contains
 * ONLY neutrals, semantics, type scale, shadows and density. It deliberately
 * contains NO brand fields (accent/fontSans/radius) — those are computed from
 * `brand.*` on the shared code path in buildTheme() regardless of tone.
 * Values are sourced from docs/design/ui-dual-tone-tokens.json.
 */
interface ToneTokens {
  bg: string;
  surface: string;
  surface2: string;
  surface2Hover: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  textSubtle: string;
  danger: string;
  dangerContrast: string;
  dangerSoftBg: string;
  dangerSoftText: string;
  success: string;
  successContrast: string;
  successSoftBg: string;
  successSoftText: string;
  warning: string;
  warningContrast: string;
  warningSoftBg: string;
  warningSoftText: string;
  info: string;
  infoContrast: string;
  infoSoftBg: string;
  infoSoftText: string;
  focus: string;
  overlayScrim: string;
  fontSize: string;
  fontSizeSm: string;
  line: string;
  shadowSm: string;
  shadowMd: string;
  shadowLg: string;
  density: string;
  cardPad: string;
  rowPadY: string;
  controlH: string;
}

const toneTokens: Readonly<Record<Tone, Readonly<ToneTokens>>> = Object.freeze({
  admin: Object.freeze({
    bg: "#f1f4f8",
    surface: "#ffffff",
    surface2: "#e9edf3",
    surface2Hover: "#e1e7ef",
    border: "#d4dbe5",
    borderStrong: "#b7c1cf",
    text: "#0f1b2d",
    textMuted: "#516074",
    textSubtle: "#73808f",
    danger: "#c2261b",
    dangerContrast: "#ffffff",
    dangerSoftBg: "#fbe3e1",
    dangerSoftText: "#9a1c13",
    success: "#0b7a52",
    successContrast: "#ffffff",
    successSoftBg: "#e2f3ec",
    successSoftText: "#0a5f40",
    warning: "#8a5a00",
    warningContrast: "#ffffff",
    warningSoftBg: "#f6ecd7",
    warningSoftText: "#6e4700",
    info: "#0e5fae",
    infoContrast: "#ffffff",
    infoSoftBg: "#e1ecfa",
    infoSoftText: "#0b4c8c",
    focus: "#1d5fd6",
    overlayScrim: "rgba(15, 27, 45, 0.45)",
    fontSize: "16px",
    fontSizeSm: "13px",
    line: "1.5",
    shadowSm: "0 1px 2px rgba(15, 27, 45, 0.08)",
    shadowMd: "0 2px 6px rgba(15, 27, 45, 0.10), 0 1px 2px rgba(15, 27, 45, 0.06)",
    shadowLg: "0 8px 20px rgba(15, 27, 45, 0.14)",
    density: "compact",
    cardPad: "16px",
    rowPadY: "8px",
    controlH: "40px",
  }),
  web: Object.freeze({
    bg: "#fafaf8",
    surface: "#ffffff",
    surface2: "#f2f1ec",
    surface2Hover: "#eae9e2",
    border: "#e4e2d9",
    borderStrong: "#c8c5b8",
    text: "#1b2430",
    textMuted: "#46505c",
    textSubtle: "#6b7480",
    danger: "#c2261b",
    dangerContrast: "#ffffff",
    dangerSoftBg: "#fce6e3",
    dangerSoftText: "#9a1c13",
    success: "#0b7a52",
    successContrast: "#ffffff",
    successSoftBg: "#e4f4ed",
    successSoftText: "#0a5f40",
    warning: "#8a5a00",
    warningContrast: "#ffffff",
    warningSoftBg: "#f8efd9",
    warningSoftText: "#6e4700",
    info: "#1e4e8c",
    infoContrast: "#ffffff",
    infoSoftBg: "#e6edf6",
    infoSoftText: "#173c6c",
    focus: "#1e4e8c",
    overlayScrim: "rgba(27, 36, 48, 0.40)",
    fontSize: "16px",
    fontSizeSm: "14px",
    line: "1.6",
    shadowSm: "0 1px 3px rgba(27, 36, 48, 0.06)",
    shadowMd: "0 6px 16px rgba(27, 36, 48, 0.10)",
    shadowLg: "0 16px 40px rgba(27, 36, 48, 0.14)",
    density: "comfortable",
    cardPad: "24px",
    rowPadY: "12px",
    controlH: "44px",
  }),
});

const defaultFontFamily = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const defaultAccentContrast = "#ffffff";
const defaultRadius: NonNullable<Brand["radius"]> = "soft";
const fallbackAccent = "#2952cc";

const radiusScale: Record<NonNullable<Brand["radius"]>, { sm: string; md: string; lg: string }> = {
  sharp: { sm: "4px", md: "6px", lg: "10px" },
  soft: { sm: "8px", md: "12px", lg: "16px" },
  round: { sm: "12px", md: "18px", lg: "26px" },
};

export const defaultBrand: Brand = {
  name: "LMS",
  tagline: "Your learning platform.",
  accent: fallbackAccent,
};

/**
 * Build a self-contained SVG logo mark as a data URI so demo brands can
 * exercise `logoUrl` without any external network dependency.
 */
function svgLogo(accent: string, letter: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" rx="14" fill="${accent}"/>` +
    `<text x="32" y="43" font-family="Georgia, serif" font-size="34" font-weight="700" ` +
    `text-anchor="middle" fill="#ffffff">${letter}</text>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export const brandRegistry: Record<string, Brand> = {
  // Demo tenant seeded by the identity dev store — fully realised so the live
  // app proves accent + typography + radius + logo all flow end-to-end.
  "11111111-1111-1111-1111-111111111111": {
    name: "Northwind Academy",
    tagline: "Welcome back to Northwind Academy.",
    accent: "#0f7b6c",
    fontFamily: 'Georgia, "Times New Roman", serif',
    radius: "soft",
    logoUrl: svgLogo("#0f7b6c", "N"),
  },
  "22222222-2222-2222-2222-222222222222": {
    name: "Crimson Charter School",
    tagline: "Bold learning, every day.",
    accent: "#b3261e",
    fontFamily: '"Trebuchet MS", Verdana, sans-serif',
    radius: "sharp",
    logoUrl: svgLogo("#b3261e", "C"),
  },
  "33333333-3333-3333-3333-333333333333": {
    name: "Lakeside Online",
    tagline: "Learn from anywhere.",
    accent: "#2952cc",
    fontFamily: '"Segoe UI", system-ui, sans-serif',
    radius: "round",
    logoUrl: svgLogo("#2952cc", "L"),
  },
  "44444444-4444-4444-4444-444444444444": {
    name: "Sunrise Montessori",
    tagline: "Where curiosity grows.",
    accent: "#9a6700",
    fontFamily: 'Palatino, "Palatino Linotype", serif',
    radius: "round",
    logoUrl: svgLogo("#9a6700", "S"),
  },
};

/** Ordered list of demo school brands for white-label showcase surfaces. */
export const demoSchoolBrands: Array<{ tenantId: string; brand: Brand }> = Object.entries(
  brandRegistry,
).map(([tenantId, brand]) => ({ tenantId, brand }));

export function resolveBrand(tenantId?: string): Brand {
  return (tenantId ? brandRegistry[tenantId] : undefined) ?? defaultBrand;
}

export function themeToCssVars(brand: Brand, tone: Tone = "web"): string {
  const theme = buildTheme(brand, tone);

  return [
    `  --lms-bg: ${theme.values.bg};`,
    `  --lms-surface: ${theme.values.surface};`,
    `  --lms-surface-2: ${theme.values.surface2};`,
    `  --lms-surface-2-hover: ${theme.values.surface2Hover};`,
    `  --lms-border: ${theme.values.border};`,
    `  --lms-border-strong: ${theme.values.borderStrong};`,
    `  --lms-text: ${theme.values.text};`,
    `  --lms-text-muted: ${theme.values.textMuted};`,
    `  --lms-text-subtle: ${theme.values.textSubtle};`,
    `  --lms-accent: ${theme.values.accent};`,
    `  --lms-accent-hover: ${theme.values.accentHover};`,
    `  --lms-accent-contrast: ${theme.values.accentContrast};`,
    `  --lms-accent-soft: ${theme.values.accentSoft};`,
    `  --lms-danger: ${theme.values.danger};`,
    `  --lms-danger-contrast: ${theme.values.dangerContrast};`,
    `  --lms-danger-soft-bg: ${theme.values.dangerSoftBg};`,
    `  --lms-danger-soft-text: ${theme.values.dangerSoftText};`,
    `  --lms-success: ${theme.values.success};`,
    `  --lms-success-contrast: ${theme.values.successContrast};`,
    `  --lms-success-soft-bg: ${theme.values.successSoftBg};`,
    `  --lms-success-soft-text: ${theme.values.successSoftText};`,
    `  --lms-warning: ${theme.values.warning};`,
    `  --lms-warning-contrast: ${theme.values.warningContrast};`,
    `  --lms-warning-soft-bg: ${theme.values.warningSoftBg};`,
    `  --lms-warning-soft-text: ${theme.values.warningSoftText};`,
    `  --lms-info: ${theme.values.info};`,
    `  --lms-info-contrast: ${theme.values.infoContrast};`,
    `  --lms-info-soft-bg: ${theme.values.infoSoftBg};`,
    `  --lms-info-soft-text: ${theme.values.infoSoftText};`,
    `  --lms-focus: ${theme.values.focus};`,
    `  --lms-overlay-scrim: ${theme.values.overlayScrim};`,
    `  --lms-font-sans: ${theme.values.fontSans};`,
    `  --lms-font-size: ${theme.values.fontSize};`,
    `  --lms-font-size-sm: ${theme.values.fontSizeSm};`,
    `  --lms-line: ${theme.values.line};`,
    `  --lms-radius-sm: ${theme.values.radiusSm};`,
    `  --lms-radius-md: ${theme.values.radiusMd};`,
    `  --lms-radius-lg: ${theme.values.radiusLg};`,
    `  --lms-radius-pill: ${theme.values.radiusPill};`,
    `  --lms-shadow-sm: ${theme.values.shadowSm};`,
    `  --lms-shadow-md: ${theme.values.shadowMd};`,
    `  --lms-shadow-lg: ${theme.values.shadowLg};`,
    `  --lms-density: ${theme.values.density};`,
    `  --lms-card-pad: ${theme.values.cardPad};`,
    `  --lms-row-pad-y: ${theme.values.rowPadY};`,
    `  --lms-control-h: ${theme.values.controlH};`,
    `  --lms-space-0: ${theme.values.space0};`,
    `  --lms-space-1: ${theme.values.space1};`,
    `  --lms-space-2: ${theme.values.space2};`,
    `  --lms-space-3: ${theme.values.space3};`,
    `  --lms-space-4: ${theme.values.space4};`,
    `  --lms-space-5: ${theme.values.space5};`,
    `  --lms-space-6: ${theme.values.space6};`,
    `  --lms-space-7: ${theme.values.space7};`,
    `  --lms-space-8: ${theme.values.space8};`,
  ].join("\n");
}

function buildTheme(inputBrand: Brand, tone: Tone = "web"): Theme {
  // Brand-driven fields — computed from `brand.*` on this shared path in BOTH
  // tone branches. Tone NEVER influences any of these (tenant-safety invariant).
  const accent = normalizeHex(inputBrand.accent);
  const radius = radiusScale[inputBrand.radius ?? defaultRadius];
  const brand: Brand = {
    ...inputBrand,
    accent,
    accentContrast: inputBrand.accentContrast ?? defaultAccentContrast,
    fontFamily: inputBrand.fontFamily ?? defaultFontFamily,
    radius: inputBrand.radius ?? defaultRadius,
  };

  // Tone-driven fields — neutrals, semantics, type scale, shadows, density only.
  const t = toneTokens[tone];

  return {
    brand,
    values: {
      // --- Tone-driven (T) ---
      bg: t.bg,
      surface: t.surface,
      surface2: t.surface2,
      surface2Hover: t.surface2Hover,
      border: t.border,
      borderStrong: t.borderStrong,
      text: t.text,
      textMuted: t.textMuted,
      textSubtle: t.textSubtle,
      danger: t.danger,
      dangerContrast: t.dangerContrast,
      dangerSoftBg: t.dangerSoftBg,
      dangerSoftText: t.dangerSoftText,
      success: t.success,
      successContrast: t.successContrast,
      successSoftBg: t.successSoftBg,
      successSoftText: t.successSoftText,
      warning: t.warning,
      warningContrast: t.warningContrast,
      warningSoftBg: t.warningSoftBg,
      warningSoftText: t.warningSoftText,
      info: t.info,
      infoContrast: t.infoContrast,
      infoSoftBg: t.infoSoftBg,
      infoSoftText: t.infoSoftText,
      focus: t.focus,
      overlayScrim: t.overlayScrim,
      fontSize: t.fontSize,
      fontSizeSm: t.fontSizeSm,
      line: t.line,
      shadowSm: t.shadowSm,
      shadowMd: t.shadowMd,
      shadowLg: t.shadowLg,
      density: t.density,
      cardPad: t.cardPad,
      rowPadY: t.rowPadY,
      controlH: t.controlH,
      // --- Brand-driven (B) — NEVER tone ---
      accent: brand.accent,
      accentHover: darken(brand.accent, 8),
      accentContrast: brand.accentContrast ?? defaultAccentContrast,
      accentSoft: softRgba(brand.accent, 0.12),
      fontSans: brand.fontFamily ?? defaultFontFamily,
      radiusSm: radius.sm,
      radiusMd: radius.md,
      radiusLg: radius.lg,
      // --- Constant (C) ---
      radiusPill: "999px",
      space0: "2px",
      space1: "4px",
      space2: "8px",
      space3: "12px",
      space4: "16px",
      space5: "24px",
      space6: "32px",
      space7: "48px",
      space8: "64px",
    },
  };
}

export function darken(hex: string, percentage = 8): string {
  const normalized = normalizeHex(hex).slice(1);
  const channels = normalized.match(/.{2}/g);

  if (!channels || channels.length !== 3) {
    return fallbackAccent;
  }

  const next = channels
    .map((channel) => {
      const value = Number.parseInt(channel, 16);
      const darkened = Math.max(0, Math.round(value * (1 - percentage / 100)));
      return darkened.toString(16).padStart(2, "0");
    })
    .join("");

  return `#${next}`;
}

export function softRgba(hex: string, alpha = 0.12): string {
  const normalized = normalizeHex(hex).slice(1);
  const channels = normalized.match(/.{2}/g);

  if (!channels || channels.length !== 3) {
    return `rgba(41, 82, 204, ${alpha})`;
  }

  const [red, green, blue] = channels.map((channel) => Number.parseInt(channel, 16));
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function normalizeHex(hex: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? hex.toLowerCase() : fallbackAccent;
}
