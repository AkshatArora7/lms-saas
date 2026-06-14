import type { CSSProperties, ReactElement, ReactNode } from "react";

export type SpaceScale = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface ContainerProps {
  children: ReactNode;
  className?: string;
}

export interface StackProps {
  children: ReactNode;
  gap?: SpaceScale;
  className?: string;
}

export interface InlineProps {
  children: ReactNode;
  gap?: SpaceScale;
  align?: string;
  justify?: string;
  className?: string;
}

export interface GridProps {
  children: ReactNode;
  min?: string;
  gap?: SpaceScale;
  className?: string;
}

export function Container({ children, className }: ContainerProps): ReactElement {
  return <div className={joinClassNames("lms-container", className)}>{children}</div>;
}

export function Stack({ children, gap = 4, className }: StackProps): ReactElement {
  const style: CSSProperties = { gap: `var(--lms-space-${gap})` };

  return (
    <div className={joinClassNames("lms-stack", className)} style={style}>
      {children}
    </div>
  );
}

export function Inline({
  children,
  gap = 4,
  align,
  justify,
  className,
}: InlineProps): ReactElement {
  const style: CSSProperties = {
    gap: `var(--lms-space-${gap})`,
    alignItems: align ?? "center",
    justifyContent: justify ?? "flex-start",
  };

  return (
    <div className={joinClassNames("lms-inline", className)} style={style}>
      {children}
    </div>
  );
}

export function Grid({ children, min = "240px", gap = 4, className }: GridProps): ReactElement {
  const style: CSSProperties = {
    gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${min}), 1fr))`,
    gap: `var(--lms-space-${gap})`,
  };

  return (
    <div className={joinClassNames("lms-grid", className)} style={style}>
      {children}
    </div>
  );
}

function joinClassNames(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(" ");
}
