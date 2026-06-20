import type { EmbedResourceType, EmbedTokenClaims } from "@lms/auth";

/**
 * Pure helpers for the embeddable widget (issue #13): origin validation, the
 * `frame-ancestors` CSP directive, the iframe snippet handed to webmasters, and
 * the responsive/accessible widget HTML. Kept side-effect free so they unit-test
 * without a server or a database.
 */

export const EMBED_RESOURCE_TYPES: readonly EmbedResourceType[] = [
  "course",
  "dashboard",
  "widget",
];

export function isEmbedResourceType(value: unknown): value is EmbedResourceType {
  return (
    typeof value === "string" &&
    (EMBED_RESOURCE_TYPES as readonly string[]).includes(value)
  );
}

/**
 * A valid embed origin is `scheme://host[:port]` with no path/query/fragment.
 * Only https is allowed, except http on localhost/127.0.0.1 for local dev.
 * Wildcards are rejected — `frame-ancestors *` would defeat the purpose.
 */
export function isValidOrigin(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  // Reject anything beyond a bare origin (path, query, fragment, credentials).
  if (url.origin !== value) return false;
  if (url.username || url.password) return false;
  const isLocalhost =
    url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol === "https:") return true;
  if (url.protocol === "http:" && isLocalhost) return true;
  return false;
}

/**
 * Build the `frame-ancestors` directive from the token's allowed origins.
 * `'self'` is always included so the widget renders when opened directly.
 */
export function frameAncestors(allowedOrigins: string[]): string {
  return ["'self'", ...allowedOrigins].join(" ");
}

/**
 * Content-Security-Policy for the widget document. The document loads no
 * scripts (`default-src 'none'`), only its own inline styles, and restricts who
 * may frame it to the signed origins.
 */
export function widgetCsp(allowedOrigins: string[]): string {
  return [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    "img-src https: data:",
    `frame-ancestors ${frameAncestors(allowedOrigins)}`,
  ].join("; ");
}

/** Minimal HTML-attribute/text escaping for values interpolated into markup. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const RESOURCE_LABEL: Record<EmbedResourceType, string> = {
  course: "Course",
  dashboard: "Dashboard",
  widget: "Widget",
};

export interface WidgetRenderOptions {
  /** Base URL of the learner app the "Open" action links out to. */
  launchBaseUrl?: string;
}

/** Build the deep link the widget's primary action navigates to. */
export function launchUrl(
  claims: Pick<EmbedTokenClaims, "resourceType" | "resourceId">,
  launchBaseUrl: string,
): string {
  const base = launchBaseUrl.replace(/\/$/, "");
  const params = new URLSearchParams({
    type: claims.resourceType,
    id: claims.resourceId,
  });
  return `${base}/launch?${params.toString()}`;
}

/**
 * Render the embeddable widget as a self-contained, responsive, accessible HTML
 * document. No external assets, system font stack, honours light/dark, focus
 * outlines preserved, and a ≥44px touch target on the action — WCAG 2.2 AA.
 */
export function renderWidgetHtml(
  claims: Pick<
    EmbedTokenClaims,
    "resourceType" | "resourceId" | "title" | "subtitle"
  >,
  options: WidgetRenderOptions = {},
): string {
  const label = RESOURCE_LABEL[claims.resourceType];
  const title = claims.title?.trim() || `${label}`;
  const subtitle = claims.subtitle?.trim();
  const open = launchUrl(claims, options.launchBaseUrl ?? "");
  const heading = escapeHtml(title);
  const sub = subtitle ? escapeHtml(subtitle) : "";
  const kicker = escapeHtml(label.toUpperCase());

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${heading}</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; }
  body {
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background: Canvas; color: CanvasText;
    display: flex; padding: 12px;
  }
  .card {
    display: flex; flex-direction: column; gap: 12px;
    width: 100%; max-width: 420px; margin: auto;
    padding: 20px; border-radius: 14px;
    border: 1px solid color-mix(in srgb, CanvasText 14%, transparent);
    background: color-mix(in srgb, Canvas 92%, CanvasText 8%);
  }
  .kicker { font-size: 12px; font-weight: 700; letter-spacing: .08em; opacity: .7; margin: 0; }
  h1 { font-size: clamp(18px, 4vw, 22px); line-height: 1.25; margin: 0; }
  p.sub { margin: 0; font-size: 14px; line-height: 1.4; opacity: .8; }
  a.open {
    display: inline-flex; align-items: center; justify-content: center;
    min-height: 44px; padding: 0 18px; border-radius: 10px;
    font-size: 15px; font-weight: 600; text-decoration: none;
    background: #2563eb; color: #fff;
  }
  a.open:hover { background: #1d4ed8; }
  a.open:focus-visible { outline: 3px solid #93c5fd; outline-offset: 2px; }
  @media (prefers-reduced-motion: no-preference) { a.open { transition: background .15s ease; } }
</style>
</head>
<body>
<main class="card" role="main" aria-labelledby="embed-title">
  <p class="kicker">${kicker}</p>
  <h1 id="embed-title">${heading}</h1>
  ${sub ? `<p class="sub">${sub}</p>` : ""}
  <a class="open" href="${escapeHtml(open)}" target="_blank" rel="noopener noreferrer"
     aria-label="Open ${heading} in the learning platform">Open ${escapeHtml(label.toLowerCase())}</a>
</main>
</body>
</html>
`;
}

/** The iframe snippet a webmaster pastes into their CMS. */
export function iframeSnippet(
  embedUrl: string,
  resourceType: EmbedResourceType,
): string {
  const label = RESOURCE_LABEL[resourceType];
  return (
    `<iframe src="${escapeHtml(embedUrl)}" ` +
    `title="${escapeHtml(label)} widget" ` +
    `width="100%" height="220" style="border:0;max-width:420px" ` +
    `loading="lazy" referrerpolicy="no-referrer"></iframe>`
  );
}
