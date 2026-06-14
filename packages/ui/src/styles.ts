import { createElement, type ReactElement } from "react";

import type { Brand } from "./theme.js";
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
.lms-card { background: var(--lms-surface); border: 1px solid var(--lms-border); border-radius: var(--lms-radius-md); box-shadow: var(--lms-shadow-sm); padding: var(--lms-space-4); min-width: 0; }
.lms-card--interactive { cursor: pointer; text-decoration: none; color: inherit; transition: transform .15s ease, box-shadow .15s ease; }
.lms-card--interactive:hover { transform: translateY(-2px); box-shadow: var(--lms-shadow-md); }
.lms-card--interactive:focus-visible { outline: 3px solid var(--lms-focus); outline-offset: 2px; }
.lms-page-header { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: var(--lms-space-3) var(--lms-space-4); margin-bottom: var(--lms-space-5); }
.lms-page-header__meta, .lms-page-header__actions, .lms-topbar__brand, .lms-alert__body { min-width: 0; }
.lms-page-header__title { margin: 0; font-size: clamp(22px,5vw,32px); line-height: 1.2; overflow-wrap: anywhere; }
.lms-page-header__subtitle { margin: var(--lms-space-1) 0 0; color: var(--lms-text-muted); overflow-wrap: anywhere; }
.lms-page-header__actions { display: flex; flex-wrap: wrap; gap: var(--lms-space-2); align-items: center; }
.lms-empty-state { text-align: center; padding: var(--lms-space-6) var(--lms-space-5); border: 1px dashed var(--lms-border); border-radius: var(--lms-radius-md); background: var(--lms-surface); }
.lms-empty-state__icon { font-size: 2rem; margin-bottom: var(--lms-space-2); }
.lms-empty-state__title { margin: 0 0 var(--lms-space-2); }
.lms-empty-state__desc { color: var(--lms-text-muted); margin: 0 0 var(--lms-space-3); overflow-wrap: anywhere; }
.lms-empty-state__actions { display: inline-flex; flex-wrap: wrap; justify-content: center; gap: var(--lms-space-2); }
.lms-divider { border: none; border-top: 1px solid var(--lms-border); margin: var(--lms-space-4) 0; }
.lms-field { display: flex; flex-direction: column; gap: var(--lms-space-1); }
.lms-field__label { font-weight: 600; font-size: 14px; }
.lms-field__help { font-size: 13px; color: var(--lms-text-muted); }
.lms-field__error { font-size: 13px; color: var(--lms-danger); }
.lms-input, .lms-textarea, .lms-select { width: 100%; min-height: 44px; padding: var(--lms-space-2) var(--lms-space-3); border: 1px solid var(--lms-border); border-radius: var(--lms-radius-sm); background: var(--lms-surface); color: var(--lms-text); font-family: inherit; font-size: var(--lms-font-size); }
.lms-input:focus-visible, .lms-textarea:focus-visible, .lms-select:focus-visible { outline: 3px solid var(--lms-focus); outline-offset: 2px; }
.lms-input[aria-invalid="true"], .lms-textarea[aria-invalid="true"], .lms-select[aria-invalid="true"] { border-color: var(--lms-danger); }
.lms-input:disabled, .lms-textarea:disabled, .lms-select:disabled { opacity: .6; cursor: not-allowed; }
.lms-textarea { resize: vertical; }
.lms-select { appearance: none; }
.lms-btn { display: inline-flex; align-items: center; justify-content: center; gap: var(--lms-space-2); min-height: 44px; padding: var(--lms-space-2) var(--lms-space-4); border-radius: var(--lms-radius-sm); font-weight: 600; font-size: var(--lms-font-size); cursor: pointer; text-decoration: none; border: 1px solid transparent; transition: background .12s, color .12s, border-color .12s; white-space: nowrap; }
.lms-btn:focus-visible { outline: 3px solid var(--lms-focus); outline-offset: 2px; }
.lms-btn--primary { background: var(--lms-accent); color: var(--lms-accent-contrast); border-color: var(--lms-accent); }
.lms-btn--primary:hover { background: var(--lms-accent-hover); border-color: var(--lms-accent-hover); }
.lms-btn--secondary { background: var(--lms-surface); color: var(--lms-text); border-color: var(--lms-border); }
.lms-btn--secondary:hover { background: var(--lms-surface-2); }
.lms-btn--ghost { background: transparent; color: var(--lms-text); border-color: transparent; }
.lms-btn--ghost:hover { background: var(--lms-surface-2); }
.lms-btn--danger { background: var(--lms-danger); color: var(--lms-danger-contrast); border-color: var(--lms-danger); }
.lms-btn--sm { min-height: 36px; padding: var(--lms-space-1) var(--lms-space-3); font-size: 13px; }
.lms-btn--full { width: 100%; }
.lms-btn:disabled, .lms-btn[aria-disabled="true"] { opacity: .5; cursor: not-allowed; pointer-events: none; }
.lms-badge { display: inline-flex; align-items: center; padding: .2em .6em; border-radius: var(--lms-radius-pill); font-size: 12px; font-weight: 600; line-height: 1.4; }
.lms-badge--neutral { background: var(--lms-surface-2); color: var(--lms-text-muted); }
.lms-badge--accent { background: var(--lms-accent-soft); color: var(--lms-accent); }
.lms-badge--success { background: rgba(15,123,108,.12); color: var(--lms-success); }
.lms-badge--danger { background: rgba(179,38,30,.12); color: var(--lms-danger); }
.lms-badge--warning { background: rgba(154,103,0,.12); color: var(--lms-warning); }
.lms-avatar { display: inline-flex; align-items: center; justify-content: center; border-radius: var(--lms-radius-pill); font-weight: 700; overflow: hidden; flex-shrink: 0; background: var(--lms-accent-soft); color: var(--lms-accent); }
.lms-avatar--sm { width: 32px; height: 32px; font-size: 12px; }
.lms-avatar--md { width: 40px; height: 40px; font-size: 14px; }
.lms-avatar--lg { width: 56px; height: 56px; font-size: 20px; }
.lms-avatar img { width: 100%; height: 100%; object-fit: cover; }
.lms-progress { height: 8px; border-radius: var(--lms-radius-pill); background: var(--lms-surface-2); overflow: hidden; width: 100%; }
.lms-progress__fill { height: 100%; background: var(--lms-accent); border-radius: var(--lms-radius-pill); transition: width .3s ease; }
.lms-alert { display: flex; gap: var(--lms-space-3); padding: var(--lms-space-3) var(--lms-space-4); border-radius: var(--lms-radius-md); border: 1px solid transparent; font-size: 14px; }
.lms-alert--info { background: rgba(41,82,204,.08); border-color: rgba(41,82,204,.2); color: var(--lms-text); }
.lms-alert--success { background: rgba(15,123,108,.08); border-color: rgba(15,123,108,.2); color: var(--lms-success); }
.lms-alert--warning { background: rgba(154,103,0,.08); border-color: rgba(154,103,0,.2); color: var(--lms-warning); }
.lms-alert--danger { background: rgba(179,38,30,.08); border-color: rgba(179,38,30,.2); color: var(--lms-danger); }
.lms-alert__icon { flex-shrink: 0; }
.lms-alert__body { overflow-wrap: anywhere; }
.lms-spinner { display: inline-block; border-radius: 50%; border: 2px solid var(--lms-border); border-top-color: var(--lms-accent); animation: lms-spin .7s linear infinite; }
.lms-spinner--sm { width: 16px; height: 16px; }
.lms-spinner--md { width: 24px; height: 24px; }
.lms-spinner--lg { width: 40px; height: 40px; border-width: 3px; }
.lms-skeleton { display: block; background: linear-gradient(90deg, var(--lms-surface-2) 25%, var(--lms-border) 50%, var(--lms-surface-2) 75%); background-size: 200% 100%; animation: lms-shimmer 1.5s infinite; border-radius: var(--lms-radius-sm); }
.lms-brandmark { display: inline-flex; align-items: center; justify-content: center; font-weight: 800; border-radius: var(--lms-radius-sm); background: var(--lms-accent-soft); color: var(--lms-accent); overflow: hidden; flex-shrink: 0; text-transform: uppercase; }
.lms-brandmark img { width: 100%; height: 100%; object-fit: contain; }
.lms-shell { min-height: 100vh; display: flex; flex-direction: column; background: var(--lms-bg); }
.lms-topbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--lms-space-3) var(--lms-space-4); padding: var(--lms-space-3) clamp(16px,4vw,32px); border-bottom: 1px solid var(--lms-border); background: var(--lms-surface); min-height: 56px; }
.lms-topbar__brand { display: flex; align-items: center; gap: var(--lms-space-2); min-width: 0; text-decoration: none; color: inherit; }
.lms-topbar__name { font-weight: 700; font-size: 13px; letter-spacing: .04em; text-transform: uppercase; color: var(--lms-accent); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 40vw; }
.lms-topbar__actions { display: flex; align-items: center; gap: var(--lms-space-2); flex-wrap: wrap; }
.lms-shell__main { flex: 1; padding-block: var(--lms-space-5); }
@keyframes lms-spin { to { transform: rotate(360deg); } }
@keyframes lms-shimmer { to { background-position: -200% 0; } }
@media (prefers-reduced-motion: reduce) {
  .lms-card--interactive { transition: none; }
  .lms-card--interactive:hover { transform: none; }
  .lms-btn { transition: none; }
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
  scope,
}: {
  brand: Brand;
  scope?: string;
}): ReactElement {
  const selector = scope ?? defaultThemeScope;

  return createElement("style", {
    dangerouslySetInnerHTML: {
      __html: `${selector} {
${themeToCssVars(brand)}
}`,
    },
  });
}
