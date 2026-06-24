"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type ReactElement,
} from "react";
import { Alert, Card, Chip, EmptyState, ProgressBar, Spinner, Stack } from "@lms/ui";

import type { VideoRecord, VideoStatus } from "../../../lib/video-api";
import {
  formatDuration,
  isTerminalStatus,
  videoStatusView,
} from "../../../lib/video-status";

/**
 * Teacher video uploader + live library (#320, client island).
 *
 * Flow (server-trusted identity stamped by the BFF route handlers):
 *   1. POST /api/video/uploads { filename, contentType, sizeBytes } -> SignedUpload
 *   2. PUT the bytes to upload.uploadUrl (browser → Blob direct, XHR for progress)
 *   3. POST /api/video/videos { title, sourceBlobUrl: blobUrl, courseId } -> VideoRecord
 *   4. Poll GET /api/video/videos/:id until status is terminal (ready|failed)
 *
 * NOTE (#317 §6, deferred): the signed PUT here works against the DevBlobSigner
 * contract (a plain PUT to uploadUrl). The production Vercel client-upload uses
 * an async client-token via @vercel/blob; that is a FUTURE wiring point IF the
 * uploadUrl semantics require the client SDK — it is intentionally NOT
 * implemented now (deferred per #317).
 *
 * All states from the ux JSON: idle/dragover/selecting/invalid-type/uploading/
 * creating/transcoding/ready/failed/offline + permission gate (handled by the
 * RSC). Status is conveyed by TEXT + tone; progress + status are announced via
 * aria-live=polite; controls are 44px and keyboard-operable; reduced-motion
 * honored. Mobile-first, no horizontal overflow at 360px.
 */

const ACCEPTED_TYPES = [
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-matroska",
];
const ACCEPT_ATTR = ACCEPTED_TYPES.join(",");
const ACCEPTED_EXT = [".mp4", ".webm", ".mov", ".mkv"];

const POLL_FAST_MS = 3000;
const POLL_SLOW_MS = 8000;
const POLL_BACKOFF_AFTER_MS = 30000;
const POLL_CAP_MS = 10 * 60 * 1000;

type Phase =
  | "idle"
  | "uploading"
  | "creating"
  | "tracking"
  | "ready"
  | "error";

function isAcceptedFile(file: File): boolean {
  if (file.type && ACCEPTED_TYPES.includes(file.type)) return true;
  const name = file.name.toLowerCase();
  return ACCEPTED_EXT.some((ext) => name.endsWith(ext));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[i]}`;
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

const css = `
.vid-mgr { display: flex; flex-direction: column; gap: var(--lms-space-5); }
.vid-card { display: flex; flex-direction: column; gap: var(--lms-space-4); padding: var(--lms-space-4); }
.vid-heading { font-size: 1.15rem; font-weight: 700; margin: 0; }
.vid-section-heading { font-size: 1.15rem; font-weight: 700; margin: 0; }
.vid-drop {
  display: flex; flex-direction: column; gap: var(--lms-space-2);
  align-items: center; justify-content: center; text-align: center;
  min-height: 140px; padding: var(--lms-space-5);
  border: 2px dashed var(--lms-border-strong);
  border-radius: var(--lms-radius-md);
  background: var(--lms-surface-2);
  cursor: pointer; color: var(--lms-text-muted);
  transition: border-color .15s ease, background .15s ease;
  width: 100%; box-sizing: border-box; min-width: 0;
}
.vid-drop:hover { border-color: var(--lms-accent); }
.vid-drop--over { border-color: var(--lms-accent); background: var(--lms-surface); }
.vid-drop input { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.vid-drop:focus-within { outline: 3px solid var(--lms-focus); outline-offset: 2px; }
.vid-drop svg { color: var(--lms-text-subtle); }
.vid-drop__primary { font-weight: 600; color: var(--lms-text); }
.vid-drop__secondary { font-size: .85rem; }
.vid-file-row {
  display: flex; flex-wrap: wrap; align-items: center; gap: var(--lms-space-2) var(--lms-space-3);
  padding: var(--lms-space-3); border: 1px solid var(--lms-border); border-radius: var(--lms-radius-sm);
  background: var(--lms-surface-2); min-width: 0;
}
.vid-file-name { font-weight: 600; overflow-wrap: anywhere; min-width: 0; flex: 1; }
.vid-file-size { color: var(--lms-text-muted); font-size: .85rem; white-space: nowrap; }
.vid-field { display: flex; flex-direction: column; gap: var(--lms-space-1); }
.vid-field label { font-weight: 600; font-size: .9rem; }
.vid-field .lms-input { max-width: 100%; box-sizing: border-box; }
.vid-field__help { color: var(--lms-text-muted); font-size: .8rem; }
.vid-field__error { color: var(--lms-danger); font-size: .8rem; }
.vid-actions { display: flex; flex-wrap: wrap; gap: var(--lms-space-2); }
.vid-status { display: flex; flex-direction: column; gap: var(--lms-space-2); min-height: 1.2em; }
.vid-status__row { display: flex; align-items: center; gap: var(--lms-space-2); color: var(--lms-text-muted); font-size: .9rem; }
.vid-ghost {
  background: transparent; border: 1px solid var(--lms-border); border-radius: var(--lms-radius-sm);
  color: var(--lms-text); font: inherit; font-weight: 600; cursor: pointer;
  min-height: 44px; padding: 0 var(--lms-space-3);
}
.vid-ghost:focus-visible { outline: 3px solid var(--lms-focus); outline-offset: 2px; }
.vid-grid { display: grid; grid-template-columns: 1fr; gap: var(--lms-space-4); list-style: none; margin: 0; padding: 0; }
@media (min-width: 601px) { .vid-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (min-width: 1025px) { .vid-grid { grid-template-columns: repeat(auto-fill, minmax(min(100%, 240px), 1fr)); } }
.vid-lib-card { display: flex; flex-direction: column; gap: var(--lms-space-3); padding: var(--lms-space-3); height: 100%; min-width: 0; }
.vid-thumb {
  aspect-ratio: 16 / 9; width: 100%; border-radius: var(--lms-radius-sm);
  background: var(--lms-surface-2); display: flex; align-items: center; justify-content: center;
  color: var(--lms-text-subtle); overflow: hidden;
}
.vid-thumb img { width: 100%; height: 100%; object-fit: cover; }
.vid-lib-title { font-weight: 600; overflow-wrap: anywhere; margin: 0; min-width: 0; }
.vid-lib-meta { color: var(--lms-text-muted); font-size: .85rem; margin: 0; overflow-wrap: anywhere; }
.vid-lib-foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--lms-space-2); margin-top: auto; }
.vid-lib-link {
  display: inline-flex; align-items: center; min-height: 44px; padding: 0 var(--lms-space-3);
  border-radius: var(--lms-radius-sm); background: var(--lms-accent); color: #fff;
  font-weight: 600; text-decoration: none;
}
.vid-lib-link:focus-visible { outline: 3px solid var(--lms-focus); outline-offset: 2px; }
.vid-lib-muted { color: var(--lms-text-muted); font-size: .85rem; }
@media (prefers-reduced-motion: reduce) {
  .vid-drop { transition: none; }
}
`;

const UPLOAD_ICON = (
  <svg
    aria-hidden="true"
    fill="none"
    height="40"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth={1.6}
    viewBox="0 0 24 24"
    width="40"
  >
    <path d="M12 16V4" />
    <path d="m7 9 5-5 5 5" />
    <path d="M5 16v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2" />
  </svg>
);

const FILM_ICON = (
  <svg
    aria-hidden="true"
    fill="none"
    height="32"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth={1.6}
    viewBox="0 0 24 24"
    width="32"
  >
    <rect height="18" rx="2" width="18" x="3" y="3" />
    <path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4" />
  </svg>
);

interface CourseVideosManagerProps {
  courseId: string;
  initialVideos: VideoRecord[];
}

export default function CourseVideosManager({
  courseId,
  initialVideos,
}: CourseVideosManagerProps): ReactElement {
  const titleId = useId();
  const statusRegionId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const [videos, setVideos] = useState<VideoRecord[]>(initialVideos);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [typeError, setTypeError] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  // ── Live polling for any non-terminal library card ────────────────────────
  const pollStartRef = useRef<number>(0);
  useEffect(() => {
    const pending = videos.filter((v) => !isTerminalStatus(v.status));
    if (pending.length === 0) return;
    if (pollStartRef.current === 0) pollStartRef.current = Date.now();

    let cancelled = false;
    const elapsed = Date.now() - pollStartRef.current;
    if (elapsed > POLL_CAP_MS) return; // give up; cards keep last-known status
    const interval =
      elapsed > POLL_BACKOFF_AFTER_MS ? POLL_SLOW_MS : POLL_FAST_MS;

    const timer = window.setTimeout(async () => {
      if (document.visibilityState === "hidden") return; // resume on focus
      const updated = await Promise.all(
        pending.map(async (v) => {
          try {
            const res = await fetch(`/api/video/videos/${v.id}`, {
              cache: "no-store",
            });
            if (!res.ok) return v; // keep last-known on transient error
            const data = (await res.json()) as { video: VideoRecord };
            return data.video ?? v;
          } catch {
            return v;
          }
        }),
      );
      if (cancelled) return;
      setVideos((prev) =>
        prev.map((v) => updated.find((u) => u.id === v.id) ?? v),
      );
    }, interval);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [videos]);

  // Resume polling when the tab becomes visible again.
  useEffect(() => {
    const onVisible = (): void => {
      if (document.visibilityState === "visible") {
        setVideos((prev) => [...prev]); // re-trigger the poll effect
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  const selectFile = useCallback((picked: File | null): void => {
    setError("");
    setTypeError("");
    if (!picked) {
      setFile(null);
      return;
    }
    if (!isAcceptedFile(picked)) {
      setFile(null);
      setTypeError(
        "That file type isn't supported. Choose an MP4, WebM, MOV, or MKV video.",
      );
      inputRef.current?.focus();
      return;
    }
    setFile(picked);
    if (title.trim() === "") {
      setTitle(picked.name.replace(/\.[^.]+$/, ""));
    }
  }, [title]);

  function onInputChange(e: ChangeEvent<HTMLInputElement>): void {
    selectFile(e.target.files?.[0] ?? null);
  }

  function onDrop(e: DragEvent<HTMLLabelElement>): void {
    e.preventDefault();
    setDragOver(false);
    selectFile(e.dataTransfer.files?.[0] ?? null);
  }

  function clearFile(): void {
    setFile(null);
    setTypeError("");
    if (inputRef.current) inputRef.current.value = "";
  }

  // PUT the bytes to Blob with XHR so we get determinate upload progress.
  function putBytes(uploadUrl: string, body: File): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", uploadUrl, true);
      if (body.type) xhr.setRequestHeader("content-type", body.type);
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) {
          setProgress(Math.round((ev.loaded / ev.total) * 100));
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error(`Upload failed (${xhr.status}).`));
      };
      xhr.onerror = () => reject(new Error("Network error during upload."));
      xhr.send(body);
    });
  }

  async function upload(): Promise<void> {
    if (!file || title.trim() === "") return;
    setError("");
    setProgress(0);

    try {
      // 1. Signed upload (BFF stamps identity; service validates type/size).
      setPhase("uploading");
      setStatus("Preparing upload…");
      const signRes = await fetch("/api/video/uploads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type || "application/octet-stream",
          sizeBytes: file.size,
        }),
      });
      if (!signRes.ok) {
        const data = (await signRes.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(data.error ?? "Couldn't start the upload.");
      }
      const { upload: signed } = (await signRes.json()) as {
        upload: { key: string; uploadUrl: string; blobUrl: string };
      };

      // 2. PUT the bytes (browser → Blob direct).
      setStatus("Uploading…");
      await putBytes(signed.uploadUrl, file);

      // 3. Create the asset (BFF stamps owner identity).
      setPhase("creating");
      setStatus("Saving video…");
      const createRes = await fetch("/api/video/videos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          sourceBlobUrl: signed.blobUrl,
          courseId,
        }),
      });
      if (!createRes.ok) {
        const data = (await createRes.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(data.error ?? "Couldn't save the video.");
      }
      const { video } = (await createRes.json()) as { video: VideoRecord };

      // 4. Insert into the library; the poll effect tracks it to terminal.
      setVideos((prev) => [video, ...prev]);
      pollStartRef.current = 0;
      if (video.status === "ready") {
        setPhase("ready");
        setStatus("Your video is ready.");
      } else {
        setPhase("tracking");
        setStatus("Processing video…");
      }
      // Reset the form for the next upload but keep the success status visible.
      clearFile();
      setTitle("");
      setProgress(0);
    } catch (err) {
      setPhase("error");
      setStatus("");
      setError(
        err instanceof Error ? err.message : "Something went wrong. Try again.",
      );
    }
  }

  async function retry(id: string): Promise<void> {
    setVideos((prev) =>
      prev.map((v) =>
        v.id === id ? { ...v, status: "transcoding" as VideoStatus } : v,
      ),
    );
    pollStartRef.current = 0;
    try {
      const res = await fetch(`/api/video/videos/${id}/transcode`, {
        method: "POST",
      });
      if (res.ok) {
        const data = (await res.json()) as { video: VideoRecord };
        setVideos((prev) => prev.map((v) => (v.id === id ? data.video : v)));
      }
    } catch {
      /* poll effect keeps last-known status; transient errors don't flip UI */
    }
  }

  const canUpload =
    !!file && title.trim() !== "" && phase !== "uploading" && phase !== "creating";
  const busy = phase === "uploading" || phase === "creating";

  return (
    <div className="vid-mgr">
      <style>{css}</style>

      {/* ── Uploader ─────────────────────────────────────────────────────── */}
      <Card className="vid-card">
        <h2 className="vid-heading">Add a video</h2>

        <label
          className={`vid-drop${dragOver ? " vid-drop--over" : ""}`}
          onDragEnter={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
        >
          <input
            accept={ACCEPT_ATTR}
            aria-label="Choose a video file"
            disabled={busy}
            onChange={onInputChange}
            ref={inputRef}
            type="file"
          />
          {UPLOAD_ICON}
          <span className="vid-drop__primary">
            Drag a video here or choose a file
          </span>
          <span className="vid-drop__secondary">MP4, WebM, MOV or MKV</span>
        </label>

        {typeError ? <Alert tone="danger">{typeError}</Alert> : null}

        {file ? (
          <div className="vid-file-row">
            <span className="vid-file-name">{file.name}</span>
            <span className="vid-file-size">{formatBytes(file.size)}</span>
            <button
              className="vid-ghost"
              disabled={busy}
              onClick={clearFile}
              type="button"
            >
              Remove
            </button>
          </div>
        ) : null}

        <div className="vid-field">
          <label htmlFor={titleId}>Video title</label>
          <input
            className="lms-input"
            disabled={busy}
            id={titleId}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Week 3 — Cellular Respiration"
            type="text"
            value={title}
          />
          <span className="vid-field__help">
            Students see this name in the course.
          </span>
        </div>

        <div className="vid-actions">
          <button
            aria-busy={busy}
            className="lms-btn lms-btn--primary"
            disabled={!canUpload}
            onClick={upload}
            type="button"
          >
            {busy ? "Uploading…" : "Upload video"}
          </button>
        </div>

        <div
          aria-live="polite"
          className="vid-status"
          id={statusRegionId}
          role="status"
        >
          {phase === "uploading" ? (
            <ProgressBar
              label="Upload progress"
              max={100}
              value={progress}
            />
          ) : null}
          {busy || phase === "tracking" ? (
            <div className="vid-status__row">
              <Spinner size="sm" />
              <span>{status}</span>
            </div>
          ) : null}
          {phase === "ready" ? (
            <Alert tone="success">{status}</Alert>
          ) : null}
          {error ? (
            <Alert tone="danger">
              {error}{" "}
              <button
                className="vid-ghost"
                onClick={upload}
                type="button"
              >
                Retry upload
              </button>
            </Alert>
          ) : null}
        </div>
      </Card>

      {/* ── Library ──────────────────────────────────────────────────────── */}
      <section aria-labelledby="course-videos-heading">
        <Stack gap={3}>
          <h2 className="vid-section-heading" id="course-videos-heading">
            Course videos
          </h2>

          {videos.length === 0 ? (
            <EmptyState
              description="Upload your first video for this course."
              icon={FILM_ICON}
              title="No videos yet"
            />
          ) : (
            <ul aria-label="Course videos" className="vid-grid">
              {videos.map((video) => {
                const view = videoStatusView(video.status);
                return (
                  <li key={video.id}>
                    <Card className="vid-lib-card">
                      <div className="vid-thumb">{FILM_ICON}</div>
                      <p className="vid-lib-title">{video.title}</p>
                      <p className="vid-lib-meta">
                        {formatDuration(video.durationSeconds)} ·{" "}
                        {relativeTime(video.createdAt)}
                      </p>
                      <div className="vid-lib-foot">
                        <Chip tone={view.tone}>{view.label}</Chip>
                        {video.status === "ready" ? (
                          <a
                            className="vid-lib-link"
                            href={`/courses/${courseId}/videos/${video.id}`}
                          >
                            Preview
                          </a>
                        ) : video.status === "failed" ? (
                          <button
                            className="vid-ghost"
                            onClick={() => retry(video.id)}
                            type="button"
                          >
                            Retry processing
                          </button>
                        ) : (
                          <span className="vid-lib-muted">Processing…</span>
                        )}
                      </div>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </Stack>
      </section>
    </div>
  );
}
