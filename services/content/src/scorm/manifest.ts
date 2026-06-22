/**
 * SCORM `imsmanifest.xml` (CAM) parser — PURE function (issue #31).
 *
 * Takes the already-extracted manifest XML string only: NO filesystem, NO unzip,
 * NO network. Detects SCORM version (1.2 / 2004), the organization title, the
 * item tree, and the default launchable SCO href, and normalizes the mastery
 * score to 0..1. Also exposes the cmi → normalized-status mapping used by the
 * runtime route. Every result is a discriminated union so callers can branch on
 * a stable `reason` rather than throwing.
 *
 * Security (handshake §F/§H): the parser MUST NOT resolve DTDs/external entities
 * (XXE / billion-laughs) and MUST reject unsafe launch hrefs (absolute URL,
 * leading `/`, backslash, or `..` traversal). It fails closed.
 */
import { XMLParser } from "fast-xml-parser";

export type ScormVersion = "1.2" | "2004";

export interface ScormManifestItem {
  identifier: string;
  title: string | null;
  identifierref: string | null;
  launchHref: string | null;
}

export interface ScormManifest {
  version: ScormVersion;
  organizationTitle: string | null;
  items: ScormManifestItem[];
  launchHref: string;
  masteryScore: number | null;
}

export type ParseManifestResult =
  | { ok: true; manifest: ScormManifest }
  | {
      ok: false;
      reason: "invalid_xml" | "no_launchable_resource" | "unsafe_href";
      message: string;
    };

/** Cap manifest input size to bound the large-input / billion-laughs risk. */
const MAX_MANIFEST_BYTES = 1024 * 1024; // 1 MB

const xmlParser = new XMLParser({
  processEntities: false,
  ignoreDeclaration: true,
  ignorePiTags: true,
  allowBooleanAttributes: true,
  ignoreAttributes: false,
  attributeNamePrefix: "@",
});

/** Coerce fast-xml-parser's "0 | 1 | many" shape into an array. */
function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

/** A node may carry text as a raw string, number, or `{ "#text": ... }`. */
function textOf(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number") return String(v);
  if (typeof v === "object") {
    const t = (v as Record<string, unknown>)["#text"];
    if (typeof t === "string") return t.trim() || null;
    if (typeof t === "number") return String(t);
  }
  return null;
}

/**
 * A launch href is safe only when it is a *relative* path that stays inside the
 * package: no absolute URL scheme, no leading `/`, no backslash, no `..` segment.
 */
export function isSafeLaunchHref(href: string): boolean {
  if (href.length === 0) return false;
  if (href.includes("\\")) return false;
  if (href.startsWith("/")) return false;
  // Absolute URL scheme (http:, https:, file:, javascript:, data:, …).
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href)) return false;
  // Protocol-relative URL.
  if (href.startsWith("//")) return false;
  // Strip a query/fragment before checking for traversal segments.
  const pathPart = href.split(/[?#]/)[0] ?? "";
  const segments = pathPart.split("/");
  if (segments.some((s) => s === "..")) return false;
  return true;
}

function detectVersion(manifest: Record<string, unknown>): ScormVersion {
  const metadata = manifest.metadata as Record<string, unknown> | undefined;
  const schemaVersion = metadata
    ? textOf(metadata.schemaversion)?.toLowerCase() ?? ""
    : "";
  const schema = metadata ? textOf(metadata.schema)?.toLowerCase() ?? "" : "";
  const haystack = `${schemaVersion} ${schema}`;
  if (haystack.includes("1.2")) return "1.2";
  if (
    haystack.includes("2004") ||
    haystack.includes("cam 1.3") ||
    haystack.includes("v1p3")
  ) {
    return "2004";
  }
  // Namespace markers as a fallback.
  const keys = Object.keys(manifest).join(" ").toLowerCase();
  if (keys.includes("adlcp_v1p3") || keys.includes("imsss")) return "2004";
  // Default to 2004 when ambiguous (handshake §B).
  return "2004";
}

/** Build identifier→href map from `manifest/resources/resource`. */
function buildResourceMap(
  manifest: Record<string, unknown>,
): Map<string, string> {
  const map = new Map<string, string>();
  const resources = manifest.resources as Record<string, unknown> | undefined;
  if (!resources) return map;
  for (const res of asArray(resources.resource as unknown)) {
    if (!res || typeof res !== "object") continue;
    const r = res as Record<string, unknown>;
    const id = typeof r["@identifier"] === "string" ? r["@identifier"] : null;
    const href = typeof r["@href"] === "string" ? r["@href"] : null;
    if (id && href) map.set(id, href);
  }
  return map;
}

/** First resource href in document order, regardless of identifier. */
function firstResourceHref(manifest: Record<string, unknown>): string | null {
  const resources = manifest.resources as Record<string, unknown> | undefined;
  if (!resources) return null;
  for (const res of asArray(resources.resource as unknown)) {
    if (res && typeof res === "object") {
      const href = (res as Record<string, unknown>)["@href"];
      if (typeof href === "string" && href.length > 0) return href;
    }
  }
  return null;
}

interface RawItem {
  identifier: string;
  title: string | null;
  identifierref: string | null;
  children: RawItem[];
  masteryScore: number | null;
}

/** Recursively flatten `<item>` nodes (preorder). */
function walkItems(node: unknown): RawItem[] {
  const out: RawItem[] = [];
  for (const it of asArray(node)) {
    if (!it || typeof it !== "object") continue;
    const i = it as Record<string, unknown>;
    const children = walkItems(i.item as unknown);
    out.push({
      identifier: typeof i["@identifier"] === "string" ? i["@identifier"] : "",
      title: textOf(i.title),
      identifierref:
        typeof i["@identifierref"] === "string" ? i["@identifierref"] : null,
      children,
      // SCORM 1.2: <adlcp:masteryscore> appears on the item (parsed without the
      // namespace prefix because fast-xml-parser keeps the local name).
      masteryScore: parseMasteryScore(i),
    });
  }
  return out;
}

/** SCORM 1.2 mastery score (0..100) normalized to 0..1; null when absent. */
function parseMasteryScore(item: Record<string, unknown>): number | null {
  const raw =
    textOf(item.masteryscore) ??
    textOf((item as Record<string, unknown>)["adlcp:masteryscore"]);
  if (raw === null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return clamp01(n > 1 ? n / 100 : n);
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/**
 * SCORM 2004 mastery score: `imsss/sequencing/objectives/.../minNormalizedMeasure`
 * (already 0..1). We look for any `minNormalizedMeasure` text under the
 * organization's sequencing as a best-effort.
 */
function parse2004Mastery(org: Record<string, unknown>): number | null {
  const found = findMinNormalizedMeasure(org);
  if (found === null) return null;
  return clamp01(found);
}

function findMinNormalizedMeasure(node: unknown): number | null {
  if (!node || typeof node !== "object") return null;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key.toLowerCase().endsWith("minnormalizedmeasure")) {
      const n = Number(textOf(value));
      if (Number.isFinite(n)) return n;
    }
    if (typeof value === "object") {
      const nested = findMinNormalizedMeasure(value);
      if (nested !== null) return nested;
    }
  }
  return null;
}

export function parseManifest(xml: string): ParseManifestResult {
  if (typeof xml !== "string" || xml.trim().length === 0) {
    return { ok: false, reason: "invalid_xml", message: "Empty manifest." };
  }
  if (Buffer.byteLength(xml, "utf8") > MAX_MANIFEST_BYTES) {
    return {
      ok: false,
      reason: "invalid_xml",
      message: "Manifest exceeds the maximum allowed size.",
    };
  }
  // Defense in depth: reject DTD / entity declarations outright (XXE /
  // billion-laughs). fast-xml-parser ignores them, but we fail closed.
  if (/<!DOCTYPE/i.test(xml) || /<!ENTITY/i.test(xml)) {
    return {
      ok: false,
      reason: "invalid_xml",
      message: "DOCTYPE/ENTITY declarations are not allowed.",
    };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = xmlParser.parse(xml) as Record<string, unknown>;
  } catch {
    return { ok: false, reason: "invalid_xml", message: "Malformed XML." };
  }

  const manifest = parsed.manifest as Record<string, unknown> | undefined;
  if (!manifest || typeof manifest !== "object") {
    return {
      ok: false,
      reason: "invalid_xml",
      message: "Missing <manifest> root element.",
    };
  }

  const version = detectVersion(manifest);
  const resourceMap = buildResourceMap(manifest);

  // Pick the organization named by organizations@default, else the first.
  const organizations = manifest.organizations as
    | Record<string, unknown>
    | undefined;
  const orgList = organizations
    ? asArray(organizations.organization as unknown)
    : [];
  const defaultOrgId =
    organizations && typeof organizations["@default"] === "string"
      ? (organizations["@default"] as string)
      : null;
  let org: Record<string, unknown> | null = null;
  if (defaultOrgId) {
    org =
      (orgList.find(
        (o) =>
          o &&
          typeof o === "object" &&
          (o as Record<string, unknown>)["@identifier"] === defaultOrgId,
      ) as Record<string, unknown> | undefined) ?? null;
  }
  if (!org && orgList.length > 0) {
    org = orgList[0] as Record<string, unknown>;
  }

  const organizationTitle = org ? textOf(org.title) : null;
  const rawItems = org ? walkItems(org.item as unknown) : [];

  // Flatten to the public item list, resolving each item's launch href.
  const items: ScormManifestItem[] = [];
  const flatten = (list: RawItem[]): void => {
    for (const it of list) {
      const href = it.identifierref
        ? resourceMap.get(it.identifierref) ?? null
        : null;
      items.push({
        identifier: it.identifier,
        title: it.title,
        identifierref: it.identifierref,
        launchHref: href,
      });
      flatten(it.children);
    }
  };
  flatten(rawItems);

  // Default launch href: first item with a resolvable resource, else the first
  // resource href.
  let launchHref =
    items.find((i) => i.launchHref && i.launchHref.length > 0)?.launchHref ??
    firstResourceHref(manifest);

  if (!launchHref || launchHref.length === 0) {
    return {
      ok: false,
      reason: "no_launchable_resource",
      message: "No launchable SCO resource found in the manifest.",
    };
  }

  if (!isSafeLaunchHref(launchHref)) {
    return {
      ok: false,
      reason: "unsafe_href",
      message: `Refusing unsafe launch href: ${launchHref}`,
    };
  }

  // Mastery score: SCORM 1.2 item masteryscore (first that has one), else the
  // SCORM 2004 minNormalizedMeasure.
  let masteryScore: number | null = null;
  const firstWithMastery = findFirstItemMastery(rawItems);
  if (firstWithMastery !== null) {
    masteryScore = firstWithMastery;
  } else if (version === "2004" && org) {
    masteryScore = parse2004Mastery(org);
  }

  return {
    ok: true,
    manifest: {
      version,
      organizationTitle,
      items,
      launchHref,
      masteryScore,
    },
  };
}

function findFirstItemMastery(list: RawItem[]): number | null {
  for (const it of list) {
    if (it.masteryScore !== null) return it.masteryScore;
    const nested = findFirstItemMastery(it.children);
    if (nested !== null) return nested;
  }
  return null;
}
