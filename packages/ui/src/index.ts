// Theme
export type { Brand, Theme, Tone } from "./theme.js";
export { defaultBrand, defaultTone, brandRegistry, demoSchoolBrands, resolveBrand, themeToCssVars, darken, softRgba } from "./theme.js";

// Styles
export { UIStyles, ThemeStyle, componentCss } from "./styles.js";

// Layout
export type { ContainerProps, StackProps, InlineProps, GridProps } from "./components/layout.js";
export { Container, Stack, Inline, Grid } from "./components/layout.js";

// Surfaces
export type { CardProps, PageHeaderProps, EmptyStateProps, DividerProps } from "./components/surfaces.js";
export { Card, PageHeader, EmptyState, Divider } from "./components/surfaces.js";

// Forms
export type { FieldProps, InputProps, TextareaProps, SelectProps, ButtonProps } from "./components/forms.js";
export { Field, Input, Textarea, Select, Button } from "./components/forms.js";

// Status
export type { BadgeProps, ChipProps, AvatarProps, ProgressBarProps, AlertProps, SpinnerProps, SkeletonProps, BadgeTone, AlertTone } from "./components/status.js";
export { Badge, Chip, Avatar, ProgressBar, Alert, Spinner, Skeleton } from "./components/status.js";

// Shell
export type { BrandMarkProps, AppShellProps } from "./components/shell.js";
export { BrandMark, AppShell } from "./components/shell.js";
