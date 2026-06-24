/**
 * Direct-to-Blob upload support. The gateway/UI asks for a signed upload URL,
 * uploads the bytes straight to object storage, then creates a `file` topic
 * referencing the returned blob URL.
 *
 * The {@link BlobSigner} seam keeps storage pluggable: production uses Vercel
 * Blob; dev/test use {@link DevBlobSigner}. Keys are namespaced by tenant so
 * one tenant's objects can never collide with another's.
 */

/** Default allow-list of uploadable content types. */
export const ALLOWED_CONTENT_TYPES = new Set<string>([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/zip", // SCORM packages
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "video/mp4",
  "audio/mpeg",
  "text/plain",
]);

/** Default max upload size (250 MB). Per-plan limits are a follow-up. */
export const DEFAULT_MAX_UPLOAD_BYTES = 250 * 1024 * 1024;

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
  const base = filename.split(/[\\/]/).pop() ?? "file";
  return base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 128) || "file";
}

/**
 * Build the tenant-namespaced object key. Per-tenant prefix is the storage
 * isolation boundary (`t/{tenantId}/content/{id}/{filename}`).
 */
export function blobKey(
  tenantId: string,
  id: string,
  filename: string,
): string {
  return `t/${tenantId}/content/${id}/${safeName(filename)}`;
}
