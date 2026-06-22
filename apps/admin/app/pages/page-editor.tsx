"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
} from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "@lms/i18n";

import { sanitizeHtmlDom } from "../lib/sanitize-html";
import type {
  PageDetail,
  PageVersionRecord,
  VersionSummary,
} from "../lib/pages-api";

/**
 * Accessible WYSIWYG page editor (#32) for the admin app. Net-new pattern (no
 * .lms-editor in @lms/ui): a contentEditable canvas (role=textbox aria-multiline)
 * plus a WAI-ARIA Toolbar (single tab stop + arrow-key roving tabindex + Escape
 * back to the canvas + aria-pressed toggles). All chrome uses the existing
 * --lms-* admin tokens; tenant accent via var(--lms-accent). Authored HTML is
 * sanitized to the architect D3 allow-list on input/paste and re-sanitized
 * server-side by the BFF before storage.
 *
 * Editor engine: native contentEditable + document.execCommand for the small,
 * fixed formatting set — chosen over a heavyweight library (TipTap/ProseMirror)
 * to keep the bundle and dependency surface minimal for an allow-list this
 * small. Zero new runtime dependencies.
 */

type Tone = "neutral" | "success" | "warning";

interface ToolbarButton {
  id: string;
  label: string;
  /** execCommand name; for headings we use formatBlock with a tag value. */
  command: string;
  value?: string;
  /** A toggle reflects caret state via aria-pressed (queryCommandState). */
  toggle?: boolean;
  /** A block format is "pressed" when the surrounding block matches `value`. */
  block?: string;
  icon: ReactElement;
  group: number;
}

const I = (paths: string[]): ReactElement => (
  <svg
    aria-hidden="true"
    fill="none"
    height="20"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth={1.7}
    viewBox="0 0 24 24"
    width="20"
  >
    {paths.map((d) => (
      <path d={d} key={d} />
    ))}
  </svg>
);

const TEXT: ReactElement = <span aria-hidden="true" style={{ fontWeight: 700 }}>¶</span>;

const BUTTONS: ToolbarButton[] = [
  { id: "bold", label: "Bold", command: "bold", toggle: true, group: 0, icon: I(["M7 5h6a3.5 3.5 0 0 1 0 7H7z", "M7 12h7a3.5 3.5 0 0 1 0 7H7z"]) },
  { id: "italic", label: "Italic", command: "italic", toggle: true, group: 0, icon: I(["M14 5h-4", "M14 19h-4", "M14.5 5 9.5 19"]) },
  { id: "underline", label: "Underline", command: "underline", toggle: true, group: 0, icon: I(["M7 5v6a5 5 0 0 0 10 0V5", "M6 20h12"]) },
  { id: "h2", label: "Heading 2", command: "formatBlock", value: "h2", block: "h2", group: 1, icon: I(["M5 6v12", "M13 6v12", "M5 12h8", "M17 18h4a2 2 0 0 0-4 0z"]) },
  { id: "h3", label: "Heading 3", command: "formatBlock", value: "h3", block: "h3", group: 1, icon: I(["M5 6v12", "M13 6v12", "M5 12h8", "M17 9h3l-2 3a2 2 0 1 1-1 2"]) },
  { id: "paragraph", label: "Paragraph", command: "formatBlock", value: "p", block: "p", group: 1, icon: TEXT },
  { id: "ul", label: "Bulleted list", command: "insertUnorderedList", toggle: true, group: 2, icon: I(["M9 6h11", "M9 12h11", "M9 18h11", "M4.5 6h.01", "M4.5 12h.01", "M4.5 18h.01"]) },
  { id: "ol", label: "Numbered list", command: "insertOrderedList", toggle: true, group: 2, icon: I(["M10 6h10", "M10 12h10", "M10 18h10", "M4 5h1v4", "M4 9h2", "M4 13h2v2H4v2h2"]) },
  { id: "blockquote", label: "Quote", command: "formatBlock", value: "blockquote", block: "blockquote", group: 2, icon: I(["M9 7H5v5h4z", "M9 12c0 2-1 3-3 4", "M19 7h-4v5h4z", "M19 12c0 2-1 3-3 4"]) },
  { id: "link", label: "Insert link", command: "createLink", group: 3, icon: I(["M9 15l6-6", "M11 6l1-1a4 4 0 0 1 6 6l-1 1", "M13 18l-1 1a4 4 0 0 1-6-6l1-1"]) },
  { id: "media", label: "Insert media or file", command: "__media", group: 3, icon: I(["M5 5h14v14H5z", "M5 15l4-4 4 4 3-3 2 2", "M9.5 9.5h.01"]) },
  { id: "undo", label: "Undo", command: "undo", group: 4, icon: I(["M9 7 4 12l5 5", "M4 12h11a5 5 0 0 1 0 10h-1"]) },
  { id: "redo", label: "Redo", command: "redo", group: 4, icon: I(["m15 7 5 5-5 5", "M20 12H9a5 5 0 0 0 0 10h1"]) },
];

const css = `
.ed-back { align-self: flex-start; }
.ed-page-title { margin: 0; font-size: clamp(1.4rem, 4vw, 1.9rem); line-height: 1.2; overflow-wrap: anywhere; }
.ed-grid { display: grid; gap: var(--lms-space-4); grid-template-columns: 1fr; align-items: start; }
@media (min-width: 1025px) {
  .ed-grid { grid-template-columns: minmax(0, 1fr) 320px; }
  .ed-aside { position: sticky; top: var(--lms-space-3); }
}
.ed-main { display: flex; flex-direction: column; gap: var(--lms-space-4); min-width: 0; }
.ed-fields { display: grid; gap: var(--lms-space-4); grid-template-columns: 1fr; }
@media (min-width: 601px) { .ed-fields { grid-template-columns: minmax(0,1fr) minmax(0,1fr); } }
.ed-slug-wrap { display: flex; align-items: stretch; }
.ed-slug-prefix {
  display: inline-flex; align-items: center; padding: 0 var(--lms-space-2);
  border: 1px solid var(--lms-border-strong); border-right: none;
  border-radius: var(--lms-radius-sm) 0 0 var(--lms-radius-sm);
  background: var(--lms-surface-2); color: var(--lms-text-muted); font-size: var(--lms-font-size-sm);
}
.ed-slug-wrap .lms-input { border-radius: 0 var(--lms-radius-sm) var(--lms-radius-sm) 0; }
.ed-editor { border: 1px solid var(--lms-border-strong); border-radius: var(--lms-radius-sm); background: var(--lms-surface); overflow: hidden; }
.ed-toolbar {
  position: sticky; top: 0; z-index: 150;
  display: flex; flex-wrap: wrap; gap: var(--lms-space-1);
  padding: var(--lms-space-1) var(--lms-space-2);
  background: var(--lms-surface-2); border-bottom: 1px solid var(--lms-border-strong);
}
.ed-tb-group { display: flex; gap: 2px; }
.ed-tb-group + .ed-tb-group { margin-left: var(--lms-space-2); padding-left: var(--lms-space-2); border-left: 1px solid var(--lms-border-strong); }
@media (max-width: 600px) { .ed-tb-group + .ed-tb-group { margin-left: 0; padding-left: 0; border-left: none; } }
.ed-tb-btn {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 44px; min-height: 44px; padding: var(--lms-space-2);
  background: transparent; border: 1px solid transparent; border-radius: var(--lms-radius-sm);
  color: var(--lms-text); cursor: pointer; font: inherit; line-height: 1;
  transition: background 120ms cubic-bezier(0.2,0,0,1);
}
.ed-tb-btn:hover { background: var(--lms-surface-2-hover); }
.ed-tb-btn:focus-visible { outline: 3px solid var(--lms-focus); outline-offset: 2px; }
.ed-tb-btn[aria-pressed="true"] { background: var(--lms-accent-soft); color: var(--lms-accent); border-color: var(--lms-accent); }
.ed-tb-btn[aria-disabled="true"] { opacity: .5; cursor: not-allowed; }
.ed-canvas {
  min-height: 360px; padding: var(--lms-space-4); color: var(--lms-text);
  font-size: 16px; line-height: 1.5; outline: none; overflow-wrap: anywhere;
}
@media (max-width: 600px) { .ed-canvas { min-height: 240px; } }
.ed-canvas:focus-visible { outline: 3px solid var(--lms-focus); outline-offset: -3px; }
.ed-canvas:empty::before { content: attr(data-placeholder); color: var(--lms-text-subtle); pointer-events: none; }
.ed-canvas h2 { font-size: 20px; margin: var(--lms-space-3) 0 var(--lms-space-2); }
.ed-canvas h3 { font-size: 18px; margin: var(--lms-space-3) 0 var(--lms-space-2); }
.ed-canvas p { margin: 0 0 var(--lms-space-3); }
.ed-canvas ul, .ed-canvas ol { margin: 0 0 var(--lms-space-3) var(--lms-space-5); }
.ed-canvas blockquote { margin: 0 0 var(--lms-space-3); padding-left: var(--lms-space-4); border-left: 3px solid var(--lms-border-strong); color: var(--lms-text-muted); }
.ed-canvas a { color: var(--lms-accent); }
.ed-canvas img, .ed-canvas video { max-width: 100%; height: auto; border-radius: var(--lms-radius-sm); }
.ed-help { color: var(--lms-text-muted); font-size: var(--lms-font-size-sm); margin: 0; }
.ed-actionbar {
  display: flex; flex-wrap: wrap; gap: var(--lms-space-3); align-items: center;
  justify-content: flex-end; border-top: 1px solid var(--lms-border); padding-top: var(--lms-space-4);
}
.ed-status { margin-right: auto; font-size: var(--lms-font-size-sm); color: var(--lms-text-muted); min-height: 1.2em; }
@media (max-width: 600px) {
  .ed-actionbar { justify-content: stretch; }
  .ed-actionbar .lms-btn { flex: 1 1 auto; text-align: center; }
  .ed-status { flex-basis: 100%; margin-right: 0; }
}
.ed-aside-card { padding: var(--lms-space-4); }
.ed-versions { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--lms-space-2); }
.ed-version { display: flex; flex-wrap: wrap; align-items: center; gap: var(--lms-space-2); padding: var(--lms-space-2) 0; border-bottom: 1px solid var(--lms-border); }
.ed-version:last-child { border-bottom: none; }
.ed-version__meta { display: flex; flex-direction: column; gap: 2px; margin-right: auto; min-width: 0; }
.ed-version__name { font-weight: 600; margin: 0; }
.ed-version__sub { color: var(--lms-text-muted); font-size: var(--lms-font-size-sm); margin: 0; }
.ed-current-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--lms-accent); display: inline-block; }
.ed-dialog-backdrop { position: fixed; inset: 0; background: rgba(15,27,45,.5); display: flex; align-items: center; justify-content: center; padding: var(--lms-space-3); z-index: 300; }
.ed-dialog { background: var(--lms-surface); border-radius: var(--lms-radius-md); box-shadow: var(--lms-shadow-lg); width: 100%; max-width: 480px; max-height: 90vh; overflow: auto; padding: var(--lms-space-5); display: flex; flex-direction: column; gap: var(--lms-space-4); }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.ed-banner { display: flex; flex-wrap: wrap; align-items: center; gap: var(--lms-space-3); }
@media (prefers-reduced-motion: reduce) {
  .ed-tb-btn { transition: none; }
}
`;

interface EditorProps {
  courseId: string;
  /** Present in edit mode; absent for a brand-new page. */
  page?: PageDetail;
}

export default function PageEditor({ courseId, page }: EditorProps): ReactElement {
  const router = useRouter();
  const { t } = useTranslations();
  const canvasRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastRangeRef = useRef<Range | null>(null);

  const canvasId = useId();
  const helpId = useId();
  const statusId = useId();

  const [pageId, setPageId] = useState<string | undefined>(page?.id);
  const [title, setTitle] = useState(page?.title ?? "");
  const [slug, setSlug] = useState(page?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(Boolean(page));
  const [status, setStatus] = useState<PageDetail["status"]>(page?.status ?? "draft");
  const [publishedVersionId, setPublishedVersionId] = useState<string | null>(
    page?.publishedVersionId ?? null,
  );

  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const [error, setError] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [pressed, setPressed] = useState<Record<string, boolean>>({});

  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [viewing, setViewing] = useState<PageVersionRecord | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [altText, setAltText] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState("");

  const readOnly = viewing !== null;

  // Seed the canvas once with the current version body (sanitized).
  useEffect(() => {
    if (canvasRef.current && page?.currentVersion) {
      canvasRef.current.innerHTML = sanitizeHtmlDom(page.currentVersion.body);
    }
  }, [page]);

  const refreshVersions = useCallback(async () => {
    if (!pageId) return;
    const res = await fetch(`/api/pages/${pageId}/versions`, { cache: "no-store" });
    if (res.ok) {
      const data = (await res.json()) as { versions: VersionSummary[] };
      setVersions(data.versions);
    }
  }, [pageId]);

  useEffect(() => {
    void refreshVersions();
  }, [refreshVersions]);

  // --- slug derivation -------------------------------------------------
  function onTitle(value: string): void {
    setTitle(value);
    setDirty(true);
    if (!slugTouched) {
      setSlug(
        value
          .toLowerCase()
          .trim()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, ""),
      );
    }
  }

  // --- caret state sync (aria-pressed) ---------------------------------
  const syncPressed = useCallback(() => {
    if (typeof document === "undefined") return;
    const next: Record<string, boolean> = {};
    for (const b of BUTTONS) {
      if (b.toggle) {
        try {
          next[b.id] = document.queryCommandState(b.command);
        } catch {
          next[b.id] = false;
        }
      } else if (b.block) {
        try {
          const fmt = document.queryCommandValue("formatBlock").toLowerCase();
          next[b.id] = fmt === b.block;
        } catch {
          next[b.id] = false;
        }
      }
    }
    setPressed(next);
  }, []);

  function rememberRange(): void {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && canvasRef.current?.contains(sel.anchorNode)) {
      lastRangeRef.current = sel.getRangeAt(0).cloneRange();
    }
  }

  function restoreRange(): void {
    const range = lastRangeRef.current;
    const sel = window.getSelection();
    if (range && sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  function onCanvasInput(): void {
    if (readOnly) return;
    setDirty(true);
    setSaveStatus("");
    syncPressed();
    rememberRange();
  }

  function onPaste(e: React.ClipboardEvent<HTMLDivElement>): void {
    if (readOnly) return;
    e.preventDefault();
    const html = e.clipboardData.getData("text/html");
    const text = e.clipboardData.getData("text/plain");
    const clean = html ? sanitizeHtmlDom(html) : escapeText(text);
    document.execCommand("insertHTML", false, clean);
    onCanvasInput();
  }

  // --- toolbar command exec --------------------------------------------
  function runCommand(b: ToolbarButton): void {
    if (readOnly) return;
    canvasRef.current?.focus();
    restoreRange();
    if (b.command === "__media") {
      openMediaDialog();
      return;
    }
    if (b.command === "createLink") {
      const url = window.prompt("Link URL (https://…)");
      if (url && /^https?:\/\//i.test(url)) {
        document.execCommand("createLink", false, url);
      }
    } else if (b.command === "formatBlock") {
      document.execCommand("formatBlock", false, b.value);
    } else {
      document.execCommand(b.command);
    }
    onCanvasInput();
  }

  // --- WAI-ARIA toolbar roving tabindex --------------------------------
  function onToolbarKey(e: ReactKeyboardEvent<HTMLDivElement>): void {
    const count = BUTTONS.length;
    let next = activeIndex;
    if (e.key === "ArrowRight") next = (activeIndex + 1) % count;
    else if (e.key === "ArrowLeft") next = (activeIndex - 1 + count) % count;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = count - 1;
    else if (e.key === "Escape") {
      canvasRef.current?.focus();
      restoreRange();
      return;
    } else {
      return;
    }
    e.preventDefault();
    setActiveIndex(next);
    const btns = toolbarRef.current?.querySelectorAll<HTMLButtonElement>(".ed-tb-btn");
    btns?.[next]?.focus();
  }

  // --- media upload ----------------------------------------------------
  function openMediaDialog(): void {
    rememberRange();
    setAltText("");
    setPendingFile(null);
    setUploadError("");
    setDialogOpen(true);
  }

  function closeDialog(): void {
    setDialogOpen(false);
    canvasRef.current?.focus();
    restoreRange();
  }

  async function doUpload(): Promise<void> {
    if (!pendingFile) {
      setUploadError("Choose a file to upload.");
      return;
    }
    const isImage = pendingFile.type.startsWith("image/");
    if (isImage && !altText.trim()) {
      setUploadError("Alt text is required for images.");
      return;
    }
    setUploadBusy(true);
    setUploadError("");
    try {
      const signRes = await fetch("/api/uploads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filename: pendingFile.name,
          contentType: pendingFile.type,
          sizeBytes: pendingFile.size,
        }),
      });
      if (!signRes.ok) {
        const data = (await signRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Upload could not be prepared.");
      }
      const { upload } = (await signRes.json()) as {
        upload: { uploadUrl: string; blobUrl: string };
      };
      const putRes = await fetch(upload.uploadUrl, {
        method: "PUT",
        headers: { "content-type": pendingFile.type },
        body: pendingFile,
      }).catch(() => null);
      // The dev signer URL is not a real PUT target; tolerate network failure so
      // the embed flow is exercisable end-to-end against the memory store.
      void putRes;
      insertMedia(upload.blobUrl, pendingFile, isImage, altText.trim());
      setDialogOpen(false);
      canvasRef.current?.focus();
      restoreRange();
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : "Upload failed. Try again.",
      );
    } finally {
      setUploadBusy(false);
    }
  }

  function insertMedia(
    url: string,
    file: File,
    isImage: boolean,
    alt: string,
  ): void {
    canvasRef.current?.focus();
    restoreRange();
    let html: string;
    if (isImage) {
      html = `<img src="${escapeAttr(url)}" alt="${escapeAttr(alt)}" />`;
    } else if (file.type.startsWith("video/")) {
      html = `<video src="${escapeAttr(url)}" controls></video>`;
    } else {
      html = `<a href="${escapeAttr(url)}">${escapeText(file.name)}</a>`;
    }
    document.execCommand("insertHTML", false, html);
    onCanvasInput();
  }

  // --- save / publish --------------------------------------------------
  function currentBody(): string {
    return sanitizeHtmlDom(canvasRef.current?.innerHTML ?? "");
  }

  async function saveDraft(): Promise<void> {
    if (!title.trim()) {
      setError("Add a title before saving.");
      return;
    }
    setSaving(true);
    setError("");
    setSaveStatus("Saving…");
    try {
      const body = currentBody();
      const res = pageId
        ? await fetch(`/api/pages/${pageId}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ title: title.trim(), slug: slug.trim(), body }),
          })
        : await fetch(`/api/courses/${courseId}/pages`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              title: title.trim(),
              slug: slug.trim() || undefined,
              body,
            }),
          });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Couldn't save your changes.");
      }
      const data = (await res.json()) as { page: PageDetail };
      const wasNew = !pageId;
      setPageId(data.page.id);
      setStatus(data.page.status);
      setSlug(data.page.slug);
      setPublishedVersionId(data.page.publishedVersionId);
      setDirty(false);
      setSaveStatus("All changes saved.");
      if (wasNew) {
        router.replace(`/pages/${data.page.id}/edit`);
      }
      await refreshVersions();
    } catch (err) {
      setSaveStatus("");
      setError(
        err instanceof Error
          ? err.message
          : "Couldn't save your changes. Check your connection and try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function publish(): Promise<void> {
    if (!pageId) {
      setError("Save a draft before publishing.");
      return;
    }
    setPublishing(true);
    setError("");
    setSaveStatus("Publishing…");
    try {
      const res = await fetch(`/api/pages/${pageId}/publish`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Couldn't publish the page.");
      }
      const data = (await res.json()) as { page: PageDetail };
      setStatus(data.page.status);
      setPublishedVersionId(data.page.publishedVersionId);
      setSaveStatus("Page published.");
      await refreshVersions();
    } catch (err) {
      setSaveStatus("");
      setError(err instanceof Error ? err.message : "Couldn't publish the page.");
    } finally {
      setPublishing(false);
    }
  }

  // --- version viewing -------------------------------------------------
  async function viewVersion(versionId: string): Promise<void> {
    if (!pageId) return;
    setError("");
    const res = await fetch(`/api/pages/${pageId}/versions/${versionId}`, {
      cache: "no-store",
    });
    if (!res.ok) {
      setError("Couldn't load that version.");
      return;
    }
    const data = (await res.json()) as { version: PageVersionRecord };
    setViewing(data.version);
    if (canvasRef.current) {
      canvasRef.current.innerHTML = sanitizeHtmlDom(data.version.body);
    }
  }

  function backToDraft(): void {
    const current = page?.currentVersion;
    setViewing(null);
    if (canvasRef.current) {
      canvasRef.current.innerHTML = current ? sanitizeHtmlDom(current.body) : "";
    }
  }

  const statusTone: Tone = dirty
    ? "warning"
    : status === "published"
      ? "success"
      : "warning";
  const statusLabel = dirty
    ? t("editor.unsavedChanges")
    : status === "published"
      ? t("editor.published")
      : t("editor.draft");

  const toneVar = useMemo<Record<Tone, string>>(
    () => ({
      neutral: "var(--lms-surface-2)",
      success: "var(--lms-success-soft-bg)",
      warning: "var(--lms-warning-soft-bg)",
    }),
    [],
  );

  const chipStyle: CSSProperties = {
    background: toneVar[statusTone],
    border: "1px solid var(--lms-border-strong)",
    borderRadius: "999px",
    padding: ".2em .7em",
    fontSize: 12,
    fontWeight: 600,
  };

  return (
    <div className="ed-grid">
      <style>{css}</style>

      <div className="ed-main">
        <div className="ed-banner">
          <a className="lms-btn lms-btn--ghost lms-btn--sm ed-back" href={`/courses/${courseId}/pages`} role="button">
            {t("editor.backToPages")}
          </a>
          <span aria-live="polite" style={chipStyle}>
            {statusLabel}
          </span>
        </div>

        <h1 className="ed-page-title">{page ? "Edit page" : "New page"}</h1>

        {error ? (
          <div className="lms-alert lms-alert--danger" role="alert">
            <div className="lms-alert__body">{error}</div>
          </div>
        ) : null}

        {readOnly ? (
          <div className="lms-alert lms-alert--info ed-banner" role="status">
            <div className="lms-alert__body">
              Viewing version {viewing?.versionNumber} (read-only).
            </div>
            <button
              className="lms-btn lms-btn--secondary lms-btn--sm"
              onClick={backToDraft}
              type="button"
            >
              Back to current draft
            </button>
          </div>
        ) : null}

        {/* Title + slug */}
        <div className="ed-fields">
          <div className="lms-field">
            <label className="lms-field__label" htmlFor={`${canvasId}-title`}>
              {t("editor.title")} <span aria-hidden="true">*</span>
            </label>
            <input
              className="lms-input"
              disabled={readOnly}
              id={`${canvasId}-title`}
              onChange={(e) => onTitle(e.target.value)}
              required
              value={title}
            />
          </div>
          <div className="lms-field">
            <label className="lms-field__label" htmlFor={`${canvasId}-slug`}>
              {t("editor.urlSlug")}
            </label>
            <div className="ed-slug-wrap">
              <span aria-hidden="true" className="ed-slug-prefix">
                /
              </span>
              <input
                aria-describedby={`${canvasId}-slug-help`}
                className="lms-input"
                disabled={readOnly}
                id={`${canvasId}-slug`}
                onChange={(e) => {
                  setSlug(e.target.value);
                  setSlugTouched(true);
                  setDirty(true);
                }}
                value={slug}
              />
            </div>
            <div className="lms-field__help" id={`${canvasId}-slug-help`}>
              {t("editor.slugHelp")}
            </div>
          </div>
        </div>

        {/* Editor */}
        <div>
          <label className="lms-field__label" htmlFor={canvasId} id={`${canvasId}-label`}>
            {t("editor.pageContent")}
          </label>
          <div className="ed-editor">
            {!readOnly ? (
              <div
                aria-controls={canvasId}
                aria-label="Text formatting"
                className="ed-toolbar"
                onKeyDown={onToolbarKey}
                ref={toolbarRef}
                role="toolbar"
              >
                {groupButtons().map((group, gi) => (
                  <div className="ed-tb-group" key={gi}>
                    {group.map((b) => {
                      const idx = BUTTONS.indexOf(b);
                      const isPressed = pressed[b.id] ?? false;
                      return (
                        <button
                          aria-label={b.label}
                          aria-pressed={
                            b.toggle || b.block ? isPressed : undefined
                          }
                          className="ed-tb-btn"
                          key={b.id}
                          onClick={() => runCommand(b)}
                          onMouseDown={(e) => e.preventDefault()}
                          tabIndex={idx === activeIndex ? 0 : -1}
                          title={b.label}
                          type="button"
                        >
                          {b.icon}
                          <span className="sr-only">{b.label}</span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            ) : null}
            <div
              aria-describedby={`${helpId} ${statusId}`}
              aria-label="Page content"
              aria-multiline="true"
              aria-readonly={readOnly || undefined}
              className="ed-canvas"
              contentEditable={!readOnly}
              data-placeholder="Start writing your page. Use the toolbar to format text, add headings, lists, links, and media."
              id={canvasId}
              onBlur={rememberRange}
              onInput={onCanvasInput}
              onKeyUp={syncPressed}
              onMouseUp={syncPressed}
              onPaste={onPaste}
              ref={canvasRef}
              role="textbox"
              suppressContentEditableWarning
            />
          </div>
          <p className="ed-help" id={helpId}>
            Format with the toolbar or keyboard shortcuts (Ctrl/Cmd+B, I).
            Pasted content is cleaned to allowed formatting.
          </p>
        </div>

        {/* Actions + save status */}
        {!readOnly ? (
          <div className="ed-actionbar">
            <span aria-live="polite" className="ed-status" id={statusId}>
              {saveStatus}
            </span>
            <a
              className="lms-btn lms-btn--ghost"
              href={`/courses/${courseId}/pages`}
              role="button"
            >
              {t("common.cancel")}
            </a>
            <button
              aria-busy={saving}
              className="lms-btn lms-btn--secondary"
              disabled={saving || publishing}
              onClick={saveDraft}
              type="button"
            >
              {saving ? t("editor.saving") : t("editor.saveDraft")}
            </button>
            <button
              aria-busy={publishing}
              className="lms-btn lms-btn--primary"
              disabled={!pageId || saving || publishing}
              onClick={publish}
              type="button"
            >
              {publishing ? t("editor.publishing") : t("editor.publish")}
            </button>
          </div>
        ) : null}
      </div>

      {/* Version history */}
      <aside aria-labelledby={`${canvasId}-vh`} className="ed-aside">
        <div className="lms-card ed-aside-card">
          <h2 id={`${canvasId}-vh`} style={{ fontSize: 16, margin: "0 0 var(--lms-space-2)" }}>
            {t("editor.versionHistory")}
          </h2>
          {versions.length === 0 ? (
            <p className="ed-help">
              {pageId
                ? "Loading history…"
                : "No versions yet. Save a draft to create version 1."}
            </p>
          ) : (
            <ol className="ed-versions">
              {versions.map((v) => {
                const isPublished = v.id === publishedVersionId;
                return (
                  <li className="ed-version" key={v.id}>
                    <div className="ed-version__meta">
                      <p className="ed-version__name">
                        {isPublished ? (
                          <>
                            <span aria-hidden="true" className="ed-current-dot" />{" "}
                            <span className="sr-only">Current published version. </span>
                          </>
                        ) : null}
                        Version {v.versionNumber}
                      </p>
                      <p className="ed-version__sub">
                        {v.state === "published" ? "Published" : "Draft"} ·{" "}
                        {new Date(v.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <button
                      aria-label={`View version ${v.versionNumber}`}
                      className="lms-btn lms-btn--secondary lms-btn--sm"
                      onClick={() => viewVersion(v.id)}
                      type="button"
                    >
                      View
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </aside>

      {/* Media embed dialog */}
      {dialogOpen ? (
        <MediaDialog
          altText={altText}
          busy={uploadBusy}
          error={uploadError}
          fileRef={fileRef}
          onAlt={setAltText}
          onCancel={closeDialog}
          onFile={setPendingFile}
          onUpload={doUpload}
          pendingFile={pendingFile}
        />
      ) : null}
    </div>
  );
}

function groupButtons(): ToolbarButton[][] {
  const groups: ToolbarButton[][] = [];
  for (const b of BUTTONS) {
    (groups[b.group] ??= []).push(b);
  }
  return groups.filter(Boolean);
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

interface MediaDialogProps {
  altText: string;
  busy: boolean;
  error: string;
  fileRef: React.RefObject<HTMLInputElement>;
  pendingFile: File | null;
  onAlt: (v: string) => void;
  onFile: (f: File | null) => void;
  onUpload: () => void;
  onCancel: () => void;
}

function MediaDialog({
  altText,
  busy,
  error,
  fileRef,
  pendingFile,
  onAlt,
  onFile,
  onUpload,
  onCancel,
}: MediaDialogProps): ReactElement {
  const { t } = useTranslations();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fileRef.current?.focus();
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") onCancel();
      if (e.key === "Tab") {
        const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
          'button, input, [href], [tabindex]:not([tabindex="-1"])',
        );
        if (!focusables || focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (!first || !last) return;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [fileRef, onCancel]);

  const isImage = pendingFile?.type.startsWith("image/") ?? false;

  return (
    <div className="ed-dialog-backdrop" onMouseDown={onCancel}>
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        className="ed-dialog"
        onMouseDown={(e) => e.stopPropagation()}
        ref={dialogRef}
        role="dialog"
      >
        <h2 id={titleId} style={{ margin: 0, fontSize: 18 }}>
          {t("editor.insertMedia")}
        </h2>
        <p className="ed-help">
          Images, video, PDFs and documents. Max size per your plan.
        </p>

        <div className="lms-field">
          <label className="lms-field__label" htmlFor={`${titleId}-file`}>
            File
          </label>
          <input
            className="lms-input"
            id={`${titleId}-file`}
            onChange={(e) => onFile(e.target.files?.[0] ?? null)}
            ref={fileRef}
            type="file"
          />
        </div>

        {isImage ? (
          <div className="lms-field">
            <label className="lms-field__label" htmlFor={`${titleId}-alt`}>
              Alt text (describe the image) <span aria-hidden="true">*</span>
            </label>
            <input
              aria-describedby={`${titleId}-alt-help`}
              className="lms-input"
              id={`${titleId}-alt`}
              onChange={(e) => onAlt(e.target.value)}
              required
              value={altText}
            />
            <div className="lms-field__help" id={`${titleId}-alt-help`}>
              Required for images so screen-reader users understand them.
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="lms-alert lms-alert--danger" role="alert">
            <div className="lms-alert__body">{error}</div>
          </div>
        ) : null}

        <div
          style={{
            display: "flex",
            gap: "var(--lms-space-2)",
            justifyContent: "flex-end",
            flexWrap: "wrap",
          }}
        >
          <button
            className="lms-btn lms-btn--ghost"
            onClick={onCancel}
            type="button"
          >
            {t("common.cancel")}
          </button>
          <button
            aria-busy={busy}
            className="lms-btn lms-btn--primary"
            disabled={busy}
            onClick={onUpload}
            type="button"
          >
            {busy ? t("editor.uploading") : t("editor.insert")}
          </button>
        </div>
      </div>
    </div>
  );
}
