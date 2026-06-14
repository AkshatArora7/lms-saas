export interface Brand {
  name: string;
  tagline: string;
  logoUrl?: string | null;
  accent: string;
  accentContrast?: string;
  fontFamily?: string;
  radius?: "sharp" | "soft" | "round";
}

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
    warning: string;
    focus: string;
    fontSans: string;
    fontSize: string;
    line: string;
    radiusSm: string;
    radiusMd: string;
    radiusLg: string;
    radiusPill: string;
    shadowSm: string;
    shadowMd: string;
    space1: string;
    space2: string;
    space3: string;
    space4: string;
    space5: string;
    space6: string;
    space7: string;
    space8: string;
  };
}

const defaultFontFamily = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const defaultAccentContrast = "#ffffff";
const defaultRadius: NonNullable<Brand["radius"]> = "soft";
const fallbackAccent = "#2952cc";

const radiusScale: Record<NonNullable<Brand["radius"]>, { sm: string; md: string; lg: string }> = {
  sharp: { sm: "4px", md: "6px", lg: "8px" },
  soft: { sm: "8px", md: "12px", lg: "16px" },
  round: { sm: "12px", md: "16px", lg: "24px" },
};

export const defaultBrand: Brand = {
  name: "LMS",
  tagline: "Your learning platform.",
  accent: fallbackAccent,
};

export const brandRegistry: Record<string, Brand> = {
  "11111111-1111-1111-1111-111111111111": {
    name: "Northwind Academy",
    tagline: "Welcome back to Northwind Academy.",
    accent: "#0f7b6c",
  },
};

export function resolveBrand(tenantId?: string): Brand {
  return (tenantId ? brandRegistry[tenantId] : undefined) ?? defaultBrand;
}

export function themeToCssVars(brand: Brand): string {
  const theme = buildTheme(brand);

  return [
    `  --lms-bg: ${theme.values.bg};`,
    `  --lms-surface: ${theme.values.surface};`,
    `  --lms-surface-2: ${theme.values.surface2};`,
    `  --lms-border: ${theme.values.border};`,
    `  --lms-text: ${theme.values.text};`,
    `  --lms-text-muted: ${theme.values.textMuted};`,
    `  --lms-accent: ${theme.values.accent};`,
    `  --lms-accent-hover: ${theme.values.accentHover};`,
    `  --lms-accent-contrast: ${theme.values.accentContrast};`,
    `  --lms-accent-soft: ${theme.values.accentSoft};`,
    `  --lms-danger: ${theme.values.danger};`,
    `  --lms-danger-contrast: ${theme.values.dangerContrast};`,
    `  --lms-success: ${theme.values.success};`,
    `  --lms-warning: ${theme.values.warning};`,
    `  --lms-focus: ${theme.values.focus};`,
    `  --lms-font-sans: ${theme.values.fontSans};`,
    `  --lms-font-size: ${theme.values.fontSize};`,
    `  --lms-line: ${theme.values.line};`,
    `  --lms-radius-sm: ${theme.values.radiusSm};`,
    `  --lms-radius-md: ${theme.values.radiusMd};`,
    `  --lms-radius-lg: ${theme.values.radiusLg};`,
    `  --lms-radius-pill: ${theme.values.radiusPill};`,
    `  --lms-shadow-sm: ${theme.values.shadowSm};`,
    `  --lms-shadow-md: ${theme.values.shadowMd};`,
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

function buildTheme(inputBrand: Brand): Theme {
  const accent = normalizeHex(inputBrand.accent);
  const radius = radiusScale[inputBrand.radius ?? defaultRadius];
  const brand: Brand = {
    ...inputBrand,
    accent,
    accentContrast: inputBrand.accentContrast ?? defaultAccentContrast,
    fontFamily: inputBrand.fontFamily ?? defaultFontFamily,
    radius: inputBrand.radius ?? defaultRadius,
  };

  return {
    brand,
    values: {
      bg: "#f5f6f8",
      surface: "#fff",
      surface2: "#f1f3f5",
      border: "#e6e8ec",
      text: "#1c2430",
      textMuted: "#5b606b",
      accent: brand.accent,
      accentHover: darken(brand.accent, 8),
      accentContrast: brand.accentContrast ?? defaultAccentContrast,
      accentSoft: softRgba(brand.accent, 0.12),
      danger: "#b3261e",
      dangerContrast: "#fff",
      success: "#0f7b6c",
      warning: "#9a6700",
      focus: "#2952cc",
      fontSans: brand.fontFamily ?? defaultFontFamily,
      fontSize: "15px",
      line: "1.5",
      radiusSm: radius.sm,
      radiusMd: radius.md,
      radiusLg: radius.lg,
      radiusPill: "999px",
      shadowSm: "0 1px 2px rgba(16,24,40,.06)",
      shadowMd: "0 4px 12px rgba(16,24,40,.12)",
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
