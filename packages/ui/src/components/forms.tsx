import {
  Children,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";

import { Spinner } from "./status.js";

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
  autoComplete?: string;
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
  variant?: "primary" | "secondary" | "ghost" | "danger" | "outline" | "icon";
  size?: "sm" | "md" | "lg";
  fullWidth?: boolean;
  disabled?: boolean;
  loading?: boolean;
  type?: "button" | "submit" | "reset";
  href?: string;
  className?: string;
  "aria-label"?: string;
}

export interface CheckboxProps {
  id?: string;
  name?: string;
  label: ReactNode;
  value?: string;
  checked?: boolean;
  defaultChecked?: boolean;
  disabled?: boolean;
  required?: boolean;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  className?: string;
}

export type RadioProps = CheckboxProps;

export interface FileInputProps {
  id?: string;
  name?: string;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  required?: boolean;
  fileName?: string;
  prompt?: ReactNode;
  icon?: ReactNode;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  className?: string;
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

const buttonSizeClass: Record<NonNullable<ButtonProps["size"]>, string | undefined> = {
  sm: "lms-btn--sm",
  md: undefined,
  lg: "lms-btn--lg",
};

export function Button({
  children,
  variant = "primary",
  size = "md",
  fullWidth,
  disabled,
  loading,
  type = "button",
  href,
  className,
  "aria-label": ariaLabel,
}: ButtonProps): ReactElement {
  const buttonClassName = joinClassNames(
    "lms-btn",
    `lms-btn--${variant}`,
    buttonSizeClass[size],
    fullWidth ? "lms-btn--full" : undefined,
    className,
  );

  const content = loading ? (
    <>
      <span aria-hidden="true" className="lms-btn__spinner">
        <Spinner size="sm" />
      </span>
      {children}
    </>
  ) : (
    children
  );

  const isDisabled = disabled || loading;

  if (href) {
    return (
      <a
        aria-busy={loading ? "true" : undefined}
        aria-disabled={isDisabled ? "true" : undefined}
        aria-label={ariaLabel}
        className={buttonClassName}
        href={isDisabled ? undefined : href}
        role="button"
        tabIndex={isDisabled ? -1 : undefined}
      >
        {content}
      </a>
    );
  }

  return (
    <button
      aria-busy={loading ? "true" : undefined}
      aria-label={ariaLabel}
      className={buttonClassName}
      disabled={isDisabled}
      type={type}
    >
      {content}
    </button>
  );
}

export function Checkbox({
  id,
  name,
  label,
  value,
  checked,
  defaultChecked,
  disabled,
  required,
  className,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
}: CheckboxProps): ReactElement {
  return (
    <label className={joinClassNames("lms-checkbox", className)} htmlFor={id}>
      <input
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        checked={checked}
        className="lms-checkbox__input"
        defaultChecked={defaultChecked}
        disabled={disabled}
        id={id}
        name={name}
        required={required}
        type="checkbox"
        value={value}
      />
      <span className="lms-checkbox__label">{label}</span>
    </label>
  );
}

export function Radio({
  id,
  name,
  label,
  value,
  checked,
  defaultChecked,
  disabled,
  required,
  className,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
}: RadioProps): ReactElement {
  return (
    <label className={joinClassNames("lms-radio", className)} htmlFor={id}>
      <input
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        checked={checked}
        className="lms-radio__input"
        defaultChecked={defaultChecked}
        disabled={disabled}
        id={id}
        name={name}
        required={required}
        type="radio"
        value={value}
      />
      <span className="lms-radio__label">{label}</span>
    </label>
  );
}

export function FileInput({
  id,
  name,
  accept,
  multiple,
  disabled,
  required,
  fileName,
  prompt = "Choose a file or drag it here",
  icon,
  className,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
}: FileInputProps): ReactElement {
  return (
    <label className={joinClassNames("lms-file", className)} htmlFor={id}>
      <input
        accept={accept}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        className="lms-file__input"
        disabled={disabled}
        id={id}
        multiple={multiple}
        name={name}
        required={required}
        type="file"
      />
      <span className="lms-file__zone">
        {icon ? <span aria-hidden="true">{icon}</span> : null}
        <span>{prompt}</span>
      </span>
      {fileName ? <span className="lms-file__name">{fileName}</span> : null}
    </label>
  );
}

function joinClassNames(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(" ");
}
