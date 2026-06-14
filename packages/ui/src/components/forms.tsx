import {
  Children,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";

interface FieldControlProps {
  id?: string;
  required?: boolean;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "false" | "true";
}

export interface FieldProps {
  label: string;
  htmlFor: string;
  help?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

export interface InputProps {
  id?: string;
  name?: string;
  type?: string;
  value?: string;
  defaultValue?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  className?: string;
}

export interface TextareaProps {
  id?: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  rows?: number;
  cols?: number;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  className?: string;
}

export interface SelectProps {
  id?: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  disabled?: boolean;
  required?: boolean;
  children: ReactNode;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  className?: string;
}

export interface ButtonProps {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  fullWidth?: boolean;
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
  href?: string;
  className?: string;
  "aria-label"?: string;
}

export function Field({
  label,
  htmlFor,
  help,
  error,
  required,
  children,
  className,
}: FieldProps): ReactElement {
  const child = Children.only(children);

  if (!isValidElement<FieldControlProps>(child)) {
    throw new Error("Field expects a single form control child.");
  }

  const helpId = help ? `${htmlFor}-help` : undefined;
  const errorId = error ? `${htmlFor}-error` : undefined;
  const describedBy = [child.props["aria-describedby"], helpId, errorId]
    .filter((value): value is string => Boolean(value))
    .join(" ");

  const control = cloneElement(child, {
    id: htmlFor,
    required: required ?? child.props.required,
    "aria-describedby": describedBy || undefined,
    "aria-invalid": error ? true : child.props["aria-invalid"],
  });

  return (
    <div className={joinClassNames("lms-field", className)}>
      <label className="lms-field__label" htmlFor={htmlFor}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      {control}
      {help ? (
        <div className="lms-field__help" id={helpId}>
          {help}
        </div>
      ) : null}
      {error ? (
        <div className="lms-field__error" id={errorId}>
          {error}
        </div>
      ) : null}
    </div>
  );
}

export function Input({ className, ...props }: InputProps): ReactElement {
  return <input className={joinClassNames("lms-input", className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaProps): ReactElement {
  return <textarea className={joinClassNames("lms-textarea", className)} {...props} />;
}

export function Select({ children, className, ...props }: SelectProps): ReactElement {
  return (
    <select className={joinClassNames("lms-select", className)} {...props}>
      {children}
    </select>
  );
}

export function Button({
  children,
  variant = "primary",
  size = "md",
  fullWidth,
  disabled,
  type = "button",
  href,
  className,
  "aria-label": ariaLabel,
}: ButtonProps): ReactElement {
  const buttonClassName = joinClassNames(
    "lms-btn",
    `lms-btn--${variant}`,
    size === "sm" ? "lms-btn--sm" : undefined,
    fullWidth ? "lms-btn--full" : undefined,
    className,
  );

  if (href) {
    return (
      <a
        aria-disabled={disabled ? "true" : undefined}
        aria-label={ariaLabel}
        className={buttonClassName}
        href={disabled ? undefined : href}
        role="button"
        tabIndex={disabled ? -1 : undefined}
      >
        {children}
      </a>
    );
  }

  return (
    <button
      aria-label={ariaLabel}
      className={buttonClassName}
      disabled={disabled}
      type={type}
    >
      {children}
    </button>
  );
}

function joinClassNames(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(" ");
}
