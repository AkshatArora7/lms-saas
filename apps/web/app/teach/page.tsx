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
import type { BadgeTone } from "@lms/ui";

import { getBranding } from "../lib/branding";
import { getSession } from "../lib/auth";
import {
  canTeach,
  getTaughtCourses,
  summarizeTeaching,
  type RiskLevel,
} from "../lib/teaching";
import SignOutButton from "../sign-out-button";

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
  padding: var(--lms-space-2) 0;
  border-top: 1px solid var(--lms-border);
  border-bottom: 1px solid var(--lms-border);
}
.tch-engage {
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-2);
}
.tch-engage__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--lms-space-2);
}
.tch-engage__label {
  color: var(--lms-text-muted);
  font-size: 0.85rem;
  font-weight: 600;
}
.tch-engage__value {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--lms-accent);
}
.tch-risk {
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-2);
}
.tch-risk__heading {
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--lms-text-muted);
  margin: 0;
}
.tch-risk__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-2);
}
.tch-risk__row {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--lms-space-2);
  padding: var(--lms-space-3);
  border: 1px solid var(--lms-border);
  border-radius: var(--lms-radius-md);
  background: var(--lms-surface-2);
}
@media (min-width: 480px) {
  .tch-risk__row {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }
}
.tch-risk__who {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.tch-risk__name {
  font-weight: 700;
  line-height: 1.3;
  margin: 0;
  overflow-wrap: anywhere;
}
.tch-risk__reason {
  color: var(--lms-text-muted);
  font-size: 0.9rem;
  margin: 0;
  overflow-wrap: anywhere;
}
.tch-risk__empty {
  color: var(--lms-text-muted);
  margin: 0;
  padding: var(--lms-space-3);
  border: 1px dashed var(--lms-border);
  border-radius: var(--lms-radius-md);
  text-align: center;
}
`;

const RISK_META: Record<RiskLevel, { label: string; tone: BadgeTone }> = {
  on_track: { label: "On track", tone: "success" },
  at_risk: { label: "At risk", tone: "warning" },
  critical: { label: "Critical", tone: "danger" },
};

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

  const courses = getTaughtCourses(session.tenantId);
  const summary = summarizeTeaching(courses);

  return (
    <AppShell brand={brand} actions={<SignOutButton />}>
      <style>{teachCss}</style>
      <Stack gap={4}>
        <Button href="/" size="sm" variant="ghost">
          ← Back to dashboard
        </Button>

        <PageHeader
          title="Teaching"
          subtitle="Engagement and at-risk learners across the courses you teach, so you can intervene early."
        />

        {courses.length ? (
          <>
            <Grid gap={4} min="200px">
              <Card>
                <div
                  className="tch-stat-card"
                  style={
                    { "--lms-stat-accent": "var(--lms-text)" } as CSSProperties
                  }
                >
                  <p className="tch-stat">{summary.courseCount}</p>
                  <p className="tch-stat-label">Courses taught</p>
                </div>
              </Card>
              <Card>
                <div
                  className="tch-stat-card"
                  style={
                    { "--lms-stat-accent": "var(--lms-text)" } as CSSProperties
                  }
                >
                  <p className="tch-stat">{summary.totalEnrolled}</p>
                  <p className="tch-stat-label">Learners enrolled</p>
                </div>
              </Card>
              <Card>
                <div
                  className="tch-stat-card"
                  style={
                    {
                      "--lms-stat-accent": "var(--lms-warning)",
                    } as CSSProperties
                  }
                >
                  <p className="tch-stat">{summary.atRiskCount}</p>
                  <p className="tch-stat-label">At-risk learners</p>
                </div>
              </Card>
            </Grid>

            <section aria-labelledby="teach-heading">
              <h2 className="tch-section-heading" id="teach-heading">
                By course
              </h2>
              <Grid gap={4} min="320px">
                {courses.map((course) => (
                  <Card key={course.id}>
                    <div className="tch-card">
                      <div className="tch-head">
                        <h3 className="tch-title">{course.title}</h3>
                        <div className="tch-chips">
                          <Badge tone="neutral">{course.code}</Badge>
                          <Badge tone="neutral">
                            {course.enrolled} enrolled
                          </Badge>
                        </div>
                      </div>

                      <div className="tch-actions">
                        {QUICK_ACTIONS.map((action) => (
                          <Button
                            key={action.key}
                            href={action.href(course.id)}
                            size="sm"
                            variant="ghost"
                          >
                            {action.label}
                          </Button>
                        ))}
                      </div>

                      <div className="tch-engage">
                        <div className="tch-engage__meta">
                          <span className="tch-engage__label">
                            Avg engagement
                          </span>
                          <span className="tch-engage__value">
                            {course.engagement}%
                          </span>
                        </div>
                        <ProgressBar
                          label={`${course.title} average engagement: ${course.engagement}%`}
                          value={course.engagement}
                        />
                      </div>

                      <div className="tch-risk">
                        <p className="tch-risk__heading">At-risk learners</p>
                        {course.atRisk.length ? (
                          <ul className="tch-risk__list">
                            {course.atRisk.map((learner) => {
                              const risk = RISK_META[learner.risk];
                              return (
                                <li className="tch-risk__row" key={learner.id}>
                                  <div className="tch-risk__who">
                                    <p className="tch-risk__name">
                                      {learner.name}
                                    </p>
                                    <p className="tch-risk__reason">
                                      {learner.reason}
                                    </p>
                                  </div>
                                  <Chip tone={risk.tone}>{risk.label}</Chip>
                                </li>
                              );
                            })}
                          </ul>
                        ) : (
                          <p className="tch-risk__empty">
                            No learners flagged - everyone is on track.
                          </p>
                        )}
                      </div>
                    </div>
                  </Card>
                ))}
              </Grid>
            </section>
          </>
        ) : (
          <EmptyState
            description="When you teach courses with enrolled learners, engagement insights appear here."
            icon="🧑‍🏫"
            title="No teaching data yet"
          />
        )}
      </Stack>
    </AppShell>
  );
}
