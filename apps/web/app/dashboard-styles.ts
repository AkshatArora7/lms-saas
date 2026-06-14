import type { Branding } from "./lib/branding";

/**
 * Scoped dashboard CSS for the learner home. Inline `React.CSSProperties` cannot
 * express media queries, `:hover`, `:focus-visible`, or `prefers-reduced-motion`,
 * all of which the responsive + accessibility contract for this screen needs, so
 * the dashboard ships a single scoped `<style>` block under the `.lms-dash` root.
 *
 * Responsive strategy is intrinsic (mobile-first, no media-query maths for the
 * course grid): `repeat(auto-fill, minmax(min(100%, 240px), 1fr))` flows 1 -> 2
 * -> 3+ columns and never overflows because each track is capped at 100% of the
 * container. `min-width: 0` on grid children prevents long content from forcing
 * horizontal scroll at 360px.
 */
export function dashboardCss(brand: Branding): string {
  const accent = brand.accent;
  return `
.lms-dash, .lms-dash * { box-sizing: border-box; }
.lms-dash {
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: #1c2430;
  max-width: 1100px;
  margin: 0 auto;
  padding: clamp(16px, 4vw, 32px);
  width: 100%;
}
.lms-dash-topbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid #e6e8ec;
}
.lms-dash-brand {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: .04em;
  text-transform: uppercase;
  color: ${accent};
}
.lms-dash-userwrap {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.lms-dash-user {
  min-width: 0;
  max-width: 40vw;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #5b606b;
  font-size: 13px;
}
.lms-dash-signout {
  min-height: 44px;
  padding: .5rem .9rem;
  border: 1px solid #d0d3d9;
  border-radius: 8px;
  background: #fff;
  cursor: pointer;
  font-weight: 600;
  color: #1c2430;
}
.lms-dash-greeting { margin: 24px 0 8px; }
.lms-dash-greeting h1 {
  margin: 0;
  font-size: clamp(22px, 5vw, 30px);
  line-height: 1.2;
}
.lms-dash-greeting p { margin: 4px 0 0; color: #5b606b; }
.lms-dash-body {
  display: grid;
  grid-template-columns: 1fr;
  gap: 24px;
  margin-top: 24px;
}
.lms-dash-main { min-width: 0; }
.lms-dash-section-title { margin: 0 0 12px; font-size: 16px; }
.lms-dash-courses {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 240px), 1fr));
  gap: 16px;
}
.lms-dash-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  min-height: 44px;
  padding: 16px;
  border: 1px solid #e6e8ec;
  border-left: 4px solid ${accent};
  border-radius: 12px;
  background: #fff;
  text-decoration: none;
  color: inherit;
  box-shadow: 0 1px 2px rgba(16,24,40,.06);
  transition: transform .15s ease, box-shadow .15s ease;
}
.lms-dash-card:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(16,24,40,.12); }
.lms-dash-card:focus-visible { outline: 3px solid #2952cc; outline-offset: 2px; }
.lms-dash-card-title { margin: 0; font-size: 16px; font-weight: 700; overflow-wrap: anywhere; }
.lms-dash-card-meta { margin: 0; font-size: 13px; color: #5b606b; overflow-wrap: anywhere; }
.lms-dash-progress {
  height: 8px;
  border-radius: 999px;
  background: #eef1f4;
  overflow: hidden;
}
.lms-dash-progress > span { display: block; height: 100%; background: ${accent}; }
.lms-dash-card-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; color: #5b606b; }
.lms-dash-empty {
  padding: 32px 24px;
  border: 1px dashed #d0d3d9;
  border-radius: 12px;
  text-align: center;
  color: #5b606b;
  background: #fff;
}
.lms-dash-empty h3 { margin: 8px 0 4px; color: #1c2430; }
.lms-dash-aside {
  min-width: 0;
  padding: 20px;
  border: 1px solid #e6e8ec;
  border-radius: 12px;
  background: #fff;
  height: fit-content;
}
.lms-dash-aside h2 { margin: 0 0 12px; font-size: 16px; }
.lms-dash-kv { margin: 4px 0; font-size: 14px; overflow-wrap: anywhere; }
.lms-dash-kv strong { color: #1c2430; }
.lms-dash-chips { margin: 4px 0 12px; }
.lms-dash-chip {
  display: inline-block;
  padding: .2rem .6rem;
  margin: 0 .35rem .35rem 0;
  border-radius: 999px;
  background: #eef1f8;
  color: #2952cc;
  font-size: 12px;
  font-weight: 600;
}
.lms-dash-muted { color: #8a8f99; }
@media (min-width: 1025px) {
  .lms-dash-body { grid-template-columns: minmax(0, 1fr) 320px; }
}
@media (prefers-reduced-motion: reduce) {
  .lms-dash-card { transition: none; }
  .lms-dash-card:hover { transform: none; }
}
`;
}
