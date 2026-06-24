/**
 * Direct-to-Blob upload support for lecture videos. The gateway/UI asks for a
 * signed upload URL, uploads the bytes straight to object storage, then creates
 * a `video_asset` row referencing the returned blob URL.
 *
 * The {@link BlobSigner} seam keeps storage pluggable: production uses Vercel
 * Blob; dev/test use {@link DevBlobSigner}. Keys are namespaced by tenant under
 * a `video/` prefix so one tenant's objects can never collide with another's
 * (the storage isolation boundary).
 */

/** Default allow-list of uploadable video container types. */
export const ALLOWED_CONTENT_TYPES = new Set<string>([
  "video/mp4",
  "video/webm",
  "video/quicktime", // .mov
  "video/x-matroska", // .mkv
]);

/** Default max upload size (5 GB) — lecture videos run large. */
export const DEFAULT_MAX_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024;

// The signer seam + its types + the offline DevBlobSigner now live in the
// shared @lms/blob package (production Vercel Blob signer ships there too).
// Re-exported here so the rest of this service keeps importing from "./blob".
export {
  type BlobSigner,
  type SignedUpload,
  DevBlobSigner,
} from "@lms/blob";

export type ValidateUploadResult =
  | { ok: true }
  | { ok: false; reason: "unsupported_type" | "too_large"; message: string };

export function validateUpload(
  contentType: string,
  sizeBytes: number,
  maxBytes: number = DEFAULT_MAX_UPLOAD_BYTES,
): ValidateUploadResult {
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    return {
      ok: false,
      reason: "unsupported_type",
      message: `Content type ${contentType} is not allowed.`,
    };
  }
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > maxBytes) {
    return {
      ok: false,
      reason: "too_large",
      message: `Upload exceeds the ${maxBytes}-byte limit.`,
    };
  }
  return { ok: true };
}

/** Sanitise a filename to a safe object-key segment. */
function safeName(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? "video";
  return base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 128) || "video";
}

/**
 * Build the tenant-namespaced object key. Per-tenant prefix is the storage
 * isolation boundary (`t/{tenantId}/video/{id}/{filename}`). Distinct from the
 * content service's `content/` prefix so the two surfaces never collide.
 */
export function videoBlobKey(
  tenantId: string,
  id: string,
  filename: string,
): string {
  return `t/${tenantId}/video/${id}/${safeName(filename)}`;
}
