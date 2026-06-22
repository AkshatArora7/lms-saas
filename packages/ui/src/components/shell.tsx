import type { CSSProperties, ReactElement, ReactNode } from "react";

import { ThemeStyle, UIStyles } from "../styles.js";
import type { Brand, Tone } from "../theme.js";
import { Container } from "./layout.js";

export interface BrandMarkProps {
  brand: Brand;
  size?: number;
  className?: string;
  /**
   * When the brand name is also rendered as adjacent visible text (topbar,
   * login), the mark is purely decorative. Setting `decorative` hides it from
   * assistive tech (`aria-hidden` on the wrapper + `alt=""` on the logo image)
   * so the accessible name is not duplicated (WCAG 1.1.1 / 2.4.6).
   */
  decorative?: boolean;
}

export interface AppShellProps {
  brand: Brand;
  tone?: Tone;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function BrandMark({
  brand,
  size = 36,
  className,
  decorative = false,
}: BrandMarkProps): ReactElement {
  const style: CSSProperties = { width: `${size}px`, height: `${size}px` };

  return (
    <span
      aria-hidden={decorative ? "true" : undefined}
      aria-label={decorative ? undefined : brand.name}
      className={joinClassNames("lms-brandmark", className)}
      style={style}
    >
      {brand.logoUrl ? (
        <img alt={decorative ? "" : brand.name} src={brand.logoUrl} />
      ) : (
        getInitials(brand.name)
      )}
    </span>
  );
}

export function AppShell({
  brand,
  tone = "web",
  actions,
  children,
  className,
}: AppShellProps): ReactElement {
  return (
    <>
      <UIStyles />
      <ThemeStyle brand={brand} tone={tone} />
      <div className={joinClassNames("lms-theme", "lms-shell", className)} data-tone={tone}>
        <a className="lms-skip-link" href="#main">
          Skip to main content
        </a>
        <header className="lms-topbar">
          <div className="lms-topbar__brand">
            <BrandMark brand={brand} decorative />
            <span className="lms-topbar__name">{brand.name}</span>
          </div>
          {actions ? <div className="lms-topbar__actions">{actions}</div> : null}
        </header>
        <main className="lms-shell__main" id="main">
          <Container>{children}</Container>
        </main>
      </div>
    </>
  );
}

function getInitials(value: string): string {
  const initials = value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return initials.slice(0, 2) || value.slice(0, 1).toUpperCase();
}

function joinClassNames(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(" ");
}
