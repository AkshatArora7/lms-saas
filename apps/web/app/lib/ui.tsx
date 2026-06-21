import type { ReactElement } from "react";
import {
  AppShell as BaseAppShell,
  ThemeStyle as BaseThemeStyle,
  type AppShellProps,
} from "@lms/ui";
import type { Brand, Tone } from "@lms/ui";

/**
 * Web-app UI wrappers: bind the shared @lms/ui shell + theme to the
 * approachable `web` tone in one place so individual screens don't repeat
 * `tone="web"`. The tone selects neutrals/semantics/density only; tenant
 * accent/font/radius continue to flow through untouched (tenant-safe).
 */
const WEB_TONE: Tone = "web";

export function AppShell(props: Omit<AppShellProps, "tone">): ReactElement {
  return <BaseAppShell tone={WEB_TONE} {...props} />;
}

export function ThemeStyle(props: { brand: Brand; scope?: string }): ReactElement {
  return <BaseThemeStyle tone={WEB_TONE} {...props} />;
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

export function ContentIcon(): ReactElement {
  return (
    <EmptyIcon
      paths={[
        "M14 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V8z",
        "M14 3v4.5A1.5 1.5 0 0 0 15.5 9H19",
        "M9 13h6",
        "M9 16.5h6",
        "M9 9.5h2",
      ]}
    />
  );
}

export function SuccessIcon(): ReactElement {
  return (
    <EmptyIcon
      paths={["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M8.5 12.2l2.4 2.4 4.6-4.8"]}
    />
  );
}

export function GradesIcon(): ReactElement {
  return (
    <EmptyIcon
      paths={[
        "M4 4v15a1 1 0 0 0 1 1h15",
        "M8 17v-4",
        "M12.5 17v-7",
        "M17 17v-10",
      ]}
    />
  );
}

export function AssignmentsIcon(): ReactElement {
  return (
    <EmptyIcon
      paths={[
        "M8 5H6.5A1.5 1.5 0 0 0 5 6.5v12A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-12A1.5 1.5 0 0 0 17.5 5H16",
        "M9 4.5h6a1 1 0 0 1 1 1V7a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1Z",
        "M8.5 12h7",
        "M8.5 15.5h5",
      ]}
    />
  );
}

export function ScheduleIcon(): ReactElement {
  return (
    <EmptyIcon
      paths={[
        "M6.5 5h11A1.5 1.5 0 0 1 19 6.5v11A1.5 1.5 0 0 1 17.5 19h-11A1.5 1.5 0 0 1 5 17.5v-11A1.5 1.5 0 0 1 6.5 5Z",
        "M5 9h14",
        "M8.5 3.5v3",
        "M15.5 3.5v3",
        "M8.5 12.5h2",
        "M13.5 12.5h2",
        "M8.5 15.5h2",
      ]}
    />
  );
}

export function AnnouncementsIcon(): ReactElement {
  return (
    <EmptyIcon
      paths={[
        "M5 9.5 17 5.5v13L5 14.5z",
        "M5 9.5H3.8A1.3 1.3 0 0 0 2.5 10.8v2.4A1.3 1.3 0 0 0 3.8 14.5H5",
        "M17 7.5a3 3 0 0 1 0 9",
        "M7 14.5v3a1.2 1.2 0 0 0 1.2 1.2h1.4a1.2 1.2 0 0 0 1.1-1.6L9.5 14.5",
      ]}
    />
  );
}

export function GenericIcon(): ReactElement {
  return (
    <EmptyIcon
      paths={[
        "M4 13l2.2-7.3A1.5 1.5 0 0 1 7.6 4.6h8.8a1.5 1.5 0 0 1 1.4 1.1L20 13",
        "M4 13v4.5A1.5 1.5 0 0 0 5.5 19h13a1.5 1.5 0 0 0 1.5-1.5V13",
        "M4 13h4l1.5 2.2h5L16 13h4",
      ]}
    />
  );
}
