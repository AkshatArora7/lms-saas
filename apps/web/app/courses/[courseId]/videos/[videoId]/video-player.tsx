"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { Alert, Spinner } from "@lms/ui";

import type { CaptionTrack } from "../../../../lib/video-api";

/**
 * Accessible HLS player (#320, client island).
 *
 * Playback strategy:
 *   - Safari/iOS plays HLS natively → set <video src> to the master .m3u8.
 *   - Other browsers lazy-load hls.js (dynamic import, so the ~chunk only loads
 *     on the player route) and attach it to the master URL.
 * Captions are NATIVE <track kind="subtitles"> per captions[] so screen readers
 * and OS caption styling work; default OFF but discoverable via an always-visible
 * CC control, with the chosen language persisted to localStorage.
 *
 * Controls are real <button>/<input type=range> (no div-buttons), each with an
 * accessible name + state (aria-pressed / aria-valuetext). Keyboard: Space/k
 * play-pause, ←/→ seek ±5s, ↑/↓ volume, m mute, c captions, f fullscreen. No
 * keyboard trap (Esc closes the menu / exits fullscreen). Controls auto-hide
 * only while playing with a pointer and never while a control is focused;
 * prefers-reduced-motion disables the fade. 44px touch targets throughout. The
 * 16:9 stage is width:100% so it never overflows at 360px.
 */

const STORAGE_KEY = "lms.video.captionLang";

const css = `
.vp-wrap { display: flex; flex-direction: column; gap: var(--lms-space-3); width: 100%; min-width: 0; }
.vp-stage {
  position: relative; width: 100%; box-sizing: border-box;
  aspect-ratio: 16 / 9; background: #000;
  border-radius: var(--lms-radius-md); overflow: hidden;
  margin-inline: auto;
}
@media (min-width: 1025px) { .vp-stage { max-width: 960px; } }
.vp-video { width: 100%; height: 100%; display: block; background: #000; }
.vp-video::cue { font-size: 1.1em; }
@media (max-width: 600px) { .vp-video::cue { font-size: 1.25em; } }
.vp-overlay {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,0,.45); color: #fff; padding: var(--lms-space-4);
}
.vp-overlay--error { background: rgba(0,0,0,.7); }
.vp-bigplay {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  background: transparent; border: none; cursor: pointer; color: #fff;
}
.vp-bigplay svg { width: 72px; height: 72px; filter: drop-shadow(0 1px 3px rgba(0,0,0,.6)); }
.vp-bigplay:focus-visible { outline: 3px solid var(--lms-focus); outline-offset: -6px; }
.vp-controls {
  position: absolute; left: 0; right: 0; bottom: 0;
  display: flex; flex-wrap: wrap; align-items: center; gap: var(--lms-space-2);
  padding: var(--lms-space-2) var(--lms-space-3);
  background: linear-gradient(transparent, rgba(0,0,0,.75));
  transition: opacity .2s ease;
}
.vp-controls--hidden { opacity: 0; pointer-events: none; }
@media (prefers-reduced-motion: reduce) {
  .vp-controls { transition: none; }
  .vp-controls--hidden { opacity: 1; pointer-events: auto; }
}
.vp-btn {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 44px; min-height: 44px; padding: 0 var(--lms-space-2);
  background: transparent; border: none; color: #fff; cursor: pointer;
  border-radius: var(--lms-radius-sm); font: inherit;
}
.vp-btn[aria-pressed="true"] { color: var(--lms-accent); }
.vp-btn:focus-visible { outline: 3px solid #fff; outline-offset: -2px; }
.vp-time { color: #fff; font-size: .85rem; white-space: nowrap; font-variant-numeric: tabular-nums; }
.vp-seek { flex: 1 1 120px; min-width: 80px; accent-color: var(--lms-accent); height: 44px; cursor: pointer; }
.vp-seek:focus-visible { outline: 3px solid #fff; outline-offset: 2px; }
.vp-vol { width: 80px; accent-color: var(--lms-accent); height: 44px; }
@media (max-width: 600px) { .vp-vol { display: none; } }
.vp-menu-wrap { position: relative; }
.vp-menu {
  position: absolute; bottom: calc(100% + 4px); right: 0; min-width: 160px;
  background: var(--lms-surface); color: var(--lms-text);
  border: 1px solid var(--lms-border); border-radius: var(--lms-radius-sm);
  box-shadow: var(--lms-shadow-md); padding: var(--lms-space-1); z-index: 100;
  list-style: none; margin: 0;
}
.vp-menu li { margin: 0; }
.vp-menu button {
  display: flex; align-items: center; gap: var(--lms-space-2); width: 100%;
  min-height: 44px; padding: 0 var(--lms-space-2); background: transparent;
  border: none; color: inherit; font: inherit; cursor: pointer; text-align: left;
  border-radius: var(--lms-radius-sm);
}
.vp-menu button:hover { background: var(--lms-surface-2); }
.vp-menu button:focus-visible { outline: 3px solid var(--lms-focus); outline-offset: -2px; }
.vp-menu button[aria-checked="true"] { font-weight: 700; color: var(--lms-accent); }
.vp-spacer { flex: 1 1 0; }
`;

function fmt(t: number): string {
  if (!Number.isFinite(t) || t < 0) return "0:00";
  const total = Math.floor(t);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number): string => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

const ICON = {
  play: <path d="M8 5v14l11-7z" />,
  pause: (
    <>
      <rect height="14" width="4" x="6" y="5" />
      <rect height="14" width="4" x="14" y="5" />
    </>
  ),
  volume: (
    <>
      <path d="M11 5 6 9H3v6h3l5 4z" />
      <path d="M16 9a4 4 0 0 1 0 6" />
    </>
  ),
  muted: (
    <>
      <path d="M11 5 6 9H3v6h3l5 4z" />
      <path d="m17 9 4 6M21 9l-4 6" />
    </>
  ),
  fullscreen: (
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
  ),
};

function Glyph({ children }: { children: ReactElement | ReactElement[] }): ReactElement {
  return (
    <svg
      aria-hidden="true"
      fill="currentColor"
      height="22"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={children === ICON.play || children === ICON.pause ? 0 : 1.8}
      viewBox="0 0 24 24"
      width="22"
    >
      {children}
    </svg>
  );
}

interface VideoPlayerProps {
  src: string;
  title: string;
  videoId: string;
  captions: CaptionTrack[];
}

export default function VideoPlayer({
  src,
  title,
  captions,
}: VideoPlayerProps): ReactElement {
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<number | null>(null);

  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [fatal, setFatal] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  // null = captions off; otherwise the active track lang.
  const [activeLang, setActiveLang] = useState<string | null>(null);

  // ── Attach the source: native HLS on Safari, hls.js elsewhere ─────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let hls: { destroy: () => void } | null = null;
    let cancelled = false;

    const canNative = video.canPlayType("application/vnd.apple.mpegurl") !== "";
    if (canNative) {
      video.src = src;
      setLoading(false);
    } else {
      void (async () => {
        try {
          const mod = await import("hls.js");
          if (cancelled) return;
          const Hls = mod.default;
          if (Hls.isSupported()) {
            const instance = new Hls({ enableWorker: true });
            hls = instance;
            instance.loadSource(src);
            instance.attachMedia(video);
            instance.on(Hls.Events.MANIFEST_PARSED, () => setLoading(false));
            instance.on(Hls.Events.ERROR, (_e, data) => {
              if (data.fatal) setFatal(true);
            });
          } else {
            // Last resort: let the element try (some browsers play HLS directly).
            video.src = src;
            setLoading(false);
          }
        } catch {
          if (!cancelled) setFatal(true);
        }
      })();
    }

    return () => {
      cancelled = true;
      if (hls) hls.destroy();
    };
  }, [src]);

  // ── Restore the learner's saved caption choice (default OFF) ──────────────
  useEffect(() => {
    if (captions.length === 0) return;
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved && captions.some((c) => c.lang === saved)) setActiveLang(saved);
    } catch {
      /* storage unavailable — stay off */
    }
  }, [captions]);

  // ── Apply the active caption track to the native <track> modes ────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const tracks = video.textTracks;
    for (let i = 0; i < tracks.length; i += 1) {
      const tt = tracks[i];
      if (!tt) continue;
      tt.mode =
        activeLang !== null && tt.language === activeLang ? "showing" : "disabled";
    }
  }, [activeLang, loading]);

  // ── Media element event wiring ────────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onPlay = (): void => setPlaying(true);
    const onPause = (): void => setPlaying(false);
    const onTime = (): void => setCurrent(video.currentTime);
    const onMeta = (): void => setDuration(video.duration || 0);
    const onWaiting = (): void => setBuffering(true);
    const onPlaying = (): void => setBuffering(false);
    const onVol = (): void => {
      setMuted(video.muted);
      setVolume(video.volume);
    };
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("loadedmetadata", onMeta);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("canplay", onPlaying);
    video.addEventListener("volumechange", onVol);
    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("loadedmetadata", onMeta);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("canplay", onPlaying);
      video.removeEventListener("volumechange", onVol);
    };
  }, []);

  useEffect(() => {
    const onFs = (): void =>
      setFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const togglePlay = useCallback((): void => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => undefined);
    else video.pause();
  }, []);

  const toggleMute = useCallback((): void => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
  }, []);

  const toggleFullscreen = useCallback((): void => {
    const stage = stageRef.current;
    if (!stage) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stage.requestFullscreen().catch(() => undefined);
  }, []);

  const setCaption = useCallback((lang: string | null): void => {
    setActiveLang(lang);
    setMenuOpen(false);
    try {
      if (lang) window.localStorage.setItem(STORAGE_KEY, lang);
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const toggleCaptions = useCallback((): void => {
    const first = captions[0];
    if (!first) return;
    if (activeLang) setCaption(null);
    else setCaption(first.lang);
  }, [activeLang, captions, setCaption]);

  function seekBy(delta: number): void {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.min(
      Math.max(0, video.currentTime + delta),
      video.duration || 0,
    );
  }
  function changeVolume(delta: number): void {
    const video = videoRef.current;
    if (!video) return;
    video.volume = Math.min(1, Math.max(0, video.volume + delta));
    if (video.volume > 0) video.muted = false;
  }

  // ── Auto-hide controls while playing (pointer only; never while focused) ──
  const revealControls = useCallback((): void => {
    setControlsVisible(true);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    if (playing) {
      hideTimer.current = window.setTimeout(() => {
        const stage = stageRef.current;
        if (stage && stage.contains(document.activeElement)) return;
        setControlsVisible(false);
      }, 2800);
    }
  }, [playing]);

  useEffect(() => {
    revealControls();
  }, [playing, revealControls]);

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    // Don't hijack typing in the (rare) focused range inputs' own keys: range
    // already handles Arrow keys, so skip when the target is a slider.
    const target = e.target as HTMLElement;
    const isRange = target.tagName === "INPUT";
    switch (e.key) {
      case " ":
      case "k":
        e.preventDefault();
        togglePlay();
        break;
      case "ArrowLeft":
        if (!isRange) {
          e.preventDefault();
          seekBy(-5);
        }
        break;
      case "ArrowRight":
        if (!isRange) {
          e.preventDefault();
          seekBy(5);
        }
        break;
      case "ArrowUp":
        if (!isRange) {
          e.preventDefault();
          changeVolume(0.1);
        }
        break;
      case "ArrowDown":
        if (!isRange) {
          e.preventDefault();
          changeVolume(-0.1);
        }
        break;
      case "m":
        toggleMute();
        break;
      case "c":
        toggleCaptions();
        break;
      case "f":
        toggleFullscreen();
        break;
      case "Escape":
        setMenuOpen(false);
        break;
      default:
        break;
    }
    revealControls();
  }

  const hasCaptions = captions.length > 0;

  return (
    <div className="vp-wrap">
      <style>{css}</style>
      <div
        className="vp-stage"
        onKeyDown={onKeyDown}
        onMouseMove={revealControls}
        ref={stageRef}
        role="region"
        aria-label={`Video player: ${title}`}
      >
        <video
          aria-label={title}
          className="vp-video"
          onClick={togglePlay}
          playsInline
          preload="metadata"
          ref={videoRef}
        >
          {captions.map((c, i) => (
            <track
              default={i === 0 && activeLang === c.lang}
              key={c.lang}
              kind="subtitles"
              label={c.label}
              src={c.url}
              srcLang={c.lang}
            />
          ))}
        </video>

        {loading && !fatal ? (
          <div className="vp-overlay">
            <Spinner label="Loading video" />
          </div>
        ) : null}

        {buffering && !loading && !fatal ? (
          <div className="vp-overlay">
            <Spinner label="Buffering" />
          </div>
        ) : null}

        {fatal ? (
          <div className="vp-overlay vp-overlay--error">
            <Alert tone="danger">
              This video couldn&apos;t be played.{" "}
              <button
                className="vp-btn"
                onClick={() => window.location.reload()}
                style={{ textDecoration: "underline", minWidth: "auto" }}
                type="button"
              >
                Refresh
              </button>
            </Alert>
          </div>
        ) : null}

        {!playing && !loading && !fatal ? (
          <button
            aria-label="Play"
            className="vp-bigplay"
            onClick={togglePlay}
            type="button"
          >
            <Glyph>{ICON.play}</Glyph>
          </button>
        ) : null}

        {!fatal ? (
          <div
            className={`vp-controls${controlsVisible ? "" : " vp-controls--hidden"}`}
          >
            <button
              aria-label={playing ? "Pause" : "Play"}
              aria-pressed={playing}
              className="vp-btn"
              onClick={togglePlay}
              type="button"
            >
              <Glyph>{playing ? ICON.pause : ICON.play}</Glyph>
            </button>

            <span className="vp-time">
              {fmt(current)} / {fmt(duration)}
            </span>

            <input
              aria-label="Seek"
              aria-valuetext={`${fmt(current)} of ${fmt(duration)}`}
              className="vp-seek"
              max={duration || 0}
              min={0}
              onChange={(e) => {
                const video = videoRef.current;
                if (video) video.currentTime = Number(e.target.value);
              }}
              step={1}
              type="range"
              value={current}
            />

            <button
              aria-label={muted || volume === 0 ? "Unmute" : "Mute"}
              aria-pressed={muted || volume === 0}
              className="vp-btn"
              onClick={toggleMute}
              type="button"
            >
              <Glyph>{muted || volume === 0 ? ICON.muted : ICON.volume}</Glyph>
            </button>
            <input
              aria-label="Volume"
              className="vp-vol"
              max={1}
              min={0}
              onChange={(e) => {
                const video = videoRef.current;
                if (video) {
                  video.volume = Number(e.target.value);
                  video.muted = Number(e.target.value) === 0;
                }
              }}
              step={0.05}
              type="range"
              value={muted ? 0 : volume}
            />

            {hasCaptions ? (
              <div className="vp-menu-wrap">
                <button
                  aria-expanded={menuOpen}
                  aria-haspopup="menu"
                  aria-label="Captions"
                  aria-pressed={activeLang !== null}
                  className="vp-btn"
                  onClick={() => setMenuOpen((v) => !v)}
                  type="button"
                >
                  CC
                </button>
                {menuOpen ? (
                  <ul aria-label="Subtitle language" className="vp-menu" role="menu">
                    <li role="none">
                      <button
                        aria-checked={activeLang === null}
                        onClick={() => setCaption(null)}
                        role="menuitemradio"
                        type="button"
                      >
                        Off
                      </button>
                    </li>
                    {captions.map((c) => (
                      <li key={c.lang} role="none">
                        <button
                          aria-checked={activeLang === c.lang}
                          onClick={() => setCaption(c.lang)}
                          role="menuitemradio"
                          type="button"
                        >
                          {c.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            <button
              aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
              aria-pressed={fullscreen}
              className="vp-btn"
              onClick={toggleFullscreen}
              type="button"
            >
              <Glyph>{ICON.fullscreen}</Glyph>
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
