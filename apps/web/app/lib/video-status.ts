import type { BadgeTone } from "@lms/ui";

import type { VideoStatus } from "./video-api";

/**
 * Shared, framework-agnostic helpers for presenting a video's status — kept in a
 * plain module (no "use client"/server marker) so both the teacher RSC page and
 * the client uploader/poller import the SAME mapping. Status is always conveyed
 * by TEXT + tone (never colour alone) for WCAG 2.2 AA.
 */

export interface StatusView {
  label: string;
  tone: BadgeTone;
}

/** Map a lifecycle status to a human label + a Badge tone. */
export function videoStatusView(status: VideoStatus): StatusView {
  switch (status) {
    case "ready":
      return { label: "Ready", tone: "success" };
    case "transcoding":
      return { label: "Processing", tone: "accent" };
    case "failed":
      return { label: "Processing failed", tone: "danger" };
    case "uploaded":
    default:
      return { label: "Uploaded", tone: "neutral" };
  }
}

/** Whether the status is terminal (polling can stop). */
export function isTerminalStatus(status: VideoStatus): boolean {
  return status === "ready" || status === "failed";
}

/** Format a duration in whole seconds as mm:ss (or h:mm:ss past an hour). */
export function formatDuration(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "—";
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number): string => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

/** Pick the master HLS rendition for playback, preferring `quality:"auto"`. */
export function pickHlsSource(
  renditions: { quality: string; url: string; type: string }[],
): string | null {
  const hls = renditions.filter((r) => r.type === "hls");
  const auto = hls.find((r) => r.quality === "auto");
  return (auto ?? hls[0] ?? renditions[0])?.url ?? null;
}
