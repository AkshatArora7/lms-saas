import { redirect } from "next/navigation";
import {
  Alert,
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
import { getMessages, t, type Messages, type MessageKey } from "@lms/i18n";

import {
  type CourseEngagementResult,
  type EngagementComponents,
  type RiskLevel,
  type RiskReasonCode,
  getCourseEngagement,
  learnerLabel,
  RISK_LEVEL_DISPLAY,
  RISK_REASON_DISPLAY,
} from "../lib/analytics-api";
import { getBranding } from "../lib/branding";
import { getSession } from "../lib/auth";
import { resolveRequestLocale } from "../lib/i18n";
import { AppLocaleSwitcher } from "../lib/locale-switcher";
import { AppShell, CoursesIcon, statAccent, teachPolishCss } from "../lib/ui";
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

const QUICK_ACTIONS: {
  key: string;
  labelKey: MessageKey;
  href: (id: string) => string;
}[] = [
  {
    key: "discussions",
    labelKey: "teach.home.actionDiscussions",
    href: (id) => `/teach/${id}/discussions`,
  },
  {
    key: "roster",
    labelKey: "teach.home.actionRoster",
    href: (id) => `/teach/${id}/roster`,
  },
  {
    key: "announcements",
    labelKey: "teach.home.actionAnnouncements",
    href: (id) => `/teach/${id}/announcements`,
  },
  {
    key: "assignments",
    labelKey: "teach.home.actionAssignments",
    href: (id) => `/teach/${id}/assignments`,
  },
  {
    key: "gradebook",
    labelKey: "teach.home.actionGradebook",
    href: (id) => `/teach/${id}/gradebook`,
  },
  {
    key: "open",
    labelKey: "teach.home.actionOpen",
    href: (id) => `/courses/${id}`,
  },
];

/** Format a 0-100 metric as a whole-percent string, or an em dash when null. */
function pct(value: number | null): string {
  return value === null ? "—" : `${Math.round(value)}%`;
}

const COMPONENT_LABELS: {
  key: keyof EngagementComponents;
  labelKey: MessageKey;
}[] = [
  { key: "attendanceRate", labelKey: "teach.home.componentAttendance" },
  { key: "submissionRate", labelKey: "teach.home.componentSubmissions" },
  { key: "gradeAverage", labelKey: "teach.home.componentGradeAvg" },
];

/** Map a stable risk-level code → its keyed, translated label (option a from the
 * UX spec: key the shared display map's label in-page, no analytics-lib change).
 * The supplementary tone still comes from the analytics display map. */
const RISK_LEVEL_LABEL_KEY: Record<RiskLevel, MessageKey> = {
  high: "teach.home.riskHigh",
  medium: "teach.home.riskMedium",
};

const RISK_REASON_LABEL_KEY: Record<RiskReasonCode, MessageKey> = {
  low_attendance: "teach.home.reasonLowAttendance",
  missing_submissions: "teach.home.reasonMissingSubmissions",
  low_grades: "teach.home.reasonLowGrades",
};

/**
 * Per-course engagement score (element 1 of 3). Renders the live `score` 0-100
 * as a labelled ProgressBar with its three component sub-metrics. A null score
 * (no attendance, submission, or grade signal yet) shows a neutral empty state —
 * never 0% and never a fabricated number. A fetch error degrades to the same
 * calm message rather than crashing the card.
 */
function CourseEngagementPanel({
  engagement,
  m,
}: {
  engagement: CourseEngagementResult;
  m: Messages;
}) {
  if (!engagement.ok) {
    return (
      <div className="tch-engagement">
        <p className="tch-block-label">{t(m, "teach.home.engagement")}</p>
        <p className="tch-eng-empty">
          {t(m, "teach.home.engagementUnavailable")}
        </p>
      </div>
    );
  }

  const { score, components } = engagement.report.engagement;

  if (score === null) {
    return (
      <div className="tch-engagement">
        <p className="tch-block-label">{t(m, "teach.home.engagement")}</p>
        <p className="tch-eng-empty">{t(m, "teach.home.notEnoughData")}</p>
      </div>
    );
  }

  return (
    <div className="tch-engagement">
      <div className="tch-eng-head">
        <p className="tch-block-label">{t(m, "teach.home.engagement")}</p>
        <p className="tch-eng-score">{pct(score)}</p>
      </div>
      <ProgressBar
        label={t(m, "teach.home.engagementScoreLabel", {
          percent: Math.round(score),
        })}
        value={score}
      />
      <ul className="tch-components">
        {COMPONENT_LABELS.map(({ key, labelKey }) => (
          <li className="tch-component" key={key}>
            <span className="tch-component-label">{t(m, labelKey)}</span>
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
  m,
}: {
  engagement: CourseEngagementResult;
  m: Messages;
}) {
  if (!engagement.ok) {
    return (
      <div className="tch-risk">
        <p className="tch-block-label">{t(m, "teach.home.atRiskTitle")}</p>
        <p className="tch-muted">{t(m, "teach.home.atRiskUnavailable")}</p>
      </div>
    );
  }

  const { atRisk } = engagement.report;

  return (
    <div className="tch-risk">
      <p className="tch-block-label">
        {atRisk.length
          ? t(m, "teach.home.atRiskTitleCount", { count: atRisk.length })
          : t(m, "teach.home.atRiskTitle")}
      </p>
      {atRisk.length === 0 ? (
        <p className="tch-muted">{t(m, "teach.home.noAtRisk")}</p>
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
                  <Badge tone={level.tone}>
                    {t(m, RISK_LEVEL_LABEL_KEY[learner.riskLevel])}
                  </Badge>
                </div>
                <div className="tch-risk-reasons">
                  {learner.reasons.map((reason) => {
                    const r = RISK_REASON_DISPLAY[reason.code];
                    return (
                      <Chip key={reason.code} tone={r.tone}>
                        {t(m, RISK_REASON_LABEL_KEY[reason.code])}
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
  const m = getMessages(await resolveRequestLocale());

  const shellActions = (
    <>
      <AppLocaleSwitcher />
      <SignOutButton />
    </>
  );

  if (!canTeach(session.roles)) {
    return (
      <AppShell actions={shellActions} brand={brand}>
        <PageHeader
          subtitle={t(m, "teach.notAuthorizedSubtitle")}
          title={t(m, "teach.notAuthorizedTitle")}
        />
        <Alert tone="warning">
          <strong>{session.userId}</strong> — {t(m, "teach.notAuthorizedBody")}
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
      engagement: await getCourseEngagement(
        course.courseId,
        session.tenantId,
        session.userId,
        session.roles,
      ),
    })),
  );
  const atRiskTotal = countAtRisk(withEngagement);

  return (
    <AppShell actions={shellActions} brand={brand}>
      <style>{teachPolishCss}</style>
      <style>{teachCss}</style>
      <Stack gap={4}>
        <Button href="/" size="sm" variant="ghost">
          {t(m, "teach.home.backToDashboard")}
        </Button>

        <PageHeader
          subtitle={t(m, "teach.home.subtitle")}
          title={t(m, "teach.home.title")}
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
                  <p className="tch-stat-label">
                    {t(m, "teach.home.statCourses")}
                  </p>
                </div>
              </Card>
              <Card>
                <div
                  className="tch-stat-card"
                  style={statAccent("var(--lms-text)")}
                >
                  <p className="tch-stat">{summary.totalEnrolled}</p>
                  <p className="tch-stat-label">
                    {t(m, "teach.home.statLearners")}
                  </p>
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
                  <p className="tch-stat-label">
                    {t(m, "teach.home.statAtRisk")}
                  </p>
                </div>
              </Card>
            </Grid>

            <section aria-labelledby="teach-heading">
              <h2 className="tch-section-heading" id="teach-heading">
                {t(m, "teach.home.byCourse")}
              </h2>
              <Grid gap={4} min="320px">
                {withEngagement.map(({ course, engagement }) => (
                  <Card key={course.courseId}>
                    <div className="tch-card">
                      <div className="tch-head">
                        <h3 className="tch-title">{course.title}</h3>
                        <div className="tch-chips">
                          <Badge tone="neutral">
                            {t(
                              m,
                              course.enrolled === 1
                                ? "teach.home.learnerOne"
                                : "teach.home.learnerOther",
                              { count: course.enrolled },
                            )}
                          </Badge>
                        </div>
                      </div>

                      <CourseEngagementPanel engagement={engagement} m={m} />

                      <CourseAtRiskPanel engagement={engagement} m={m} />

                      <div className="tch-actions">
                        {QUICK_ACTIONS.map((action) => (
                          <Button
                            key={action.key}
                            href={action.href(course.courseId)}
                            size="sm"
                            variant="ghost"
                          >
                            {t(m, action.labelKey)}
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
            description={t(m, "teach.home.emptyBody")}
            icon={<CoursesIcon />}
            title={t(m, "teach.home.emptyTitle")}
          />
        )}
      </Stack>
    </AppShell>
  );
}
