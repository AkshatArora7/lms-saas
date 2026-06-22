"use client";

import {
  useId,
  useState,
  type ReactElement,
} from "react";
import { Alert, Card, Chip, Stack } from "@lms/ui";
import type { BadgeTone } from "@lms/ui";

import type {
  ScormAttemptRecord,
  ScormPackageRecord,
} from "../../../../lib/scorm-api";

/**
 * Learner SCORM CompletionPanel (#31): the sticky aside that shows the current
 * attempt and lets the learner record completion via the runtime endpoint. This
 * is the honest stand-in for the full JS RTE bridge (a documented follow-up):
 * an explicit "Mark complete" (+ optional score for graded packages) PUTs the
 * BFF runtime route, which injects the server-trusted learnerId.
 *
 * Status is conveyed by TEXT + tone (never colour alone), save feedback is
 * announced via aria-live, controls are keyboard-operable with 44px targets, and
 * all visuals resolve from var(--lms-*).
 */

const css = `
.sc-panel { display: flex; flex-direction: column; gap: var(--lms-space-4); padding: var(--lms-space-4); }
.sc-panel__heading { font-size: 1.05rem; font-weight: 700; margin: 0; }
.sc-dl {
  display: grid; gap: var(--lms-space-2) var(--lms-space-3);
  grid-template-columns: max-content minmax(0, 1fr);
  align-items: baseline; margin: 0;
}
.sc-dl dt { color: var(--lms-text-muted); font-size: 0.85rem; margin: 0; }
.sc-dl dd { margin: 0; font-size: 0.95rem; overflow-wrap: anywhere; min-width: 0; }
.sc-action { display: flex; flex-direction: column; gap: var(--lms-space-3); border-top: 1px solid var(--lms-border); padding-top: var(--lms-space-4); }
.sc-disclosure {
  background: transparent; border: none; padding: 0; cursor: pointer;
  color: var(--lms-accent); font: inherit; font-weight: 600;
  align-self: flex-start; min-height: 44px;
}
.sc-disclosure:focus-visible { outline: 3px solid var(--lms-focus); outline-offset: 2px; }
.sc-score-field { display: flex; flex-direction: column; gap: var(--lms-space-1); }
.sc-score-field label { font-weight: 600; font-size: 0.9rem; }
.sc-score-field input { max-width: 100%; }
.sc-mark .lms-btn { width: 100%; }
@media (min-width: 601px) and (max-width: 1024px) {
  .sc-mark .lms-btn { width: auto; }
}
.sc-status { font-size: 0.875rem; color: var(--lms-text-muted); min-height: 1.2em; }
.sc-note { color: var(--lms-text-muted); font-size: 0.8rem; margin: 0; overflow-wrap: anywhere; }
@media (prefers-reduced-motion: reduce) {
  .sc-disclosure { transition: none; }
}
`;

interface StatusView {
  label: string;
  tone: BadgeTone;
}

function statusView(attempt: ScormAttemptRecord | null): StatusView {
  if (!attempt || attempt.completionStatus === "not_attempted") {
    return { label: "Not started", tone: "neutral" };
  }
  if (attempt.completionStatus === "completed") {
    if (attempt.successStatus === "passed") {
      return { label: "Completed — Passed", tone: "success" };
    }
    if (attempt.successStatus === "failed") {
      return { label: "Completed — Failed", tone: "danger" };
    }
    return { label: "Completed", tone: "success" };
  }
  if (attempt.completionStatus === "incomplete") {
    return { label: "In progress", tone: "accent" };
  }
  return { label: "Not started", tone: "neutral" };
}

function resultText(attempt: ScormAttemptRecord | null): string {
  if (!attempt) return "Not yet determined";
  if (attempt.successStatus === "passed") return "Passed";
  if (attempt.successStatus === "failed") return "Failed";
  return "Not yet determined";
}

function scoreText(attempt: ScormAttemptRecord | null): string {
  if (!attempt || attempt.scoreScaled == null) return "No score recorded";
  const pct = Math.round(attempt.scoreScaled * 100);
  return `${pct}% (${attempt.scoreScaled.toFixed(2)})`;
}

function masteryText(pkg: ScormPackageRecord): string {
  if (pkg.masteryScore == null) return "No passing score set";
  return `Passing score ${Math.round(pkg.masteryScore * 100)}%`;
}

interface CompletionPanelProps {
  pkg: ScormPackageRecord;
  initialAttempt: ScormAttemptRecord | null;
}

export default function CompletionPanel({
  pkg,
  initialAttempt,
}: CompletionPanelProps): ReactElement {
  const scoreFieldId = useId();
  const statusRegionId = useId();

  const [attempt, setAttempt] = useState<ScormAttemptRecord | null>(
    initialAttempt,
  );
  const [showScore, setShowScore] = useState(false);
  const [score, setScore] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const graded = pkg.masteryScore != null;
  const view = statusView(attempt);

  async function markComplete(): Promise<void> {
    setBusy(true);
    setError("");
    setStatus("Saving your progress…");

    const payload: Record<string, unknown> = { completionStatus: "completed" };
    if (graded && showScore && score.trim() !== "") {
      const raw = Number(score);
      if (!Number.isFinite(raw) || raw < 0 || raw > 100) {
        setBusy(false);
        setStatus("");
        setError("Enter a score between 0 and 100.");
        return;
      }
      payload.scoreRaw = raw;
      payload.scoreMax = 100;
    }

    try {
      const res = await fetch(
        `/api/scorm/packages/${pkg.id}/runtime`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Couldn't save — try again.");
      }
      const data = (await res.json()) as { attempt: ScormAttemptRecord };
      setAttempt(data.attempt);
      setStatus("Progress saved.");
    } catch (err) {
      setStatus("");
      setError(
        err instanceof Error ? err.message : "Couldn't save — try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="sc-panel">
      <style>{css}</style>
      <h2 className="sc-panel__heading">Your progress</h2>

      <dl className="sc-dl">
        <dt>Status</dt>
        <dd>
          <Chip tone={view.tone}>{view.label}</Chip>
        </dd>
        <dt>Result</dt>
        <dd>{resultText(attempt)}</dd>
        <dt>Score</dt>
        <dd>{scoreText(attempt)}</dd>
        <dt>Mastery</dt>
        <dd>{masteryText(pkg)}</dd>
        {attempt ? (
          <>
            <dt>Updated</dt>
            <dd>{new Date(attempt.updatedAt).toLocaleString()}</dd>
          </>
        ) : null}
      </dl>

      <div className="sc-action">
        {error ? <Alert tone="danger">{error}</Alert> : null}

        {graded ? (
          <button
            aria-controls={scoreFieldId}
            aria-expanded={showScore}
            className="sc-disclosure"
            onClick={() => setShowScore((v) => !v)}
            type="button"
          >
            {showScore ? "Hide score field" : "Report a score (optional)"}
          </button>
        ) : null}

        {graded && showScore ? (
          <div className="sc-score-field" id={scoreFieldId}>
            <label htmlFor={`${scoreFieldId}-input`}>Your score (out of 100)</label>
            <input
              className="lms-input"
              disabled={busy}
              id={`${scoreFieldId}-input`}
              inputMode="numeric"
              max={100}
              min={0}
              onChange={(e) => setScore(e.target.value)}
              type="number"
              value={score}
            />
          </div>
        ) : null}

        <Stack className="sc-mark" gap={2}>
          <button
            aria-busy={busy}
            className="lms-btn lms-btn--primary"
            disabled={busy}
            onClick={markComplete}
            type="button"
          >
            {busy ? "Saving…" : "Mark complete"}
          </button>
          <span
            aria-live="polite"
            className="sc-status"
            id={statusRegionId}
            role="status"
          >
            {status}
          </span>
        </Stack>

        <p className="sc-note">
          Use this to record that you&apos;ve finished. Your result is recorded
          against your account. Automatic tracking from the content itself is
          coming soon.
        </p>
      </div>
    </Card>
  );
}
