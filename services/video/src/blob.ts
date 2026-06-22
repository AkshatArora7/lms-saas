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

export interface SignedUpload {
  /** Tenant-namespaced object key. */
  key: string;
  /** URL the client PUTs the bytes to. */
  uploadUrl: string;
  /** Stable URL the object will be served from (stored on the asset). */
  blobUrl: string;
}

export interface BlobSigner {
  sign(key: string, contentType: string): SignedUpload;
}

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

/**
 * Deterministic dev/test signer. Returns a fake but well-formed signed URL so
 * the upload flow is exercisable without real object storage. Production swaps
 * in a Vercel Blob signer behind the same interface.
 */
export class DevBlobSigner implements BlobSigner {
  constructor(private readonly baseUrl: string = "https://blob.local") {}
  sign(key: string, _contentType: string): SignedUpload {
    const blobUrl = `${this.baseUrl}/${key}`;
    return { key, uploadUrl: `${blobUrl}?upload=1`, blobUrl };
  }
}
