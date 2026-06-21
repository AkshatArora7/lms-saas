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
