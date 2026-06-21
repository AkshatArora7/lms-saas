import { redirect } from "next/navigation";
import type { CSSProperties } from "react";
import {
  Alert,
  AppShell,
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  Grid,
  PageHeader,
  ProgressBar,
  Stack,
} from "@lms/ui";

import {
  type CourseEngagementResult,
  type EngagementComponents,
  getCourseEngagement,
  learnerLabel,
  RISK_LEVEL_DISPLAY,
  RISK_REASON_DISPLAY,
} from "../lib/analytics-api";
import { getBranding } from "../lib/branding";
import { getSession } from "../lib/auth";
import {
  canTeach,
  getTaughtCourses,
  summarizeTeaching,
  type TaughtCourse,
} from "../lib/teaching";
import SignOutButton from "../sign-out-button";

/** A taught course paired with its live engagement read (or fetch error). */
interface CourseWithEngagement {
  course: TaughtCourse;
  engagement: CourseEngagementResult;
}

/** Total at-risk learners across every course whose engagement read succeeded.
 * Courses that errored or have no data simply contribute nothing — never a
 * fabricated count. */
function countAtRisk(items: CourseWithEngagement[]): number {
  return items.reduce(
    (sum, { engagement }) =>
      engagement.ok ? sum + engagement.report.atRisk.length : sum,
    0,
  );
}

/**
 * Scoped layout polish for the instructor teaching dashboard. Every visual
 * decision resolves from the tenant theme tokens (var(--lms-*)) so the page
 * stays fully white-label: the same markup renders correctly for a teal/rounded
 * brand and a red/sharp one. The summary band leads with three stats (the
 * at-risk count subtly tinted via the warning token), then a responsive grid of
 * course cards — clean header, a wrapping quick-actions row, an engagement bar,
 * and a scannable at-risk list. Risk is always carried by a TEXT pill (Chip),
 * never colour alone, and the layout reflows from a single stacked column on
 * phones to a two-up grid on desktop with no horizontal overflow at 360px.
 */
const teachCss = `
.tch-stat-card {
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-1);
  align-items: flex-start;
}
.tch-stat {
  font-size: clamp(1.9rem, 5vw, 2.4rem);
  font-weight: 700;
  line-height: 1;
  margin: 0;
  font-variant-numeric: tabular-nums;
  color: var(--lms-stat-accent, var(--lms-text));
}
.tch-stat-label {
  color: var(--lms-stat-accent, var(--lms-text-muted));
  margin: 0;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.tch-section-heading {
  font-size: clamp(1.15rem, 3vw, 1.4rem);
  font-weight: 700;
  line-height: 1.25;
  margin: 0 0 var(--lms-space-3);
  padding-bottom: var(--lms-space-2);
  border-bottom: 1px solid var(--lms-border);
}
.tch-card {
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-4);
  height: 100%;
}
.tch-head {
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-2);
  min-width: 0;
}
.tch-title {
  font-size: clamp(1.05rem, 2.5vw, 1.25rem);
  font-weight: 700;
  line-height: 1.25;
  margin: 0;
  overflow-wrap: anywhere;
}
.tch-chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--lms-space-2);
}
.tch-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--lms-space-2);
  padding-top: var(--lms-space-3);
  border-top: 1px solid var(--lms-border);
  margin-top: auto;
}
.tch-block-label {
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--lms-text-muted);
  margin: 0 0 var(--lms-space-2);
}
.tch-engagement {
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-2);
  min-width: 0;
}
.tch-eng-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--lms-space-2);
}
.tch-eng-score {
  font-size: clamp(1.4rem, 4vw, 1.75rem);
  font-weight: 700;
  line-height: 1;
  margin: 0;
  font-variant-numeric: tabular-nums;
}
.tch-eng-empty {
  font-size: 0.85rem;
  color: var(--lms-text-muted);
  margin: 0;
}
.tch-components {
  display: flex;
  flex-wrap: wrap;
  gap: var(--lms-space-2) var(--lms-space-4);
  margin: var(--lms-space-1) 0 0;
  padding: 0;
  list-style: none;
}
.tch-component {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.tch-component-label {
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--lms-text-muted);
}
.tch-component-value {
  font-size: 0.95rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.tch-risk {
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-2);
  min-width: 0;
}
.tch-risk-list {
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}
.tch-risk-item {
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-2);
  padding: var(--lms-space-3);
  border: 1px solid var(--lms-border);
  border-radius: var(--lms-radius-md, 8px);
  min-width: 0;
}
.tch-risk-top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--lms-space-2);
}
.tch-risk-name {
  font-size: 0.9rem;
  font-weight: 600;
  margin: 0;
  overflow-wrap: anywhere;
}
.tch-risk-reasons {
  display: flex;
  flex-wrap: wrap;
  gap: var(--lms-space-2);
}
.tch-muted {
  font-size: 0.85rem;
  color: var(--lms-text-muted);
  margin: 0;
}
`;

const statAccent = (color: string): CSSProperties =>
  ({ "--lms-stat-accent": color }) as CSSProperties;

const QUICK_ACTIONS: {
  key: string;
  label: string;
  href: (id: string) => string;
}[] = [
  {
    key: "discussions",
    label: "Discussions",
    href: (id) => `/teach/${id}/discussions`,
  },
  { key: "roster", label: "Roster", href: (id) => `/teach/${id}/roster` },
  {
    key: "announcements",
    label: "Announcements",
    href: (id) => `/teach/${id}/announcements`,
  },
  {
    key: "assignments",
    label: "Assignments",
    href: (id) => `/teach/${id}/assignments`,
  },
  {
    key: "gradebook",
    label: "Gradebook",
    href: (id) => `/teach/${id}/gradebook`,
  },
  { key: "open", label: "Open →", href: (id) => `/courses/${id}` },
];

/** Format a 0-100 metric as a whole-percent string, or an em dash when null. */
function pct(value: number | null): string {
  return value === null ? "—" : `${Math.round(value)}%`;
}

const COMPONENT_LABELS: { key: keyof EngagementComponents; label: string }[] = [
  { key: "attendanceRate", label: "Attendance" },
  { key: "submissionRate", label: "Submissions" },
  { key: "gradeAverage", label: "Grade avg" },
];

/**
 * Per-course engagement score (element 1 of 3). Renders the live `score` 0-100
 * as a labelled ProgressBar with its three component sub-metrics. A null score
 * (no attendance, submission, or grade signal yet) shows a neutral empty state —
 * never 0% and never a fabricated number. A fetch error degrades to the same
 * calm message rather than crashing the card.
 */
function CourseEngagementPanel({
  engagement,
}: {
  engagement: CourseEngagementResult;
}) {
  if (!engagement.ok) {
    return (
      <div className="tch-engagement">
        <p className="tch-block-label">Engagement</p>
        <p className="tch-eng-empty">Engagement insights are unavailable.</p>
      </div>
    );
  }

  const { score, components } = engagement.report.engagement;

  if (score === null) {
    return (
      <div className="tch-engagement">
        <p className="tch-block-label">Engagement</p>
        <p className="tch-eng-empty">Not enough data yet</p>
      </div>
    );
  }

  return (
    <div className="tch-engagement">
      <div className="tch-eng-head">
        <p className="tch-block-label">Engagement</p>
        <p className="tch-eng-score">{pct(score)}</p>
      </div>
      <ProgressBar
        label={`Engagement score ${Math.round(score)} percent`}
        value={score}
      />
      <ul className="tch-components">
        {COMPONENT_LABELS.map(({ key, label }) => (
          <li className="tch-component" key={key}>
            <span className="tch-component-label">{label}</span>
            <span className="tch-component-value">{pct(components[key])}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Per-course at-risk learner list (element 2 of 3). Each learner carries a
 * text-first risk-level pill (high/medium — never colour alone) and their reason
 * codes as human-readable chips. Until roster name enrichment lands (#278/#279)
 * the label is a stable id-derived string, not a fabricated name. An empty list
 * shows "No at-risk learners"; a fetch error shows a calm unavailable message.
 */
function CourseAtRiskPanel({
  engagement,
}: {
  engagement: CourseEngagementResult;
}) {
  if (!engagement.ok) {
    return (
      <div className="tch-risk">
        <p className="tch-block-label">At-risk learners</p>
        <p className="tch-muted">At-risk insights are unavailable.</p>
      </div>
    );
  }

  const { atRisk } = engagement.report;

  return (
    <div className="tch-risk">
      <p className="tch-block-label">
        At-risk learners{atRisk.length ? ` (${atRisk.length})` : ""}
      </p>
      {atRisk.length === 0 ? (
        <p className="tch-muted">No at-risk learners 🎉</p>
      ) : (
        <ul className="tch-risk-list">
          {atRisk.map((learner) => {
            const level = RISK_LEVEL_DISPLAY[learner.riskLevel];
            return (
              <li className="tch-risk-item" key={learner.learnerId}>
                <div className="tch-risk-top">
                  <p className="tch-risk-name">
                    {learner.displayName ?? learnerLabel(learner.learnerId)}
                  </p>
                  <Badge tone={level.tone}>{level.label}</Badge>
                </div>
                <div className="tch-risk-reasons">
                  {learner.reasons.map((reason) => {
                    const r = RISK_REASON_DISPLAY[reason.code];
                    return (
                      <Chip key={reason.code} tone={r.tone}>
                        {r.label}
                      </Chip>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default async function Teach() {
  const session = await getSession();
  if (!session) redirect("/login");
  const brand = getBranding(session.tenantId);

  if (!canTeach(session.roles)) {
    return (
      <AppShell brand={brand} actions={<SignOutButton />}>
        <PageHeader
          title="Teaching"
          subtitle="Engagement insights for the courses you teach."
        />
        <Alert tone="info">
          This dashboard is available to instructors. Your account does not
          currently hold a teaching role.
        </Alert>
      </AppShell>
    );
  }

  const courses = await getTaughtCourses(session.userId, session.tenantId);
  const summary = summarizeTeaching(courses);

  // Fan out the per-course engagement reads in parallel, alongside (and in the
  // same spirit as) the per-course roster fetch already done in getTaughtCourses.
  // Each read is a discriminated union, so a single slow/failed course degrades
  // to a calm empty state instead of failing the whole page.
  const withEngagement: CourseWithEngagement[] = await Promise.all(
    courses.map(async (course) => ({
      course,
      engagement: await getCourseEngagement(course.courseId, session.tenantId),
    })),
  );
  const atRiskTotal = countAtRisk(withEngagement);

  return (
    <AppShell brand={brand} actions={<SignOutButton />}>
      <style>{teachCss}</style>
      <Stack gap={4}>
        <Button href="/" size="sm" variant="ghost">
          ← Back to dashboard
        </Button>

        <PageHeader
          title="Teaching"
          subtitle="The courses you teach, with quick links into each course's roster, assignments, discussions, announcements, and gradebook."
        />

        {courses.length ? (
          <>
            <Grid gap={4} min="200px">
              <Card>
                <div
                  className="tch-stat-card"
                  style={statAccent("var(--lms-text)")}
                >
                  <p className="tch-stat">{summary.courseCount}</p>
                  <p className="tch-stat-label">Courses taught</p>
                </div>
              </Card>
              <Card>
                <div
                  className="tch-stat-card"
                  style={statAccent("var(--lms-text)")}
                >
                  <p className="tch-stat">{summary.totalEnrolled}</p>
                  <p className="tch-stat-label">Learners enrolled</p>
                </div>
              </Card>
              <Card>
                <div
                  className="tch-stat-card"
                  style={statAccent(
                    atRiskTotal > 0
                      ? "var(--lms-warning, var(--lms-text))"
                      : "var(--lms-text)",
                  )}
                >
                  <p className="tch-stat">{atRiskTotal}</p>
                  <p className="tch-stat-label">At-risk learners</p>
                </div>
              </Card>
            </Grid>

            <section aria-labelledby="teach-heading">
              <h2 className="tch-section-heading" id="teach-heading">
                By course
              </h2>
              <Grid gap={4} min="320px">
                {withEngagement.map(({ course, engagement }) => (
                  <Card key={course.courseId}>
                    <div className="tch-card">
                      <div className="tch-head">
                        <h3 className="tch-title">{course.title}</h3>
                        <div className="tch-chips">
                          <Badge tone="neutral">
                            {course.enrolled}{" "}
                            {course.enrolled === 1 ? "learner" : "learners"}
                          </Badge>
                        </div>
                      </div>

                      <CourseEngagementPanel engagement={engagement} />

                      <CourseAtRiskPanel engagement={engagement} />

                      <div className="tch-actions">
                        {QUICK_ACTIONS.map((action) => (
                          <Button
                            key={action.key}
                            href={action.href(course.courseId)}
                            size="sm"
                            variant="ghost"
                          >
                            {action.label}
                          </Button>
                        ))}
                      </div>
                    </div>
                  </Card>
                ))}
              </Grid>
            </section>
          </>
        ) : (
          <EmptyState
            description="When you teach courses with enrolled learners, they appear here."
            icon="🧑‍🏫"
            title="No teaching data yet"
          />
        )}
      </Stack>
    </AppShell>
  );
}
