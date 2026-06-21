import type {
  AnchorHTMLAttributes,
  HTMLAttributes,
  ReactElement,
  ReactNode,
} from "react";

interface CardSharedProps {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
}

type CardDivProps = CardSharedProps &
  Omit<HTMLAttributes<HTMLDivElement>, keyof CardSharedProps | "className"> & {
    as?: "div";
    href?: never;
  };

type CardArticleProps = CardSharedProps &
  Omit<HTMLAttributes<HTMLElement>, keyof CardSharedProps | "className"> & {
    as: "article";
    href?: never;
  };

type CardAnchorProps = CardSharedProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof CardSharedProps | "className"> & {
    as: "a";
    href: string;
  };

export type CardProps = CardDivProps | CardArticleProps | CardAnchorProps;

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  className?: string;
}

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}

export interface DividerProps {
  className?: string;
}

export type StatCardTone = "neutral" | "accent" | "success" | "danger";

export interface StatCardProps {
  value: ReactNode;
  label: string;
  icon?: ReactNode;
  delta?: ReactNode;
  tone?: StatCardTone;
  className?: string;
}

export interface CourseCardProps {
  title: string;
  href?: string;
  meta?: ReactNode;
  badges?: ReactNode;
  roleChip?: ReactNode;
  children?: ReactNode;
  className?: string;
}

export interface BreadcrumbItem {
  label: string;
  href?: string;
  /** Hide this crumb on phones to collapse to parent / current. */
  collapsible?: boolean;
}

export interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  label?: string;
  className?: string;
}

export function Card(props: CardProps): ReactElement {
  const className = joinClassNames(
    "lms-card",
    props.interactive ? "lms-card--interactive" : undefined,
    props.className,
  );

  if (props.as === "a") {
    const { as: _as, children, className: _className, interactive: _interactive, ...anchorProps } =
      props;
    void [_as, _className, _interactive];

    return (
      <a {...anchorProps} className={className}>
        {children}
      </a>
    );
  }

  if (props.as === "article") {
    const {
      as: _as,
      children,
      className: _className,
      interactive: _interactive,
      ...articleProps
    } = props;
    void [_as, _className, _interactive];

    return (
      <article {...articleProps} className={className}>
        {children}
      </article>
    );
  }

  const { as: _as, children, className: _className, interactive: _interactive, ...divProps } = props;
  void [_as, _className, _interactive];

  return (
    <div {...divProps} className={className}>
      {children}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, className }: PageHeaderProps): ReactElement {
  return (
    <div className={joinClassNames("lms-page-header", className)}>
      <div className="lms-page-header__meta">
        <h1 className="lms-page-header__title">{title}</h1>
        {subtitle ? <p className="lms-page-header__subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="lms-page-header__actions">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  actions,
  className,
}: EmptyStateProps): ReactElement {
  return (
    <div className={joinClassNames("lms-empty-state", className)} role="status">
      {icon ? <div className="lms-empty-state__icon">{icon}</div> : null}
      <h2 className="lms-empty-state__title">{title}</h2>
      {description ? <p className="lms-empty-state__desc">{description}</p> : null}
      {actions ? <div className="lms-empty-state__actions">{actions}</div> : null}
    </div>
  );
}

export function Divider({ className }: DividerProps): ReactElement {
  return <hr className={joinClassNames("lms-divider", className)} />;
}

export function StatCard({
  value,
  label,
  icon,
  delta,
  tone = "neutral",
  className,
}: StatCardProps): ReactElement {
  return (
    <div
      className={joinClassNames(
        "lms-stat",
        tone !== "neutral" ? `lms-stat--${tone}` : undefined,
        className,
      )}
    >
      {icon ? (
        <span aria-hidden="true" className="lms-stat__icon">
          {icon}
        </span>
      ) : null}
      <span className="lms-stat__value">{value}</span>
      <span className="lms-stat__label">{label}</span>
      {delta ? <span className="lms-stat__delta">{delta}</span> : null}
    </div>
  );
}

export function CourseCard({
  title,
  href,
  meta,
  badges,
  roleChip,
  children,
  className,
}: CourseCardProps): ReactElement {
  const cardClassName = joinClassNames(
    "lms-card",
    "lms-coursecard",
    href ? "lms-card--interactive" : undefined,
    className,
  );

  const body = (
    <>
      {badges || roleChip ? (
        <div className="lms-coursecard__badges">
          {badges}
          {roleChip}
        </div>
      ) : null}
      <h3 className="lms-coursecard__title">{title}</h3>
      {meta ? <div className="lms-coursecard__meta">{meta}</div> : null}
      {children}
    </>
  );

  if (href) {
    return (
      <a aria-label={`Open ${title}`} className={cardClassName} href={href}>
        {body}
      </a>
    );
  }

  return (
    <article className={cardClassName}>{body}</article>
  );
}

export function Breadcrumbs({ items, label = "Breadcrumb", className }: BreadcrumbsProps): ReactElement {
  const lastIndex = items.length - 1;

  return (
    <nav aria-label={label} className={joinClassNames("lms-breadcrumbs", className)}>
      <ol className="lms-breadcrumbs__list">
        {items.map((item, index) => {
          const isCurrent = index === lastIndex;
          // Keep the immediate parent and the current page visible on phones;
          // earlier ancestors collapse to satisfy the design's parent/current rule.
          const collapse = item.collapsible ?? (index < lastIndex - 1);

          return (
            <li
              className={joinClassNames(
                "lms-breadcrumbs__item",
                collapse && !isCurrent ? "lms-breadcrumbs__item--collapsible" : undefined,
              )}
              key={`${item.label}-${index}`}
            >
              {isCurrent || !item.href ? (
                <span
                  aria-current={isCurrent ? "page" : undefined}
                  className="lms-breadcrumbs__current"
                >
                  {item.label}
                </span>
              ) : (
                <a className="lms-breadcrumbs__link" href={item.href}>
                  {item.label}
                </a>
              )}
              {isCurrent ? null : (
                <span aria-hidden="true" className="lms-breadcrumbs__sep">
                  /
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function joinClassNames(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(" ");
}
