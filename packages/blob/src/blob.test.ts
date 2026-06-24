import type { AppConfig } from "@lms/config";
import { describe, expect, it } from "vitest";

import {
  DevBlobSigner,
  VercelBlobSigner,
  makeBlobSigner,
  putObject,
  vercelStoreId,
} from "./index.js";

/** Minimal AppConfig stub — only the field the blob layer reads. */
function configWith(token?: string): AppConfig {
  return { BLOB_READ_WRITE_TOKEN: token } as unknown as AppConfig;
}

describe("makeBlobSigner", () => {
  it("returns a DevBlobSigner when no token is configured", () => {
    expect(makeBlobSigner(configWith(undefined))).toBeInstanceOf(DevBlobSigner);
  });

  it("returns a VercelBlobSigner when a token is configured", () => {
    const signer = makeBlobSigner(configWith("vercel_blob_rw_store123_secret"));
    expect(signer).toBeInstanceOf(VercelBlobSigner);
  });
});

describe("DevBlobSigner.sign", () => {
  it("produces a well-formed { key, uploadUrl, blobUrl }", () => {
    const key = "t/tenant-a/content/abc/file.pdf";
    const result = new DevBlobSigner().sign(key, "application/pdf");
    expect(result.key).toBe(key);
    expect(result.blobUrl).toBe(`https://blob.local/${key}`);
    expect(result.uploadUrl).toBe(`https://blob.local/${key}?upload=1`);
  });
});

describe("VercelBlobSigner.sign", () => {
  it("derives the public host from the token store id (pure, no network)", () => {
    const key = "t/tenant-a/video/abc/lecture.mp4";
    const signer = new VercelBlobSigner("vercel_blob_rw_storeXYZ_secret");
    const result = signer.sign(key, "video/mp4");
    expect(result.key).toBe(key);
    expect(result.blobUrl).toBe(
      `https://storeXYZ.public.blob.vercel-storage.com/${key}`,
    );
    expect(result.uploadUrl).toBe("https://blob.vercel-storage.com");
  });

  it("falls back to the bare public host for a malformed token", () => {
    const result = new VercelBlobSigner("not-a-vercel-token").sign(
      "t/x/content/y/z.png",
      "image/png",
    );
    expect(result.blobUrl).toBe(
      "https://public.blob.vercel-storage.com/t/x/content/y/z.png",
    );
  });
});

describe("vercelStoreId", () => {
  it("extracts the store id from a read-write token", () => {
    expect(vercelStoreId("vercel_blob_rw_abc123_secret")).toBe("abc123");
  });

  it("returns undefined for a malformed token", () => {
    expect(vercelStoreId("garbage")).toBeUndefined();
  });
});

describe("putObject", () => {
  it("throws a clear error when no token is configured", async () => {
    await expect(
      putObject(configWith(undefined), "t/x/k", "data", "text/plain"),
    ).rejects.toThrow(/BLOB_READ_WRITE_TOKEN/);
  });
});
