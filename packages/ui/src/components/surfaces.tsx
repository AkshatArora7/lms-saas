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

function joinClassNames(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(" ");
}
