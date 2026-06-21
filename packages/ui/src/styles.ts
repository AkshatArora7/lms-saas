import { createElement, type ReactElement } from "react";

import type { Brand, Tone } from "./theme.js";
import { themeToCssVars } from "./theme.js";

const defaultThemeScope = ":root, .lms-theme";

export const componentCss = `
.lms-theme *, .lms-theme *::before, .lms-theme *::after { box-sizing: border-box; }
.lms-theme { background: var(--lms-bg); color: var(--lms-text); font-family: var(--lms-font-sans); font-size: var(--lms-font-size); line-height: var(--lms-line); -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; text-rendering: optimizeLegibility; }
.lms-theme h1, .lms-theme h2, .lms-theme h3 { letter-spacing: -0.02em; font-weight: 700; }
.lms-theme img { display: block; max-width: 100%; }
.lms-theme button, .lms-theme input, .lms-theme select, .lms-theme textarea { font: inherit; }
.lms-container { width: 100%; max-width: 1100px; margin-inline: auto; padding-inline: clamp(16px,4vw,32px); }
.lms-container--wide { max-width: 1280px; }
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
.lms-input, .lms-textarea, .lms-select { width: 100%; min-height: var(--lms-control-h); padding: var(--lms-space-2) var(--lms-space-3); border: 1px solid var(--lms-border-strong); border-radius: var(--lms-radius-md); background: var(--lms-surface); color: var(--lms-text); font-family: inherit; font-size: var(--lms-font-size); transition: border-color 150ms cubic-bezier(0.2,0,0,1), box-shadow 150ms cubic-bezier(0.2,0,0,1); }
.lms-input::placeholder, .lms-textarea::placeholder { color: var(--lms-text-subtle); }
.lms-input:hover, .lms-textarea:hover, .lms-select:hover { border-color: var(--lms-text-subtle); }
.lms-input:focus-visible, .lms-textarea:focus-visible, .lms-select:focus-visible { outline: 2px solid var(--lms-focus); outline-offset: 2px; border-color: var(--lms-accent); box-shadow: 0 0 0 4px var(--lms-accent-soft); }
.lms-input[aria-invalid="true"], .lms-textarea[aria-invalid="true"], .lms-select[aria-invalid="true"] { border-color: var(--lms-danger); }
.lms-input:disabled, .lms-textarea:disabled, .lms-select:disabled { opacity: .6; cursor: not-allowed; background: var(--lms-surface-2); }
.lms-textarea { resize: vertical; }
.lms-select { appearance: none; -webkit-appearance: none; padding-right: var(--lms-space-6); background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23667085' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right var(--lms-space-3) center; }
.lms-checkbox, .lms-radio { display: inline-flex; align-items: center; gap: var(--lms-space-2); min-height: 44px; cursor: pointer; min-width: 0; }
.lms-theme[data-tone="admin"] .lms-checkbox, .lms-theme[data-tone="admin"] .lms-radio { min-height: 40px; }
.lms-checkbox__input, .lms-radio__input { appearance: none; -webkit-appearance: none; margin: 0; width: 20px; height: 20px; flex-shrink: 0; border: 1px solid var(--lms-border-strong); background: var(--lms-surface); cursor: pointer; transition: background 150ms cubic-bezier(0.2,0,0,1), border-color 150ms cubic-bezier(0.2,0,0,1); background-repeat: no-repeat; background-position: center; }
.lms-checkbox__input { border-radius: var(--lms-radius-sm); }
.lms-radio__input { border-radius: var(--lms-radius-pill); }
.lms-checkbox__input:hover, .lms-radio__input:hover { border-color: var(--lms-text-subtle); }
.lms-checkbox__input:checked, .lms-radio__input:checked { background-color: var(--lms-accent); border-color: var(--lms-accent); }
.lms-checkbox__input:checked { background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%23ffffff' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='20 6 9 17 4 12'/%3E%3C/svg%3E"); }
.lms-radio__input:checked { background-image: radial-gradient(circle, var(--lms-accent-contrast) 0 32%, transparent 36%); }
.lms-checkbox__input:focus-visible, .lms-radio__input:focus-visible { outline: 3px solid var(--lms-focus); outline-offset: 2px; }
.lms-checkbox__input:disabled, .lms-radio__input:disabled { opacity: .6; cursor: not-allowed; background-color: var(--lms-surface-2); }
.lms-checkbox__label, .lms-radio__label { font-size: var(--lms-font-size); overflow-wrap: anywhere; }
.lms-file { display: flex; flex-direction: column; gap: var(--lms-space-2); width: 100%; }
.lms-file__input { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.lms-file__zone { display: flex; align-items: center; justify-content: center; gap: var(--lms-space-2); min-height: var(--lms-control-h); padding: var(--lms-space-4); border: 1px dashed var(--lms-border-strong); border-radius: var(--lms-radius-md); background: var(--lms-surface); color: var(--lms-text-muted); cursor: pointer; text-align: center; transition: border-color 150ms cubic-bezier(0.2,0,0,1), background 150ms cubic-bezier(0.2,0,0,1), color 150ms cubic-bezier(0.2,0,0,1); }
.lms-file__zone svg { width: 20px; height: 20px; flex-shrink: 0; }
.lms-file:hover .lms-file__zone { border-color: var(--lms-text-subtle); background: var(--lms-surface-2); }
.lms-file__input:focus-visible + .lms-file__zone { outline: 3px solid var(--lms-focus); outline-offset: 2px; border-color: var(--lms-accent); color: var(--lms-text); }
.lms-file__input:disabled + .lms-file__zone { opacity: .6; cursor: not-allowed; background: var(--lms-surface-2); }
.lms-file__name { font-size: var(--lms-font-size-sm); color: var(--lms-text); font-weight: 600; overflow-wrap: anywhere; }
.lms-btn { display: inline-flex; align-items: center; justify-content: center; gap: var(--lms-space-2); min-height: var(--lms-control-h); padding: var(--lms-space-2) var(--lms-space-5); border-radius: var(--lms-radius-md); font-weight: 600; font-size: var(--lms-font-size); letter-spacing: 0.01em; cursor: pointer; text-decoration: none; border: 1px solid transparent; transition: background 160ms cubic-bezier(0.2,0,0,1), color 160ms cubic-bezier(0.2,0,0,1), border-color 160ms cubic-bezier(0.2,0,0,1), box-shadow 160ms cubic-bezier(0.2,0,0,1), transform 160ms cubic-bezier(0.2,0,0,1); white-space: nowrap; }
.lms-btn:focus-visible { outline: 3px solid var(--lms-focus); outline-offset: 2px; }
.lms-btn:active { transform: translateY(1px); }
.lms-btn--primary { background: linear-gradient(180deg, var(--lms-accent), var(--lms-accent-hover)); color: var(--lms-accent-contrast); border-color: var(--lms-accent-hover); box-shadow: 0 1px 2px rgba(16, 24, 40, 0.12); }
.lms-btn--primary:hover { background: var(--lms-accent-hover); border-color: var(--lms-accent-hover); box-shadow: 0 6px 16px -4px var(--lms-accent-soft); transform: translateY(-1px); }
.lms-btn--secondary { background: var(--lms-surface); color: var(--lms-text); border-color: var(--lms-border-strong); box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04); }
.lms-btn--secondary:hover { background: var(--lms-surface-2); border-color: var(--lms-text-subtle); }
.lms-btn--ghost { background: transparent; color: var(--lms-text); border-color: transparent; }
.lms-btn--ghost:hover { background: var(--lms-surface-2); }
.lms-btn--danger { background: var(--lms-danger); color: var(--lms-danger-contrast); border-color: var(--lms-danger); box-shadow: 0 1px 2px rgba(16, 24, 40, 0.12); }
.lms-btn--danger:hover { filter: brightness(0.92); transform: translateY(-1px); }
.lms-btn--outline { background: transparent; color: var(--lms-text); border-color: var(--lms-border-strong); }
.lms-btn--outline:hover { background: var(--lms-surface-2); border-color: var(--lms-text-subtle); }
.lms-btn--sm { min-height: 36px; padding: var(--lms-space-1) var(--lms-space-4); font-size: var(--lms-font-size-sm); }
.lms-btn--lg { min-height: 48px; padding: var(--lms-space-3) var(--lms-space-6); font-size: 1.0625rem; }
.lms-btn--icon { padding: 0; width: var(--lms-control-h); min-width: var(--lms-control-h); height: var(--lms-control-h); }
.lms-btn--icon svg { width: 20px; height: 20px; }
.lms-theme[data-tone="web"] .lms-btn--icon { width: 44px; min-width: 44px; height: 44px; }
.lms-btn--full { width: 100%; }
.lms-btn:disabled, .lms-btn[aria-disabled="true"] { opacity: .5; cursor: not-allowed; pointer-events: none; }
.lms-btn[aria-busy="true"] { cursor: progress; pointer-events: none; }
.lms-btn__spinner { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
.lms-table { width: 100%; border-collapse: collapse; font-size: var(--lms-font-size); }
.lms-table th { text-align: left; background: var(--lms-surface-2); color: var(--lms-text-muted); font-size: var(--lms-font-size-sm); font-weight: 600; padding: var(--lms-row-pad-y) var(--lms-space-3); border-bottom: 1px solid var(--lms-border-strong); white-space: nowrap; }
.lms-table td { padding: var(--lms-row-pad-y) var(--lms-space-3); border-bottom: 1px solid var(--lms-border); color: var(--lms-text); vertical-align: middle; }
.lms-table tbody tr { transition: background 150ms cubic-bezier(0.2,0,0,1); }
.lms-table tbody tr:hover { background: var(--lms-surface-2-hover); }
.lms-table tbody tr:focus-within { outline: 2px solid var(--lms-focus); outline-offset: -2px; }
.lms-table tbody tr:last-child td { border-bottom: 0; }
.lms-table-wrap { width: 100%; overflow-x: auto; border: 1px solid var(--lms-border); border-radius: var(--lms-radius-md); background: var(--lms-surface); }
.lms-th--sorted { color: var(--lms-text); }
.lms-th__sort { display: inline-flex; align-items: center; gap: var(--lms-space-1); }
.lms-th__sort svg { width: 14px; height: 14px; flex-shrink: 0; }
.lms-th__sort--desc svg { transform: rotate(180deg); }
.lms-table tr.lms-skeleton-row td { padding-block: var(--lms-row-pad-y); }
.lms-table--sticky { position: relative; }
.lms-table--sticky thead th { position: sticky; top: 0; z-index: 2; }
.lms-table--sticky-col th:first-child, .lms-table--sticky-col td:first-child { position: sticky; left: 0; z-index: 1; background: var(--lms-surface); }
.lms-table--sticky-col thead th:first-child { z-index: 3; background: var(--lms-surface-2); }
.lms-table--sticky-col tbody tr:hover td:first-child { background: var(--lms-surface-2-hover); }
@media (max-width: 600px) {
  .lms-table--stack, .lms-table--stack thead, .lms-table--stack tbody, .lms-table--stack tr, .lms-table--stack td { display: block; width: 100%; }
  .lms-table--stack thead { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
  .lms-table--stack tbody tr { border: 1px solid var(--lms-border); border-radius: var(--lms-radius-md); margin-bottom: var(--lms-space-3); padding: var(--lms-space-2) var(--lms-space-3); background: var(--lms-surface); }
  .lms-table--stack tbody tr:last-child { margin-bottom: 0; }
  .lms-table--stack td { display: flex; justify-content: space-between; align-items: baseline; gap: var(--lms-space-3); padding: var(--lms-space-2) 0; border-bottom: 1px solid var(--lms-border); text-align: right; }
  .lms-table--stack td:last-child { border-bottom: 0; }
  .lms-table--stack td::before { content: attr(data-label); font-weight: 600; font-size: var(--lms-font-size-sm); color: var(--lms-text-muted); text-align: left; flex-shrink: 0; }
  .lms-table--stack td[data-label=""]::before { content: none; }
}
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
.lms-stat { display: flex; flex-direction: column; gap: var(--lms-space-1); padding: var(--lms-card-pad); background: var(--lms-surface); border: 1px solid var(--lms-border); border-radius: var(--lms-radius-md); box-shadow: var(--lms-shadow-sm); min-width: 0; }
.lms-stat__icon { display: inline-flex; width: 36px; height: 36px; align-items: center; justify-content: center; border-radius: var(--lms-radius-sm); background: var(--lms-accent-soft); color: var(--lms-accent); margin-bottom: var(--lms-space-1); }
.lms-stat__icon svg { width: 20px; height: 20px; }
.lms-stat__value { font-size: clamp(1.5rem, 4vw, 2rem); font-weight: 700; line-height: 1; overflow-wrap: anywhere; }
.lms-stat__label { font-size: var(--lms-font-size-sm); color: var(--lms-text-muted); overflow-wrap: anywhere; }
.lms-stat__delta { font-size: var(--lms-font-size-sm); color: var(--lms-text-muted); }
.lms-stat--accent .lms-stat__icon { background: var(--lms-accent-soft); color: var(--lms-accent); }
.lms-stat--accent .lms-stat__value { color: var(--lms-accent); }
.lms-stat--success .lms-stat__icon { background: var(--lms-success-soft-bg); color: var(--lms-success-soft-text); }
.lms-stat--success .lms-stat__value { color: var(--lms-success-soft-text); }
.lms-stat--danger .lms-stat__icon { background: var(--lms-danger-soft-bg); color: var(--lms-danger-soft-text); }
.lms-stat--danger .lms-stat__value { color: var(--lms-danger-soft-text); }
.lms-coursecard { display: flex; flex-direction: column; gap: var(--lms-space-2); border-top: 3px solid var(--lms-accent); }
.lms-coursecard__badges { display: flex; flex-wrap: wrap; gap: var(--lms-space-2); align-items: center; }
.lms-coursecard__title { margin: 0; font-size: 1.0625rem; line-height: 1.3; overflow-wrap: anywhere; }
.lms-coursecard__meta { font-size: var(--lms-font-size-sm); color: var(--lms-text-muted); overflow-wrap: anywhere; }
.lms-alert { display: flex; gap: var(--lms-space-3); padding: var(--lms-space-3) var(--lms-space-4); border-radius: var(--lms-radius-md); border: 1px solid transparent; font-size: var(--lms-font-size-sm); }
.lms-alert--info { background: var(--lms-info-soft-bg); border-color: var(--lms-border-strong); color: var(--lms-info-soft-text); }
.lms-alert--success { background: var(--lms-success-soft-bg); border-color: var(--lms-border-strong); color: var(--lms-success-soft-text); }
.lms-alert--warning { background: var(--lms-warning-soft-bg); border-color: var(--lms-border-strong); color: var(--lms-warning-soft-text); }
.lms-alert--danger { background: var(--lms-danger-soft-bg); border-color: var(--lms-border-strong); color: var(--lms-danger-soft-text); }
.lms-alert__icon { flex-shrink: 0; display: inline-flex; }
.lms-alert__icon svg { width: 20px; height: 20px; }
.lms-alert__body { overflow-wrap: anywhere; }
.lms-toast-region { position: fixed; z-index: 400; bottom: var(--lms-space-4); right: var(--lms-space-4); left: var(--lms-space-4); display: flex; flex-direction: column; align-items: stretch; gap: var(--lms-space-2); pointer-events: none; }
@media (min-width: 601px) { .lms-toast-region { left: auto; align-items: flex-end; } }
.lms-toast { pointer-events: auto; display: flex; align-items: flex-start; gap: var(--lms-space-3); width: 100%; max-width: 380px; padding: var(--lms-space-3) var(--lms-space-4); border-radius: var(--lms-radius-md); border: 1px solid transparent; box-shadow: var(--lms-shadow-lg); font-size: var(--lms-font-size-sm); animation: lms-toast-in 180ms cubic-bezier(0.2,0,0,1); }
.lms-toast--info { background: var(--lms-info-soft-bg); border-color: var(--lms-border-strong); color: var(--lms-info-soft-text); }
.lms-toast--success { background: var(--lms-success-soft-bg); border-color: var(--lms-border-strong); color: var(--lms-success-soft-text); }
.lms-toast--warning { background: var(--lms-warning-soft-bg); border-color: var(--lms-border-strong); color: var(--lms-warning-soft-text); }
.lms-toast--danger { background: var(--lms-danger-soft-bg); border-color: var(--lms-border-strong); color: var(--lms-danger-soft-text); }
.lms-toast__icon { flex-shrink: 0; display: inline-flex; }
.lms-toast__icon svg { width: 20px; height: 20px; }
.lms-toast__body { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.lms-toast__dismiss { flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; margin: -10px -10px -10px 0; padding: 0; border: 0; background: transparent; color: inherit; cursor: pointer; border-radius: var(--lms-radius-sm); opacity: .8; transition: opacity 150ms cubic-bezier(0.2,0,0,1), background 150ms cubic-bezier(0.2,0,0,1); }
.lms-toast__dismiss:hover { opacity: 1; }
.lms-toast__dismiss:focus-visible { outline: 3px solid var(--lms-focus); outline-offset: -2px; }
.lms-toast__dismiss svg { width: 18px; height: 18px; }
.lms-spinner { display: inline-block; border-radius: 50%; border: 2px solid var(--lms-border); border-top-color: var(--lms-accent); animation: lms-spin .7s linear infinite; }
.lms-spinner--sm { width: 16px; height: 16px; }
.lms-spinner--md { width: 24px; height: 24px; }
.lms-spinner--lg { width: 40px; height: 40px; border-width: 3px; }
.lms-skeleton { display: block; background: linear-gradient(90deg, var(--lms-surface-2) 25%, var(--lms-border) 50%, var(--lms-surface-2) 75%); background-size: 200% 100%; animation: lms-shimmer 1.5s infinite; border-radius: var(--lms-radius-sm); }
.lms-brandmark { display: inline-flex; align-items: center; justify-content: center; font-weight: 800; border-radius: var(--lms-radius-sm); background: var(--lms-accent-soft); color: var(--lms-accent); overflow: hidden; flex-shrink: 0; text-transform: uppercase; }
.lms-brandmark img { width: 100%; height: 100%; object-fit: contain; }
.lms-shell { min-height: 100vh; display: flex; flex-direction: column; background: var(--lms-bg); }
.lms-topbar { position: sticky; top: 0; z-index: 30; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--lms-space-3) var(--lms-space-4); padding: var(--lms-space-3) clamp(16px,4vw,32px); border-bottom: 1px solid var(--lms-border); background: var(--lms-surface); box-shadow: var(--lms-shadow-sm); min-height: 64px; }
.lms-theme[data-tone="admin"] .lms-topbar { min-height: 56px; }
.lms-topbar__brand { display: flex; align-items: center; gap: var(--lms-space-3); min-width: 0; text-decoration: none; color: inherit; }
.lms-topbar__name { font-weight: 700; font-size: 16px; letter-spacing: -0.01em; color: var(--lms-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 40vw; }
.lms-topbar__actions { display: flex; align-items: center; gap: var(--lms-space-2); flex-wrap: wrap; }
.lms-nav__link { display: inline-flex; align-items: center; color: var(--lms-text-muted); text-decoration: none; padding: var(--lms-space-2) var(--lms-space-3); border-radius: var(--lms-radius-sm); transition: background 150ms cubic-bezier(0.2,0,0,1), color 150ms cubic-bezier(0.2,0,0,1); }
.lms-nav__link:hover { color: var(--lms-text); background: var(--lms-surface-2); }
.lms-nav__link[aria-current="page"] { color: var(--lms-accent); background: var(--lms-accent-soft); }
.lms-nav__link:focus-visible { outline: 3px solid var(--lms-focus); outline-offset: 2px; }
.lms-nav--scroll { display: flex; flex-wrap: nowrap; overflow-x: auto; gap: var(--lms-space-1); -webkit-overflow-scrolling: touch; scrollbar-width: thin; }
.lms-nav--scroll .lms-nav__link { white-space: nowrap; flex-shrink: 0; }
.lms-breadcrumbs { font-size: var(--lms-font-size-sm); }
.lms-breadcrumbs__list { display: flex; flex-wrap: wrap; align-items: center; gap: var(--lms-space-1); margin: 0; padding: 0; list-style: none; }
.lms-breadcrumbs__item { display: inline-flex; align-items: center; gap: var(--lms-space-1); min-width: 0; }
.lms-breadcrumbs__sep { color: var(--lms-text-subtle); }
.lms-breadcrumbs__link { color: var(--lms-text-muted); text-decoration: none; border-radius: var(--lms-radius-sm); }
.lms-breadcrumbs__link:hover { color: var(--lms-text); text-decoration: underline; }
.lms-breadcrumbs__link:focus-visible { outline: 3px solid var(--lms-focus); outline-offset: 2px; }
.lms-breadcrumbs__current { color: var(--lms-text); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 60vw; }
@media (max-width: 600px) {
  .lms-breadcrumbs__item--collapsible { display: none; }
}
.lms-shell__main { flex: 1; padding-block: var(--lms-space-5); }
.lms-theme[data-tone="web"] .lms-shell__main { padding-block: var(--lms-space-6); }
@keyframes lms-spin { to { transform: rotate(360deg); } }
@keyframes lms-shimmer { to { background-position: -200% 0; } }
@keyframes lms-toast-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
@media (prefers-reduced-motion: reduce) {
  .lms-card--interactive { transition: none; }
  .lms-card--interactive:hover { transform: none; }
  .lms-theme[data-tone="admin"] .lms-card--interactive:hover { transform: none; }
  .lms-btn { transition: none; }
  .lms-btn:hover, .lms-btn:active { transform: none; }
  .lms-input, .lms-textarea, .lms-select { transition: none; }
  .lms-checkbox__input, .lms-radio__input { transition: none; }
  .lms-file__zone { transition: none; }
  .lms-table tbody tr { transition: none; }
  .lms-nav__link { transition: none; }
  .lms-progress__fill { transition: none; }
  .lms-spinner { animation: none; border-top-color: var(--lms-accent); }
  .lms-skeleton { animation: none; background: var(--lms-surface-2); }
  .lms-toast { animation: none; }
  .lms-toast__dismiss { transition: none; }
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
