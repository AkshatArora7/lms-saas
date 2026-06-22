import { createElement, type ReactElement } from "react";

import type { Brand, Tone } from "./theme.js";
import { themeToCssVars } from "./theme.js";

const defaultThemeScope = ":root, .lms-theme";

export const componentCss = `
.lms-theme *, .lms-theme *::before, .lms-theme *::after { box-sizing: border-box; }
.lms-theme { background: var(--lms-bg); color: var(--lms-text); font-family: var(--lms-font-sans); font-size: var(--lms-font-size); line-height: var(--lms-line); }
.lms-theme img { display: block; max-width: 100%; }
.lms-theme button, .lms-theme input, .lms-theme select, .lms-theme textarea { font: inherit; }
.lms-container { width: 100%; max-width: 1100px; margin-inline: auto; padding-inline: clamp(16px,4vw,32px); }
.lms-stack { display: flex; flex-direction: column; min-width: 0; }
.lms-inline { display: flex; flex-wrap: wrap; min-width: 0; }
.lms-grid { display: grid; width: 100%; }
.lms-grid > * { min-width: 0; }
.lms-card { background: var(--lms-surface); border: 1px solid var(--lms-border); border-radius: var(--lms-radius-md); box-shadow: var(--lms-shadow-sm); padding: var(--lms-card-pad); min-width: 0; }
.lms-card--interactive { cursor: pointer; text-decoration: none; color: inherit; transition: transform 180ms cubic-bezier(0.2,0,0,1), box-shadow 180ms cubic-bezier(0.2,0,0,1), border-color 180ms cubic-bezier(0.2,0,0,1); }
.lms-card--interactive:hover { transform: translateY(-2px); box-shadow: var(--lms-shadow-md); border-color: var(--lms-border-strong); }
.lms-theme[data-tone="admin"] .lms-card--interactive:hover { transform: translateY(-1px); }
.lms-card--interactive:focus-visible { outline: 3px solid var(--lms-focus); outline-offset: 2px; }
.lms-page-header { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: var(--lms-space-3) var(--lms-space-4); margin-bottom: var(--lms-space-5); }
.lms-page-header__meta, .lms-page-header__actions, .lms-topbar__brand, .lms-alert__body { min-width: 0; }
.lms-page-header__title { margin: 0; font-size: clamp(22px,5vw,32px); line-height: 1.2; overflow-wrap: anywhere; }
.lms-page-header__subtitle { margin: var(--lms-space-1) 0 0; color: var(--lms-text-muted); overflow-wrap: anywhere; }
.lms-page-header__actions { display: flex; flex-wrap: wrap; gap: var(--lms-space-2); align-items: center; }
.lms-empty-state { text-align: center; padding: var(--lms-space-6) var(--lms-space-5); border: 1px dashed var(--lms-border-strong); border-radius: var(--lms-radius-md); background: var(--lms-surface); }
.lms-empty-state__icon { display: inline-flex; align-items: center; justify-content: center; color: var(--lms-text-subtle); margin-bottom: var(--lms-space-3); }
.lms-empty-state__icon svg { width: 44px; height: 44px; }
.lms-empty-state__title { margin: 0 0 var(--lms-space-2); }
.lms-empty-state__desc { color: var(--lms-text-muted); margin: 0 0 var(--lms-space-3); overflow-wrap: anywhere; }
.lms-empty-state__actions { display: inline-flex; flex-wrap: wrap; justify-content: center; gap: var(--lms-space-2); }
.lms-divider { border: none; border-top: 1px solid var(--lms-border); margin: var(--lms-space-4) 0; }
.lms-field { display: flex; flex-direction: column; gap: var(--lms-space-1); }
.lms-field__label { font-weight: 600; font-size: 14px; }
.lms-field__help { font-size: 13px; color: var(--lms-text-muted); }
.lms-field__error { font-size: 13px; color: var(--lms-danger); }
.lms-input, .lms-textarea, .lms-select { width: 100%; min-height: var(--lms-control-h); padding: var(--lms-space-2) var(--lms-space-3); border: 1px solid var(--lms-border-strong); border-radius: var(--lms-radius-sm); background: var(--lms-surface); color: var(--lms-text); font-family: inherit; font-size: var(--lms-font-size); transition: border-color 150ms cubic-bezier(0.2,0,0,1); }
.lms-input::placeholder, .lms-textarea::placeholder { color: var(--lms-text-subtle); }
.lms-input:hover, .lms-textarea:hover, .lms-select:hover { border-color: var(--lms-text-subtle); }
.lms-input:focus-visible, .lms-textarea:focus-visible, .lms-select:focus-visible { outline: 3px solid var(--lms-focus); outline-offset: 2px; border-color: var(--lms-focus); }
.lms-input[aria-invalid="true"], .lms-textarea[aria-invalid="true"], .lms-select[aria-invalid="true"] { border-color: var(--lms-danger); }
.lms-input:disabled, .lms-textarea:disabled, .lms-select:disabled { opacity: .6; cursor: not-allowed; background: var(--lms-surface-2); }
.lms-textarea { resize: vertical; }
.lms-select { appearance: none; }
.lms-btn { display: inline-flex; align-items: center; justify-content: center; gap: var(--lms-space-2); min-height: var(--lms-control-h); padding: var(--lms-space-2) var(--lms-space-4); border-radius: var(--lms-radius-sm); font-weight: 600; font-size: var(--lms-font-size); cursor: pointer; text-decoration: none; border: 1px solid transparent; transition: background 150ms cubic-bezier(0.2,0,0,1), color 150ms cubic-bezier(0.2,0,0,1), border-color 150ms cubic-bezier(0.2,0,0,1); white-space: nowrap; }
.lms-btn:focus-visible { outline: 3px solid var(--lms-focus); outline-offset: 2px; }
.lms-btn--primary { background: var(--lms-accent); color: var(--lms-accent-contrast); border-color: var(--lms-accent); }
.lms-btn--primary:hover { background: var(--lms-accent-hover); border-color: var(--lms-accent-hover); }
.lms-btn--secondary { background: var(--lms-surface); color: var(--lms-text); border-color: var(--lms-border-strong); }
.lms-btn--secondary:hover { background: var(--lms-surface-2); }
.lms-btn--ghost { background: transparent; color: var(--lms-text); border-color: transparent; }
.lms-btn--ghost:hover { background: var(--lms-surface-2); }
.lms-btn--danger { background: var(--lms-danger); color: var(--lms-danger-contrast); border-color: var(--lms-danger); }
.lms-btn--danger:hover { filter: brightness(0.92); }
.lms-btn--sm { min-height: 36px; padding: var(--lms-space-1) var(--lms-space-3); font-size: var(--lms-font-size-sm); }
.lms-btn--full { width: 100%; }
.lms-btn:disabled, .lms-btn[aria-disabled="true"] { opacity: .5; cursor: not-allowed; pointer-events: none; }
.lms-table { width: 100%; border-collapse: collapse; font-size: var(--lms-font-size); }
.lms-table th { text-align: left; background: var(--lms-surface-2); color: var(--lms-text-muted); font-size: var(--lms-font-size-sm); font-weight: 600; padding: var(--lms-row-pad-y) var(--lms-space-3); border-bottom: 1px solid var(--lms-border-strong); white-space: nowrap; }
.lms-table td { padding: var(--lms-row-pad-y) var(--lms-space-3); border-bottom: 1px solid var(--lms-border); color: var(--lms-text); vertical-align: middle; }
.lms-table tbody tr { transition: background 150ms cubic-bezier(0.2,0,0,1); }
.lms-table tbody tr:hover { background: var(--lms-surface-2-hover); }
.lms-table tbody tr:focus-within { outline: 2px solid var(--lms-focus); outline-offset: -2px; }
.lms-table tbody tr:last-child td { border-bottom: 0; }
.lms-table-wrap { width: 100%; overflow-x: auto; border: 1px solid var(--lms-border); border-radius: var(--lms-radius-md); background: var(--lms-surface); }
.lms-badge { display: inline-flex; align-items: center; padding: .2em .6em; border-radius: var(--lms-radius-pill); font-size: 12px; font-weight: 600; line-height: 1.4; }
.lms-badge--neutral { background: var(--lms-surface-2); color: var(--lms-text-muted); }
.lms-badge--accent { background: var(--lms-accent-soft); color: var(--lms-accent); }
.lms-badge--success { background: var(--lms-success-soft-bg); color: var(--lms-success-soft-text); }
.lms-badge--danger { background: var(--lms-danger-soft-bg); color: var(--lms-danger-soft-text); }
.lms-badge--warning { background: var(--lms-warning-soft-bg); color: var(--lms-warning-soft-text); }
.lms-badge--info { background: var(--lms-info-soft-bg); color: var(--lms-info-soft-text); }
.lms-avatar { display: inline-flex; align-items: center; justify-content: center; border-radius: var(--lms-radius-pill); font-weight: 700; overflow: hidden; flex-shrink: 0; background: var(--lms-accent-soft); color: var(--lms-accent); }
.lms-avatar--sm { width: 32px; height: 32px; font-size: 12px; }
.lms-avatar--md { width: 40px; height: 40px; font-size: 14px; }
.lms-avatar--lg { width: 56px; height: 56px; font-size: 20px; }
.lms-avatar img { width: 100%; height: 100%; object-fit: cover; }
.lms-progress { height: 8px; border-radius: var(--lms-radius-pill); background: var(--lms-surface-2); overflow: hidden; width: 100%; }
.lms-progress__fill { height: 100%; background: var(--lms-accent); border-radius: var(--lms-radius-pill); transition: width .3s ease; }
.lms-alert { display: flex; gap: var(--lms-space-3); padding: var(--lms-space-3) var(--lms-space-4); border-radius: var(--lms-radius-md); border: 1px solid transparent; font-size: var(--lms-font-size-sm); }
.lms-alert--info { background: var(--lms-info-soft-bg); border-color: var(--lms-border-strong); color: var(--lms-info-soft-text); }
.lms-alert--success { background: var(--lms-success-soft-bg); border-color: var(--lms-border-strong); color: var(--lms-success-soft-text); }
.lms-alert--warning { background: var(--lms-warning-soft-bg); border-color: var(--lms-border-strong); color: var(--lms-warning-soft-text); }
.lms-alert--danger { background: var(--lms-danger-soft-bg); border-color: var(--lms-border-strong); color: var(--lms-danger-soft-text); }
.lms-alert__icon { flex-shrink: 0; display: inline-flex; }
.lms-alert__icon svg { width: 20px; height: 20px; }
.lms-alert__body { overflow-wrap: anywhere; }
.lms-spinner { display: inline-block; border-radius: 50%; border: 2px solid var(--lms-border); border-top-color: var(--lms-accent); animation: lms-spin .7s linear infinite; }
.lms-spinner--sm { width: 16px; height: 16px; }
.lms-spinner--md { width: 24px; height: 24px; }
.lms-spinner--lg { width: 40px; height: 40px; border-width: 3px; }
.lms-skeleton { display: block; background: linear-gradient(90deg, var(--lms-surface-2) 25%, var(--lms-border) 50%, var(--lms-surface-2) 75%); background-size: 200% 100%; animation: lms-shimmer 1.5s infinite; border-radius: var(--lms-radius-sm); }
.lms-brandmark { display: inline-flex; align-items: center; justify-content: center; font-weight: 800; border-radius: var(--lms-radius-sm); background: var(--lms-accent-soft); color: var(--lms-accent); overflow: hidden; flex-shrink: 0; text-transform: uppercase; }
.lms-brandmark img { width: 100%; height: 100%; object-fit: contain; }
.lms-skip-link { position: absolute; left: var(--lms-space-2); top: -200%; z-index: 400; padding: var(--lms-space-2) var(--lms-space-4); background: var(--lms-surface); color: var(--lms-accent); border: 1px solid var(--lms-border-strong); border-radius: var(--lms-radius-sm); font-weight: 600; text-decoration: none; box-shadow: var(--lms-shadow-md); max-width: calc(100% - var(--lms-space-4)); }
.lms-skip-link:focus-visible, .lms-skip-link:focus { top: var(--lms-space-2); outline: 3px solid var(--lms-focus); outline-offset: 2px; }
.lms-shell { min-height: 100vh; display: flex; flex-direction: column; background: var(--lms-bg); position: relative; }
.lms-topbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--lms-space-3) var(--lms-space-4); padding: var(--lms-space-3) clamp(16px,4vw,32px); border-bottom: 1px solid var(--lms-border); background: var(--lms-surface); box-shadow: var(--lms-shadow-sm); min-height: 60px; }
.lms-theme[data-tone="admin"] .lms-topbar { min-height: 56px; }
.lms-topbar__brand { display: flex; align-items: center; gap: var(--lms-space-2); min-width: 0; text-decoration: none; color: inherit; }
.lms-topbar__name { font-weight: 700; font-size: 13px; letter-spacing: .04em; text-transform: uppercase; color: var(--lms-accent); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 40vw; }
.lms-topbar__actions { display: flex; align-items: center; gap: var(--lms-space-2); flex-wrap: wrap; }
.lms-nav__link { display: inline-flex; align-items: center; color: var(--lms-text-muted); text-decoration: none; padding: var(--lms-space-2) var(--lms-space-3); border-radius: var(--lms-radius-sm); transition: background 150ms cubic-bezier(0.2,0,0,1), color 150ms cubic-bezier(0.2,0,0,1); }
.lms-nav__link:hover { color: var(--lms-text); background: var(--lms-surface-2); }
.lms-nav__link[aria-current="page"] { color: var(--lms-accent); background: var(--lms-accent-soft); }
.lms-nav__link:focus-visible { outline: 3px solid var(--lms-focus); outline-offset: 2px; }
.lms-shell__main { flex: 1; padding-block: var(--lms-space-5); }
.lms-theme[data-tone="web"] .lms-shell__main { padding-block: var(--lms-space-6); }
@keyframes lms-spin { to { transform: rotate(360deg); } }
@keyframes lms-shimmer { to { background-position: -200% 0; } }
@media (prefers-reduced-motion: reduce) {
  .lms-card--interactive { transition: none; }
  .lms-card--interactive:hover { transform: none; }
  .lms-theme[data-tone="admin"] .lms-card--interactive:hover { transform: none; }
  .lms-btn { transition: none; }
  .lms-input, .lms-textarea, .lms-select { transition: none; }
  .lms-table tbody tr { transition: none; }
  .lms-nav__link { transition: none; }
  .lms-progress__fill { transition: none; }
  .lms-spinner { animation: none; border-top-color: var(--lms-accent); }
  .lms-skeleton { animation: none; background: var(--lms-surface-2); }
}
`;

export function UIStyles(): ReactElement {
  return createElement("style", {
    dangerouslySetInnerHTML: {
      __html: componentCss,
    },
  });
}

export function ThemeStyle({
  brand,
  tone = "web",
  scope,
}: {
  brand: Brand;
  tone?: Tone;
  scope?: string;
}): ReactElement {
  const selector = scope ?? defaultThemeScope;

  return createElement("style", {
    dangerouslySetInnerHTML: {
      __html: `${selector} {
${themeToCssVars(brand, tone)}
}`,
    },
  });
}
