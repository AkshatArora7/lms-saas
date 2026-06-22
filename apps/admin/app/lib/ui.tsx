import type { ReactElement } from "react";
import {
  AppShell as BaseAppShell,
  ThemeStyle as BaseThemeStyle,
  type AppShellProps,
} from "@lms/ui";
import type { Brand, Tone } from "@lms/ui";

/**
 * Admin-app UI wrappers: bind the shared @lms/ui shell + theme to the
 * data-dense `admin` tone in one place so individual screens don't repeat
 * `tone="admin"`. The tone selects neutrals/semantics/density only; tenant
 * accent/font/radius continue to flow through untouched (tenant-safe).
 */
const ADMIN_TONE: Tone = "admin";

export function AppShell(props: Omit<AppShellProps, "tone">): ReactElement {
  return <BaseAppShell tone={ADMIN_TONE} {...props} />;
}

export function ThemeStyle(props: { brand: Brand; scope?: string }): ReactElement {
  return <BaseThemeStyle tone={ADMIN_TONE} {...props} />;
}

/**
 * Shared admin-console polish stylesheet — ONE consistent set of class
 * definitions for every admin screen, replacing the divergent per-page CSS
 * blocks (e.g. `.admin-stat` was `clamp(...)` on the dashboard but a fixed
 * `28px` elsewhere). Each in-scope page renders this string in a scoped inline
 * `<style>` (the current RSC pattern) so the definitions are byte-identical
 * everywhere. Every value resolves from a `var(--lms-*)` token, so the system
 * stays fully white-label / tenant-safe. Any hover transition added here is
 * disabled under `prefers-reduced-motion` to preserve WCAG #87.
 */
export const adminPolishCss = `
.admin-page {
  min-width: 0;
}
.admin-section-title {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
}
.admin-detail {
  color: var(--lms-text-muted);
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
}
.admin-detail strong {
  color: var(--lms-text);
}
/* Stat / summary band — composed from Card + Stack + (optional) section icon.
   The value clamp ramp is UNIFIED across every screen so the dashboard and the
   domain pages read with the same rhythm. */
.admin-stat-card__icon {
  flex-shrink: 0;
  color: var(--lms-accent);
  display: inline-flex;
}
.admin-stat-card__icon svg {
  width: 20px;
  height: 20px;
}
.admin-stat-value {
  font-size: clamp(1.6rem, 5vw, 2rem);
  font-weight: 700;
  line-height: 1.1;
  margin: 0;
  overflow-wrap: anywhere;
}
.admin-stat-label {
  color: var(--lms-text-muted);
  font-size: var(--lms-font-size-sm);
  margin: 0;
  overflow-wrap: anywhere;
}
/* Interactive "Manage" nav cards (dashboard). */
.admin-nav-card {
  display: flex;
  align-items: flex-start;
  gap: var(--lms-space-3);
  height: 100%;
  text-decoration: none;
  color: inherit;
}
.admin-nav-card__icon {
  flex-shrink: 0;
  color: var(--lms-accent);
  display: inline-flex;
}
.admin-nav-card__icon svg {
  width: 24px;
  height: 24px;
}
.admin-nav-card__body {
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-1);
  min-width: 0;
}
.admin-nav-card__label {
  font-weight: 600;
  margin: 0;
  overflow-wrap: anywhere;
}
.admin-nav-card__desc {
  color: var(--lms-text-muted);
  font-size: var(--lms-font-size-sm);
  margin: 0;
  overflow-wrap: anywhere;
}
/* In-table drill-down links + secondary cell text. */
.admin-link-name {
  color: var(--lms-accent);
  font-weight: 600;
  margin: 0;
  text-decoration: none;
  overflow-wrap: anywhere;
}
.admin-link-name:hover {
  text-decoration: underline;
}
.admin-cell-meta {
  color: var(--lms-text-muted);
  font-size: var(--lms-font-size-sm);
  margin: 0;
  overflow-wrap: anywhere;
}
.admin-row-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--lms-space-2);
}
.admin-row-actions form {
  display: inline;
  margin: 0;
}
/* Wrapping badge clusters in dense cells (roles, org units). */
.admin-badge-cluster {
  display: flex;
  flex-wrap: wrap;
  gap: var(--lms-space-1);
}
`;

/**
 * Inline-SVG empty-state icons (replacing emoji). Outline style, 24x24 viewBox,
 * stroke=currentColor so they inherit `--lms-text-subtle` from the
 * `.lms-empty-state__icon` slot. aria-hidden — meaning is carried by the
 * EmptyState title/description. Path data from docs/design/ui-dual-tone-tokens.json.
 */
function EmptyIcon({ paths }: { paths: string[] }): ReactElement {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.6}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      {paths.map((d) => (
        <path d={d} key={d} />
      ))}
    </svg>
  );
}

export function UsersIcon(): ReactElement {
  return (
    <EmptyIcon
      paths={[
        "M15 19.5v-1.5a3.5 3.5 0 0 0-3.5-3.5H6.5A3.5 3.5 0 0 0 3 18v1.5",
        "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
        "M21 19.5V18a3.5 3.5 0 0 0-2.6-3.4",
        "M15.5 5.2a3 3 0 0 1 0 5.6",
      ]}
    />
  );
}

export function CoursesIcon(): ReactElement {
  return (
    <EmptyIcon
      paths={[
        "M12 6.5C10.5 5.3 8.5 5 6 5 5.4 5 5 5.4 5 6v11c0 .6.4 1 1 1 2.5 0 4.5.3 6 1.5",
        "M12 6.5C13.5 5.3 15.5 5 18 5c.6 0 1 .4 1 1v11c0 .6-.4 1-1 1-2.5 0-4.5.3-6 1.5",
        "M12 6.5v13",
      ]}
    />
  );
}

/**
 * Hierarchy / org-chart glyph: a single top node connected by lines down to two
 * child nodes — the org-units tree at a glance. Outline, aria-hidden.
 */
export function OrgUnitsIcon(): ReactElement {
  return (
    <EmptyIcon
      paths={[
        "M9.5 4.5h5a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1Z",
        "M4 15.5h4a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1Z",
        "M16 15.5h4a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1Z",
        "M12 8.5v3.5",
        "M6 15.5V12h12v3.5",
      ]}
    />
  );
}

/** Bar-chart glyph for district reports: a baseline axis with three bars. */
export function ReportsIcon(): ReactElement {
  return (
    <EmptyIcon
      paths={[
        "M4 4v15a1 1 0 0 0 1 1h15",
        "M8 16v-3",
        "M12 16v-6",
        "M16 16v-9",
      ]}
    />
  );
}

/** Palette/swatch glyph for white-label branding: a rounded panel with dots. */
export function BrandingIcon(): ReactElement {
  return (
    <EmptyIcon
      paths={[
        "M5 6.5A1.5 1.5 0 0 1 6.5 5h11A1.5 1.5 0 0 1 19 6.5v11A1.5 1.5 0 0 1 17.5 19h-11A1.5 1.5 0 0 1 5 17.5z",
        "M9 9.5h.01",
        "M9 14.5h6",
      ]}
    />
  );
}

/** Document/page glyph for rich content pages: a sheet with a folded corner and text lines. */
export function ContentIcon(): ReactElement {
  return (
    <EmptyIcon
      paths={[
        "M7 3.5h7l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19V5A1.5 1.5 0 0 1 7 3.5Z",
        "M14 3.5V8h4",
        "M9 12.5h6",
        "M9 15.5h6",
      ]}
    />
  );
}

/** Gear glyph for tenant settings: a centre ring with four simplified spokes. */
export function SettingsIcon(): ReactElement {
  return (
    <EmptyIcon
      paths={[
        "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z",
        "M12 3.5v2",
        "M12 18.5v2",
        "M3.5 12h2",
        "M18.5 12h2",
        "M6 6l1.4 1.4",
        "M16.6 16.6 18 18",
        "M18 6l-1.4 1.4",
        "M7.4 16.6 6 18",
      ]}
    />
  );
}
