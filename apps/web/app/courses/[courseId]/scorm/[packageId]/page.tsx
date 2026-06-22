import { redirect } from "next/navigation";
import { Alert, Badge, Button, Chip, PageHeader, Stack } from "@lms/ui";

import { getBranding } from "../../../../lib/branding";
import { getSession } from "../../../../lib/auth";
import {
  getScormAttempt,
  getScormPackage,
  type ScormAttemptRecord,
} from "../../../../lib/scorm-api";
import { AppShell } from "../../../../lib/ui";
import SignOutButton from "../../../../sign-out-button";
import CompletionPanel from "./completion-panel";

/**
 * Learner "Play SCORM package" screen (#31). RSC resolves the session, then
 * fetches launch info (GET /scorm/packages/:id) + the learner's current attempt
 * (GET .../runtime, learnerId = server-trusted session.userId). The launch
 * column renders an honest placeholder while byte-serving package assets is a
 * documented follow-up; the sticky CompletionPanel reads the attempt and records
 * completion via the BFF runtime route.
 *
 * Layout reuses the course-player .ci-grid model (minmax(0,1fr) + sticky aside),
 * collapsing to a single column with no horizontal overflow at 360px. Status is
 * carried by TEXT + tone, the iframe/placeholder is titled, and there is no
 * keyboard trap.
 */
const playCss = `
.sc-back { align-self: flex-start; }
.sc-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--lms-space-5);
  align-items: start;
}
@media (min-width: 1025px) {
  .sc-grid { grid-template-columns: minmax(0, 1fr) 20rem; }
}
.sc-launch { min-width: 0; display: flex; flex-direction: column; gap: var(--lms-space-4); }
.sc-frame {
  border: 1px solid var(--lms-border-strong);
  border-radius: var(--lms-radius-md);
  background: var(--lms-surface-2);
  min-height: 52vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--lms-space-5);
  overflow: hidden;
}
@media (min-width: 601px) { .sc-frame { aspect-ratio: 16 / 9; min-height: 0; } }
.sc-placeholder {
  display: flex; flex-direction: column; gap: var(--lms-space-3);
  align-items: center; text-align: center; max-width: 46ch; min-width: 0;
}
.sc-placeholder svg { color: var(--lms-text-subtle); }
.sc-placeholder h2 { margin: 0; font-size: 1.15rem; font-weight: 700; }
.sc-placeholder p { margin: 0; color: var(--lms-text-muted); line-height: 1.6; overflow-wrap: anywhere; }
.sc-href { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; word-break: break-all; }
.sc-aside { min-width: 0; }
@media (min-width: 1025px) {
  .sc-aside { position: sticky; top: var(--lms-space-5); }
}
`;

const PLAY_ICON = (
  <svg
    aria-hidden="true"
    fill="none"
    height="48"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth={1.6}
    viewBox="0 0 24 24"
    width="48"
  >
    <rect height="14" rx="2" width="18" x="3" y="5" />
    <path d="M10 9l5 3-5 3z" />
  </svg>
);

export default async function ScormPlayPage({
  params,
}: {
  params: { courseId: string; packageId: string };
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const brand = getBranding(session.tenantId);
  const backHref = `/courses/${params.courseId}`;

  const pkgResult = await getScormPackage(params.packageId, session.tenantId);

  if (!pkgResult.ok) {
    return (
      <AppShell actions={<SignOutButton />} brand={brand}>
        <style>{playCss}</style>
        <Stack gap={4}>
          <Button className="sc-back" href={backHref} size="sm" variant="ghost">
            ← Back to course
          </Button>
          <PageHeader
            subtitle="We couldn't open this SCORM module."
            title="Module unavailable"
          />
          <Alert tone="warning">{pkgResult.error}</Alert>
        </Stack>
      </AppShell>
    );
  }

  const pkg = pkgResult.package;

  // The learner's attempt is read with the server-trusted learnerId. A failure
  // here shouldn't block the launch surface — fall back to "no attempt yet".
  const attemptResult = await getScormAttempt(
    params.packageId,
    session.userId,
    session.tenantId,
  );
  const initialAttempt: ScormAttemptRecord | null = attemptResult.ok
    ? attemptResult.attempt
    : null;

  const view = (() => {
    if (!initialAttempt || initialAttempt.completionStatus === "not_attempted") {
      return { label: "Not started", tone: "neutral" as const };
    }
    if (initialAttempt.completionStatus === "completed") {
      if (initialAttempt.successStatus === "passed")
        return { label: "Completed — Passed", tone: "success" as const };
      if (initialAttempt.successStatus === "failed")
        return { label: "Completed — Failed", tone: "danger" as const };
      return { label: "Completed", tone: "success" as const };
    }
    if (initialAttempt.completionStatus === "incomplete")
      return { label: "In progress", tone: "accent" as const };
    return { label: "Not started", tone: "neutral" as const };
  })();

  return (
    <AppShell actions={<SignOutButton />} brand={brand}>
      <style>{playCss}</style>
      <Stack gap={4}>
        <Button className="sc-back" href={backHref} size="sm" variant="ghost">
          ← Back to course
        </Button>

        <PageHeader
          actions={
            <Stack gap={2}>
              <Badge tone="neutral">{`SCORM ${pkg.version}`}</Badge>
              <Chip tone={view.tone}>{view.label}</Chip>
            </Stack>
          }
          subtitle="SCORM module"
          title={pkg.title ?? "SCORM module"}
        />

        <div className="sc-grid">
          <div className="sc-launch">
            <section aria-label={`SCORM content: ${pkg.title ?? "module"}`}>
              <div className="sc-frame">
                <div className="sc-placeholder">
                  {PLAY_ICON}
                  <h2>Launch coming soon</h2>
                  <p>
                    This SCORM package&apos;s interactive content will play here
                    once package files are served. Its launch page is{" "}
                    <span className="sc-href">{pkg.launchHref}</span>. In the
                    meantime, use the panel to record your completion.
                  </p>
                </div>
              </div>
            </section>

            <Alert tone="info">
              This SCORM module records your completion when you mark it complete.
              Automatic progress and score tracking directly from the content is
              coming soon.
            </Alert>
          </div>

          <aside aria-label="Your progress" className="sc-aside">
            <CompletionPanel initialAttempt={initialAttempt} pkg={pkg} />
          </aside>
        </div>
      </Stack>
    </AppShell>
  );
}
