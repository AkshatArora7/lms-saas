import type { CSSProperties, ReactElement, ReactNode } from "react";

import { ThemeStyle, UIStyles } from "../styles.js";
import type { Brand } from "../theme.js";
import { Container } from "./layout.js";

export interface BrandMarkProps {
  brand: Brand;
  size?: number;
  className?: string;
}

export interface AppShellProps {
  brand: Brand;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function BrandMark({ brand, size = 36, className }: BrandMarkProps): ReactElement {
  const style: CSSProperties = { width: `${size}px`, height: `${size}px` };

  return (
    <span aria-label={brand.name} className={joinClassNames("lms-brandmark", className)} style={style}>
      {brand.logoUrl ? <img alt={brand.name} src={brand.logoUrl} /> : getInitials(brand.name)}
    </span>
  );
}

export function AppShell({ brand, actions, children, className }: AppShellProps): ReactElement {
  return (
    <>
      <UIStyles />
      <ThemeStyle brand={brand} />
      <div className={joinClassNames("lms-theme", "lms-shell", className)}>
        <header className="lms-topbar">
          <div className="lms-topbar__brand">
            <BrandMark brand={brand} />
            <span className="lms-topbar__name">{brand.name}</span>
          </div>
          {actions ? <div className="lms-topbar__actions">{actions}</div> : null}
        </header>
        <main className="lms-shell__main">
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
