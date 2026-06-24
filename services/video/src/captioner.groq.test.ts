import type { AppConfig } from "@lms/config";
import { describe, expect, it } from "vitest";

import { StubCaptioner } from "./captioner.js";
import {
  captionKey,
  GroqCaptioner,
  tenantCaptionKey,
} from "./captioner.groq.js";
import { makeCaptioner } from "./main.js";

/**
 * Unit tests for the ASR captioner wiring (#316). These NEVER call Groq, run
 * FFmpeg, or touch the network: they assert pure key derivation and the
 * `makeCaptioner` selection by inspecting the constructed class only.
 */

function cfg(overrides: Partial<AppConfig>): AppConfig {
  return {
    VIDEO_CAPTIONER: "stub",
    VIDEO_WHISPER_MODEL: "whisper-large-v3",
    ...overrides,
  } as unknown as AppConfig;
}

describe("captionKey", () => {
  it("derives a tenant-namespaced VTT key under the asset prefix", () => {
    const url =
      "https://blob.local/t/11111111-1111-1111-1111-111111111111/video/abc/lecture.mp4";
    expect(captionKey(url)).toBe(
      "t/11111111-1111-1111-1111-111111111111/video/abc/captions/en.vtt",
    );
  });

  it("keeps the t/{tenantId} prefix so the key cannot escape the tenant", () => {
    const tenant = "22222222-2222-2222-2222-222222222222";
    const url = `https://store.public.blob.vercel-storage.com/t/${tenant}/video/xyz/clip.mov`;
    const key = captionKey(url);
    expect(key.startsWith(`t/${tenant}/`)).toBe(true);
    expect(key).toBe(`t/${tenant}/video/xyz/captions/en.vtt`);
    // No scheme/host leaks into the store-relative key.
    expect(key).not.toContain("://");
    expect(key).not.toContain("vercel-storage");
  });
});

describe("tenantCaptionKey (trusted write-key isolation)", () => {
  const CALLER = "11111111-1111-1111-1111-111111111111";
  const VICTIM = "99999999-9999-9999-9999-999999999999";
  const ID = "asset-abc";

  it("derives the write key purely from trusted tenantId + id", () => {
    expect(tenantCaptionKey(CALLER, ID)).toBe(
      `t/${CALLER}/video/${ID}/captions/en.vtt`,
    );
  });

  it("stays under the caller's tenant prefix for hostile sourceBlobUrls", () => {
    // Three adversarial URLs a tenant-A caller could POST trying to redirect
    // the VTT write into the victim's prefix. The write key MUST ignore them.
    const hostile = [
      // 1. Victim-prefix injection.
      `https://blob.local/t/${VICTIM}/video/evil/x.mp4`,
      // 2. Path traversal out of the caller prefix into the victim's.
      `https://blob.local/t/${CALLER}/video/${ID}/../../../t/${VICTIM}/video/evil/x.mp4`,
      // 3. Foreign host entirely.
      `https://evil.example.com/t/${VICTIM}/video/evil/x.mp4`,
    ];

    for (const url of hostile) {
      // Sanity: the retired URL-parsing helper WOULD have leaked the victim
      // prefix — this is exactly the flaw the write path no longer uses.
      expect(captionKey(url)).toContain(VICTIM);

      // The trusted write key is computed from caller identity only and is
      // immune to whatever the hostile URL encodes.
      const key = tenantCaptionKey(CALLER, ID);
      expect(key).toBe(`t/${CALLER}/video/${ID}/captions/en.vtt`);
      expect(key.startsWith(`t/${CALLER}/video/${ID}/`)).toBe(true);
      expect(key).not.toContain(VICTIM);
      expect(key).not.toContain("..");
      expect(key).not.toContain("://");
      expect(key).not.toContain("evil");
    }
  });
});

describe("makeCaptioner", () => {
  it("defaults to the offline StubCaptioner", () => {
    expect(makeCaptioner(cfg({}))).toBeInstanceOf(StubCaptioner);
  });

  it("stays on the stub when groq is selected but no key is set", () => {
    expect(makeCaptioner(cfg({ VIDEO_CAPTIONER: "groq" }))).toBeInstanceOf(
      StubCaptioner,
    );
  });

  it("stays on the stub when a key is set but the flag is not groq", () => {
    expect(
      makeCaptioner(cfg({ GROQ_API_KEY: "test-key" })),
    ).toBeInstanceOf(StubCaptioner);
  });

  it("selects GroqCaptioner only when flag=groq AND key is set", () => {
    expect(
      makeCaptioner(cfg({ VIDEO_CAPTIONER: "groq", GROQ_API_KEY: "test-key" })),
    ).toBeInstanceOf(GroqCaptioner);
  });
});
