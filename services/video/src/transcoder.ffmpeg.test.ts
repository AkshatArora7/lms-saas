import type { AppConfig } from "@lms/config";
import { describe, expect, it } from "vitest";

import { makeTranscoder } from "./main.js";
import {
  artifactKeyPrefix,
  buildMasterPlaylist,
  FfmpegTranscoder,
  FULL_LADDER,
  selectLadder,
  tenantArtifactKeyPrefix,
  type LadderRung,
} from "./transcoder.ffmpeg.js";
import { StubTranscoder } from "./transcoder.js";

function config(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    TENANT_MODE: "hybrid",
    DEFAULT_TENANT_TIER: "pool",
    DATABASE_URL: "postgres://user:pass@localhost:5432/lms_test",
    VIDEO_TRANSCODER: "stub",
    ...overrides,
  } as unknown as AppConfig;
}

describe("makeTranscoder selection", () => {
  it("defaults to the offline StubTranscoder", () => {
    expect(makeTranscoder(config())).toBeInstanceOf(StubTranscoder);
  });

  it("selects the FfmpegTranscoder when VIDEO_TRANSCODER=ffmpeg", () => {
    const t = makeTranscoder(config({ VIDEO_TRANSCODER: "ffmpeg" }));
    expect(t).toBeInstanceOf(FfmpegTranscoder);
  });

  it("constructing the FfmpegTranscoder pulls no FFmpeg binary (no throw)", () => {
    // The bundled binaries are imported lazily inside transcode(); merely
    // constructing must be inert so importing/booting needs nothing.
    expect(() => new FfmpegTranscoder(config())).not.toThrow();
  });
});

describe("selectLadder", () => {
  it("keeps only rungs at or below the source height (never upscales)", () => {
    expect(selectLadder(720).map((r) => r.quality)).toEqual(["480p", "720p"]);
  });

  it("includes all rungs for a 1080p+ source", () => {
    expect(selectLadder(1080).map((r) => r.quality)).toEqual([
      "480p",
      "720p",
      "1080p",
    ]);
    expect(selectLadder(2160).map((r) => r.quality)).toEqual([
      "480p",
      "720p",
      "1080p",
    ]);
  });

  it("keeps at least the lowest rung for a tiny source", () => {
    expect(selectLadder(240).map((r) => r.quality)).toEqual(["480p"]);
  });

  it("falls back to the lowest rung for unknown/zero/NaN height", () => {
    expect(selectLadder(0).map((r) => r.quality)).toEqual(["480p"]);
    expect(selectLadder(-1).map((r) => r.quality)).toEqual(["480p"]);
    expect(selectLadder(Number.NaN).map((r) => r.quality)).toEqual(["480p"]);
  });
});

describe("artifactKeyPrefix (tenant isolation boundary)", () => {
  const TENANT = "11111111-1111-1111-1111-111111111111";
  const ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

  it("derives the tenant-namespaced key prefix from a full blob URL", () => {
    const url = `https://store.public.blob.vercel-storage.com/t/${TENANT}/video/${ID}/lecture.mp4`;
    expect(artifactKeyPrefix(url)).toBe(`t/${TENANT}/video/${ID}`);
  });

  it("keeps artifacts strictly under the source tenant prefix", () => {
    const url = `https://blob.local/t/${TENANT}/video/${ID}/lecture-01.mp4`;
    const prefix = artifactKeyPrefix(url);
    expect(prefix.startsWith(`t/${TENANT}/video/`)).toBe(true);
    expect(`${prefix}/480p.m3u8`).toBe(`t/${TENANT}/video/${ID}/480p.m3u8`);
    expect(`${prefix}/master.m3u8`).toBe(
      `t/${TENANT}/video/${ID}/master.m3u8`,
    );
  });

  it("strips query/fragment and handles a bare key", () => {
    expect(artifactKeyPrefix("t/x/video/y/v.mp4?sig=abc#frag")).toBe(
      "t/x/video/y",
    );
    expect(artifactKeyPrefix("v.mp4")).toBe("");
  });
});

describe("tenantArtifactKeyPrefix (trusted write-key isolation)", () => {
  const CALLER = "11111111-1111-1111-1111-111111111111";
  const VICTIM = "22222222-2222-2222-2222-222222222222";
  const ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

  it("derives the write prefix from the trusted tenantId + id", () => {
    expect(tenantArtifactKeyPrefix(CALLER, ID)).toBe(
      `t/${CALLER}/video/${ID}`,
    );
  });

  it("ignores a cross-tenant sourceBlobUrl — writes stay under the caller's prefix", () => {
    // An attacker in CALLER creates a video whose source URL points at the
    // VICTIM tenant's storage prefix (and even uses path traversal). The write
    // key MUST be bound to the caller's own tenantId/id, never the URL.
    const adversarialSourceUrls = [
      `https://blob.local/t/${VICTIM}/video/evil/x.mp4`,
      `https://blob.local/t/${CALLER}/video/${ID}/../../t/${VICTIM}/x.mp4`,
      `https://attacker.example/anything/at/all/x.mp4`,
    ];
    const prefix = tenantArtifactKeyPrefix(CALLER, ID);
    expect(prefix).toBe(`t/${CALLER}/video/${ID}`);
    for (const sourceUrl of adversarialSourceUrls) {
      // The URL-derived prefix (the OLD, vulnerable derivation) leaks the
      // victim tenant / escapes the caller's namespace — proving the URL is
      // untrustworthy as a write key.
      const urlPrefix = artifactKeyPrefix(sourceUrl);
      const urlPrefixEscapes =
        urlPrefix.includes(VICTIM) ||
        urlPrefix.includes("..") ||
        !urlPrefix.startsWith(`t/${CALLER}/`);
      expect(urlPrefixEscapes).toBe(true);
      // … but the trusted prefix (what the transcoder actually keys on) is
      // bound to the caller's identity and never references the victim.
      const artifactKey = `${prefix}/master.m3u8`;
      expect(artifactKey).toBe(`t/${CALLER}/video/${ID}/master.m3u8`);
      expect(artifactKey.startsWith(`t/${CALLER}/video/${ID}/`)).toBe(true);
      expect(artifactKey.includes(VICTIM)).toBe(false);
      expect(artifactKey.includes("..")).toBe(false);
    }
  });
});

describe("buildMasterPlaylist", () => {
  it("emits a valid master with one stream-inf per variant, ordered low→high", () => {
    const variants: Array<{ rung: LadderRung; manifestName: string }> = [
      { rung: FULL_LADDER[0]!, manifestName: "480p.m3u8" },
      { rung: FULL_LADDER[1]!, manifestName: "720p.m3u8" },
    ];
    const master = buildMasterPlaylist(variants);
    expect(master.startsWith("#EXTM3U\n#EXT-X-VERSION:3")).toBe(true);
    expect(master).toContain("RESOLUTION=853x480");
    expect(master).toContain("BANDWIDTH=1400000,");
    expect(master).toContain("\n480p.m3u8\n");
    expect(master).toContain("RESOLUTION=1280x720");
    expect(master).toContain("\n720p.m3u8\n");
    // Two variants → two STREAM-INF lines.
    expect(master.match(/#EXT-X-STREAM-INF/g)).toHaveLength(2);
  });
});
