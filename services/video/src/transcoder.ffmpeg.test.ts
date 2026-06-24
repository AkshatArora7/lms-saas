import type { AppConfig } from "@lms/config";
import { describe, expect, it } from "vitest";

import { makeTranscoder } from "./main.js";
import {
  artifactKeyPrefix,
  buildMasterPlaylist,
  FfmpegTranscoder,
  FULL_LADDER,
  selectLadder,
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
