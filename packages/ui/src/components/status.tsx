import type { CSSProperties, ReactElement, ReactNode } from "react";

export type BadgeTone = "neutral" | "accent" | "success" | "danger" | "warning";
export type AlertTone = "info" | "success" | "warning" | "danger";

export interface BadgeProps {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}

export type ChipProps = BadgeProps;

export interface AvatarProps {
  name: string;
  src?: string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export interface ProgressBarProps {
  value: number;
  max?: number;
  label: string;
  className?: string;
}

export interface AlertProps {
  tone?: AlertTone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}

export interface SpinnerProps {
  label?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export interface SkeletonProps {
  width?: string;
  height?: string;
  radius?: string;
  className?: string;
}

export function Badge({ children, tone = "neutral", className }: BadgeProps): ReactElement {
  return (
    <span className={joinClassNames("lms-badge", `lms-badge--${tone}`, className)}>
      {children}
    </span>
  );
}

export function Chip(props: ChipProps): ReactElement {
  return <Badge {...props} />;
}

export function Avatar({ name, src, size = "md", className }: AvatarProps): ReactElement {
  return (
    <span
      aria-label={name}
      className={joinClassNames("lms-avatar", `lms-avatar--${size}`, className)}
    >
      {src ? <img alt={name} src={src} /> : getInitials(name, 2)}
    </span>
  );
}

export function ProgressBar({ value, max = 100, label, className }: ProgressBarProps): ReactElement {
  const safeMax = max > 0 ? max : 100;
  const clampedValue = Math.min(Math.max(value, 0), safeMax);
  const width = `${(clampedValue / safeMax) * 100}%`;
  const fillStyle: CSSProperties = { width };

  return (
    <div
      aria-label={label}
      aria-valuemax={safeMax}
      aria-valuemin={0}
      aria-valuenow={clampedValue}
      className={joinClassNames("lms-progress", className)}
      role="progressbar"
    >
      <div className="lms-progress__fill" style={fillStyle} />
    </div>
  );
}

export function Alert({ tone = "info", icon, children, className }: AlertProps): ReactElement {
  const role = tone === "danger" || tone === "warning" ? "alert" : "status";

  return (
    <div className={joinClassNames("lms-alert", `lms-alert--${tone}`, className)} role={role}>
      {icon ? <div className="lms-alert__icon">{icon}</div> : null}
      <div className="lms-alert__body">{children}</div>
    </div>
  );
}

export function Spinner({ label = "Loading", size = "md", className }: SpinnerProps): ReactElement {
  return (
    <span
      aria-label={label}
      className={joinClassNames("lms-spinner", `lms-spinner--${size}`, className)}
      role="status"
    />
  );
}

export function Skeleton({
  width = "100%",
  height = "1rem",
  radius,
  className,
}: SkeletonProps): ReactElement {
  const style: CSSProperties = {
    width,
    height,
    borderRadius: radius,
  };

  return <span className={joinClassNames("lms-skeleton", className)} style={style} />;
}

function getInitials(value: string, maxLetters: number): string {
  const initials = value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return initials.slice(0, maxLetters) || value.slice(0, 1).toUpperCase();
}

function joinClassNames(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(" ");
}
