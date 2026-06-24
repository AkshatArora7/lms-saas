/**
 * Shared object-storage layer for the LMS. Both the content and video services
 * upload large files (documents, lecture videos) directly to object storage and
 * persist the returned public URL on a row.
 *
 * Two distinct paths live here behind one secret-touching package:
 *
 *  - {@link BlobSigner} — the **synchronous** "hand the client a URL" seam. The
 *    gateway/UI asks for a signed upload, then the browser PUTs the bytes
 *    straight to storage. {@link DevBlobSigner} is the offline default;
 *    {@link VercelBlobSigner} is the production impl. {@link makeBlobSigner}
 *    selects between them on whether `config.BLOB_READ_WRITE_TOKEN` is set —
 *    mirroring `services/ai/src/chat.ts` `makeChatModel`.
 *  - {@link putObject} — the **async** server-side WRITE path (`@vercel/blob`
 *    `put()`), used by the transcoder/captioner workers (#315/#316) to upload
 *    generated artifacts (renditions, caption tracks) with the bytes in hand.
 *
 * The `@vercel/blob` SDK is imported **lazily** inside the methods (dynamic
 * `import()`), exactly like `groqChatModel`'s lazy `groq-sdk` import, so
 * importing this module never pulls the SDK and the offline path needs no token,
 * SDK, or network at load/boot/test time. The token is read ONLY from the
 * validated {@link AppConfig}, never from raw `process.env`, and never logged.
 */
import type { AppConfig } from "@lms/config";

/** A signed direct-to-storage upload handed to the client. */
export interface SignedUpload {
  /** Tenant-namespaced object key. */
  key: string;
  /** URL the client uploads the bytes to. */
  uploadUrl: string;
  /** Stable public URL the object will be served from (stored on the row). */
  blobUrl: string;
}

/**
 * The storage seam. `sign()` is **synchronous and never touches the network**:
 * it returns the deterministic upload coordinates for `key`. Production
 * ({@link VercelBlobSigner}) and dev ({@link DevBlobSigner}) share this shape so
 * callers (routes/store) are agnostic to the backing store.
 */
export interface BlobSigner {
  sign(key: string, contentType: string): SignedUpload;
}

/**
 * Deterministic dev/test signer. Returns a fake but well-formed signed URL so
 * the upload flow is exercisable without real object storage or a token.
 */
export class DevBlobSigner implements BlobSigner {
  constructor(private readonly baseUrl: string = "https://blob.local") {}
  sign(key: string, _contentType: string): SignedUpload {
    const blobUrl = `${this.baseUrl}/${key}`;
    return { key, uploadUrl: `${blobUrl}?upload=1`, blobUrl };
  }
}

/** Public host bytes are served from for a given Vercel Blob store. */
const VERCEL_BLOB_HOST_SUFFIX = "public.blob.vercel-storage.com";
/** Vercel's client-upload endpoint the browser SDK posts to. */
const VERCEL_CLIENT_UPLOAD_URL = "https://blob.vercel-storage.com";

/**
 * Extract the store id embedded in a `BLOB_READ_WRITE_TOKEN`. The token format
 * is `vercel_blob_rw_<storeId>_<random>`, so the store id — and therefore the
 * stable public host — is derivable as a **pure string parse**, no network. If
 * the token does not match the expected shape we fall back to the bare public
 * host (the object still resolves via the store the token is scoped to).
 */
export function vercelStoreId(token: string): string | undefined {
  const match = /^vercel_blob_rw_([A-Za-z0-9]+)_/.exec(token);
  return match?.[1];
}

/**
 * Production signer backed by Vercel Blob. `sign()` stays **synchronous**: it
 * derives the stable public `blobUrl` from the store id encoded in the
 * read-write token (a pure parse) and points `uploadUrl` at Vercel's
 * client-upload endpoint. The short-lived client token used by the browser SDK
 * is minted server-side by the client-upload route (`@vercel/blob/client`
 * `handleUpload`) — that mint is async in `@vercel/blob` and is intentionally
 * NOT performed here so the seam contract remains synchronous (see handshake
 * §4 / §6: `generateClientTokenFromReadWriteToken` returns a `Promise` in the
 * pinned version, so it cannot run inside `sign()`).
 *
 * `@vercel/blob` is never imported by `sign()` itself — `sign()` does only pure
 * string work — so this class adds no load-time SDK cost; the SDK is pulled
 * lazily only by {@link putObject}'s server-side write path.
 */
export class VercelBlobSigner implements BlobSigner {
  private readonly host: string;
  constructor(token: string) {
    const storeId = vercelStoreId(token);
    this.host = storeId
      ? `${storeId}.${VERCEL_BLOB_HOST_SUFFIX}`
      : VERCEL_BLOB_HOST_SUFFIX;
  }
  sign(key: string, _contentType: string): SignedUpload {
    const blobUrl = `https://${this.host}/${key}`;
    return { key, uploadUrl: VERCEL_CLIENT_UPLOAD_URL, blobUrl };
  }
}

/**
 * Default blob signer: {@link VercelBlobSigner} when `BLOB_READ_WRITE_TOKEN` is
 * configured, else the offline {@link DevBlobSigner} — so the service boots and
 * tests pass with no token/network. Mirrors `makeChatModel(config)`.
 */
export function makeBlobSigner(config: AppConfig): BlobSigner {
  return config.BLOB_READ_WRITE_TOKEN
    ? new VercelBlobSigner(config.BLOB_READ_WRITE_TOKEN)
    : new DevBlobSigner();
}

/**
 * Server-side artifact WRITE path. Streams `body` straight to Vercel Blob via
 * `put()` and returns the stable public URL. Token-gated: throws a clear error
 * when `BLOB_READ_WRITE_TOKEN` is unset, because the workers that call this
 * (transcoder #315 / captioner #316) only run on the env-gated production path.
 * The `@vercel/blob` import is lazy so importing this module pulls no SDK.
 */
export async function putObject(
  config: AppConfig,
  key: string,
  body: string | Buffer | ArrayBuffer | Blob,
  contentType: string,
): Promise<{ url: string }> {
  const token = config.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new Error(
      "putObject requires BLOB_READ_WRITE_TOKEN; the blob write path is only available on the production storage env.",
    );
  }
  const { put } = await import("@vercel/blob");
  const result = await put(key, body, {
    access: "public",
    token,
    contentType,
    addRandomSuffix: false,
  });
  return { url: result.url };
}
