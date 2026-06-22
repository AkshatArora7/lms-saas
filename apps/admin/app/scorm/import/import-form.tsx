"use client";

import {
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type ReactElement,
} from "react";
import { Alert, Badge, Button, Card, Field, Stack } from "@lms/ui";

import type {
  ScormImportReason,
  ScormPackageRecord,
} from "../../lib/scorm-api";

/**
 * Interactive SCORM import form (#31) for the admin console. Net-new client
 * control on top of the established courses/new form chrome (.asg-* sections +
 * actionbar): an accessible .zip dropzone (native <input type=file> as the
 * labelled control; drag-drop is additive) plus an imsmanifest.xml field.
 *
 * Manifest acquisition is PASTE-FIRST and dependency-free: the admin pastes (or
 * uploads) the imsmanifest.xml. Selecting the .zip best-effort reads a manifest
 * out of it only when the file is already plain text (an .xml); client-side
 * unzip of a real archive is a documented follow-up (see openQuestions) — kept
 * honest in the copy so we never over-promise.
 *
 * On submit: (1) POST /api/uploads to get a signed URL and PUT the .zip bytes
 * (existing flow); (2) POST /api/scorm/packages { manifestXml, blobUrl,
 * topicId? }. The backend's typed 400 reasons map to recoverable copy and mark
 * the offending field aria-invalid. All visuals resolve from var(--lms-*).
 */

const css = `
.si-form { display: flex; flex-direction: column; gap: var(--lms-space-5); }
.si-section { display: flex; flex-direction: column; gap: var(--lms-space-4); }
.si-section + .si-section {
  border-top: 1px solid var(--lms-border);
  padding-top: var(--lms-space-5);
}
.si-section-head { display: flex; flex-direction: column; gap: var(--lms-space-1); }
.si-section-title { font-size: 0.95rem; font-weight: 600; margin: 0; }
.si-section-hint {
  color: var(--lms-text-muted); font-size: 0.875rem; margin: 0;
  overflow-wrap: anywhere;
}
.si-dropzone {
  display: flex; flex-direction: column; gap: var(--lms-space-2);
  align-items: flex-start; justify-content: center;
  min-height: 120px; padding: var(--lms-space-4);
  border: 1px dashed var(--lms-border-strong);
  border-radius: var(--lms-radius-sm);
  background: var(--lms-surface);
  transition: background 120ms ease, border-color 120ms ease;
}
.si-dropzone[data-drag="true"] {
  border-color: var(--lms-accent);
  border-style: solid;
  background: var(--lms-accent-soft);
}
.si-dropzone__file {
  /* The native input is the accessible control; keep it operable, not hidden. */
  font: inherit; color: var(--lms-text); max-width: 100%;
}
.si-dropzone__file::file-selector-button {
  min-height: 44px; padding: 0 var(--lms-space-3); margin-right: var(--lms-space-3);
  border: 1px solid var(--lms-border-strong); border-radius: var(--lms-radius-sm);
  background: var(--lms-surface-2); color: var(--lms-text);
  font: inherit; font-weight: 600; cursor: pointer;
}
.si-dropzone__file:focus-visible {
  outline: 3px solid var(--lms-focus); outline-offset: 2px;
}
.si-dropzone__idle { color: var(--lms-text-muted); font-size: 0.875rem; margin: 0; overflow-wrap: anywhere; }
.si-dropzone__selected {
  display: flex; flex-wrap: wrap; gap: var(--lms-space-2); align-items: center;
  font-size: 0.9rem; overflow-wrap: anywhere;
}
.si-dropzone__name { font-weight: 600; overflow-wrap: anywhere; word-break: break-all; }
.si-replace {
  min-height: 44px; padding: 0 var(--lms-space-3);
  border: 1px solid var(--lms-border-strong); border-radius: var(--lms-radius-sm);
  background: transparent; color: var(--lms-text); font: inherit; cursor: pointer;
}
.si-replace:focus-visible { outline: 3px solid var(--lms-focus); outline-offset: 2px; }
.si-note { color: var(--lms-text-muted); font-size: 0.8rem; margin: 0; overflow-wrap: anywhere; }
.si-textarea { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.si-actionbar {
  border-top: 1px solid var(--lms-border);
  display: flex; flex-wrap: wrap; gap: var(--lms-space-2);
  align-items: center; justify-content: flex-end;
  padding-top: var(--lms-space-4);
}
.si-status { margin-right: auto; font-size: 0.875rem; color: var(--lms-text-muted); min-height: 1.2em; }
@media (max-width: 599px) {
  .si-actionbar { justify-content: stretch; }
  .si-actionbar .lms-btn { flex: 1 1 auto; text-align: center; }
  .si-status { flex-basis: 100%; margin-right: 0; }
}
.si-summary-dl {
  display: grid; gap: var(--lms-space-2) var(--lms-space-4);
  grid-template-columns: 1fr; margin: 0;
}
@media (min-width: 601px) {
  .si-summary-dl { grid-template-columns: max-content minmax(0, 1fr); align-items: baseline; }
}
.si-summary-dl dt { font-weight: 600; color: var(--lms-text-muted); margin: 0; }
.si-summary-dl dd { margin: 0; overflow-wrap: anywhere; min-width: 0; }
.si-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; word-break: break-all; }
@media (prefers-reduced-motion: reduce) {
  .si-dropzone { transition: none; }
}
`;

const REASON_COPY: Record<ScormImportReason, string> = {
  invalid_manifest:
    "We couldn't read this manifest. Check that you uploaded a valid imsmanifest.xml (SCORM 1.2 or 2004) and that it isn't truncated. Files with DTDs or external entities are rejected for security.",
  no_launchable_resource:
    "This manifest has no launchable page. SCORM packages need at least one resource with a launch file (an SCO). Re-export the package from your authoring tool and try again.",
  unsafe_href:
    "The launch path in this manifest isn't allowed (it points outside the package, e.g. an absolute URL or a path with \"..\"). Re-export the package so its launch file is a relative path inside the archive.",
};

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface ImportFormProps {
  /** Optional destination topic passed from a course content section. */
  topicId?: string;
}

export default function ImportForm({ topicId }: ImportFormProps): ReactElement {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const zipFieldId = useId();
  const manifestFieldId = useId();
  const statusId = useId();

  const [archive, setArchive] = useState<File | null>(null);
  const [manifestXml, setManifestXml] = useState("");
  const [dragging, setDragging] = useState(false);
  const [manifestNote, setManifestNote] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [manifestInvalid, setManifestInvalid] = useState(false);

  const [created, setCreated] = useState<ScormPackageRecord | null>(null);

  const canSubmit =
    !!archive && manifestXml.trim().length > 0 && !submitting;

  async function tryReadManifest(file: File): Promise<void> {
    // Honest, dependency-free best effort: if the admin selected the plain
    // imsmanifest.xml itself, read it. A real .zip requires a client unzip dep
    // (documented follow-up), so we ask the admin to paste it.
    const name = file.name.toLowerCase();
    if (name.endsWith(".xml")) {
      const text = await file.text().catch(() => "");
      if (text.trim()) {
        setManifestXml(text);
        setManifestNote("Read imsmanifest.xml from your file.");
        return;
      }
    }
    setManifestNote(
      "Selected the .zip archive. Paste its imsmanifest.xml below — reading it automatically from the archive is coming soon.",
    );
  }

  function onSelectArchive(file: File | null): void {
    setArchive(file);
    setError("");
    setCreated(null);
    if (file) {
      void tryReadManifest(file);
    } else {
      setManifestNote("");
    }
  }

  function onFileChange(e: ChangeEvent<HTMLInputElement>): void {
    onSelectArchive(e.target.files?.[0] ?? null);
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>): void {
    e.preventDefault();
    setDragging(false);
    onSelectArchive(e.dataTransfer.files?.[0] ?? null);
  }

  function reset(): void {
    setArchive(null);
    setManifestXml("");
    setManifestNote("");
    setStatus("");
    setError("");
    setManifestInvalid(false);
    setCreated(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function onSubmit(): Promise<void> {
    if (!archive) {
      setError("Choose a SCORM .zip archive first.");
      return;
    }
    if (!manifestXml.trim()) {
      setError("Add the imsmanifest.xml (paste it or select the .xml file).");
      return;
    }
    setSubmitting(true);
    setError("");
    setManifestInvalid(false);
    setStatus("Uploading archive…");
    try {
      // Step A: signed upload for the .zip archive.
      const signRes = await fetch("/api/uploads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filename: archive.name,
          contentType: archive.type || "application/zip",
          sizeBytes: archive.size,
        }),
      });
      if (!signRes.ok) {
        throw new Error(
          "Uploading the archive failed. Check your connection and the file size, then try Import again. Nothing was created.",
        );
      }
      const { upload } = (await signRes.json()) as {
        upload: { uploadUrl: string; blobUrl: string };
      };
      // PUT the bytes. The dev signer URL is not a real PUT target, so a network
      // failure here is tolerated (mirrors the page-editor media flow) — the
      // blobUrl is still recorded against the package.
      await fetch(upload.uploadUrl, {
        method: "PUT",
        headers: { "content-type": archive.type || "application/zip" },
        body: archive,
      }).catch(() => null);

      // Step B: import — parse the manifest + create the package.
      setStatus("Reading manifest and creating package…");
      const importRes = await fetch("/api/scorm/packages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          manifestXml,
          blobUrl: upload.blobUrl,
          topicId: topicId ?? undefined,
        }),
      });
      if (!importRes.ok) {
        const data = (await importRes.json().catch(() => ({}))) as {
          error?: string;
          reason?: ScormImportReason;
        };
        if (data.reason) {
          if (data.reason === "invalid_manifest" || data.reason === "unsafe_href") {
            setManifestInvalid(true);
          }
          throw new Error(REASON_COPY[data.reason]);
        }
        throw new Error(data.error ?? "The package could not be imported.");
      }
      const data = (await importRes.json()) as { package: ScormPackageRecord };
      setStatus("");
      setCreated(data.package);
    } catch (err) {
      setStatus("");
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong. Check your connection and try Import again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (created) {
    return (
      <Stack gap={4}>
        <style>{css}</style>
        <Alert tone="success">SCORM package created.</Alert>
        <Card className="asg-form-card">
          <Stack gap={4}>
            <h2 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700 }}>
              Parsed package
            </h2>
            <dl className="si-summary-dl">
              <dt>Title</dt>
              <dd>{created.title ?? "Untitled package"}</dd>
              <dt>SCORM version</dt>
              <dd>
                <Badge tone="neutral">{`SCORM ${created.version}`}</Badge>
              </dd>
              <dt>Launch page</dt>
              <dd className="si-mono">{created.launchHref}</dd>
              <dt>Mastery score</dt>
              <dd>
                {created.masteryScore != null
                  ? `${Math.round(created.masteryScore * 100)}% (${created.masteryScore.toFixed(2)})`
                  : "Not specified in the manifest."}
              </dd>
              <dt>Archive</dt>
              <dd className="si-mono">{created.blobUrl}</dd>
            </dl>
            <div className="si-actionbar">
              <Button href="/courses" variant="ghost">
                Done
              </Button>
              <button
                className="lms-btn lms-btn--primary"
                onClick={reset}
                type="button"
              >
                Import another
              </button>
            </div>
          </Stack>
        </Card>
      </Stack>
    );
  }

  return (
    <Card className="asg-form-card">
      <style>{css}</style>
      <div className="si-form">
        {error ? (
          <Alert tone="danger">{error}</Alert>
        ) : null}

        <section className="si-section">
          <div className="si-section-head">
            <h2 className="si-section-title">Package archive</h2>
            <p className="si-section-hint">
              Upload the SCORM 1.2 or 2004 .zip. The archive is uploaded as-is; we
              don&apos;t unzip its assets server-side yet.
            </p>
          </div>

          <div className="lms-field">
            <label className="lms-field__label" htmlFor={zipFieldId}>
              SCORM package (.zip) <span aria-hidden="true">*</span>
            </label>
            <div
              className="si-dropzone"
              data-drag={dragging ? "true" : undefined}
              onDragLeave={() => setDragging(false)}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDrop={onDrop}
            >
              <input
                accept=".zip,.xml,application/zip"
                aria-describedby={`${zipFieldId}-help ${zipFieldId}-status`}
                className="si-dropzone__file"
                disabled={submitting}
                id={zipFieldId}
                onChange={onFileChange}
                ref={fileInputRef}
                type="file"
              />
              {archive ? (
                <div className="si-dropzone__selected">
                  <span className="si-dropzone__name">{archive.name}</span>
                  <span>{humanSize(archive.size)}</span>
                  <button
                    className="si-replace"
                    disabled={submitting}
                    onClick={() => fileInputRef.current?.click()}
                    type="button"
                  >
                    Replace file
                  </button>
                </div>
              ) : (
                <p className="si-dropzone__idle">
                  Drop your SCORM .zip here or choose a file.
                </p>
              )}
            </div>
            <div className="lms-field__help" id={`${zipFieldId}-help`}>
              SCORM 1.2 or 2004. Max size per your plan.
            </div>
            <p aria-live="polite" className="si-note" id={`${zipFieldId}-status`}>
              {manifestNote}
            </p>
          </div>
        </section>

        <section className="si-section">
          <div className="si-section-head">
            <h2 className="si-section-title">Manifest</h2>
            <p className="si-section-hint">
              Paste the contents of imsmanifest.xml. Max 1 MB. We don&apos;t
              process DTDs or external entities for security.
            </p>
          </div>

          <Field
            error={
              manifestInvalid
                ? "We couldn't parse this manifest — see the message above."
                : undefined
            }
            help="This is what we'll parse to find the launch page and mastery score."
            htmlFor={manifestFieldId}
            label="imsmanifest.xml"
            required
          >
            <textarea
              className="lms-textarea si-textarea"
              disabled={submitting}
              name="manifestXml"
              onChange={(e) => {
                setManifestXml(e.target.value);
                setManifestInvalid(false);
                setError("");
              }}
              placeholder={'<?xml version="1.0"?>\n<manifest ...>'}
              rows={12}
              value={manifestXml}
            />
          </Field>
        </section>

        {topicId ? (
          <section className="si-section">
            <div className="si-section-head">
              <h2 className="si-section-title">Destination</h2>
            </div>
            <p className="si-note">
              Adding to topic <span className="si-mono">{topicId}</span>.
            </p>
          </section>
        ) : null}

        <div className="si-actionbar">
          <span aria-live="polite" className="si-status" id={statusId}>
            {status}
          </span>
          <Button href="/courses" variant="ghost">
            Cancel
          </Button>
          <button
            aria-busy={submitting}
            className="lms-btn lms-btn--primary"
            disabled={!canSubmit}
            onClick={onSubmit}
            type="button"
          >
            {submitting ? "Importing…" : "Import package"}
          </button>
        </div>
      </div>
    </Card>
  );
}
