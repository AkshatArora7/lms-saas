import { redirect } from "next/navigation";
import type { CSSProperties } from "react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Grid,
  PageHeader,
  Stack,
  type BadgeTone,
} from "@lms/ui";
import { getMessages, t, type MessageKey } from "@lms/i18n";

import { getBranding } from "../lib/branding";
import { getSession } from "../lib/auth";
import { resolveRequestLocale } from "../lib/i18n";
import { AppLocaleSwitcher } from "../lib/locale-switcher";
import {
  formatDue,
  getAssignments,
  summarizeAssignments,
  type AssignmentStatus,
} from "../lib/assignments";
import { AppShell, AssignmentsIcon } from "../lib/ui";
import SignOutButton from "../sign-out-button";

/**
 * Scoped layout polish for the learner assignments screen. Every visual
 * decision resolves from the tenant theme tokens (var(--lms-*)) so the page
 * stays fully white-label: the same markup renders correctly for a teal/rounded
 * brand and a red/sharp one. Status is differentiated by a coloured accent rail
 * + a text-labelled pill (never colour alone), and the layout reflows from a
 * single stacked column on phones to a two-up row on wider screens with no
 * horizontal overflow at 360px.
 */
const assignmentsCss = `
.asg-summary { margin: 0; }
.asg-stat-card {
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-1);
  align-items: flex-start;
}
.asg-stat {
  font-size: clamp(1.9rem, 5vw, 2.4rem);
  font-weight: 700;
  line-height: 1;
  margin: 0;
  font-variant-numeric: tabular-nums;
  color: var(--lms-stat-accent, var(--lms-text));
}
.asg-stat-label {
  color: var(--lms-text-muted);
  margin: 0;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.asg-list {
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-3);
  list-style: none;
  margin: 0;
  padding: 0;
}
.asg-card {
  position: relative;
  padding-left: var(--lms-space-5);
}
.asg-card::before {
  content: "";
  position: absolute;
  left: 0;
  top: var(--lms-space-3);
  bottom: var(--lms-space-3);
  width: 4px;
  border-radius: var(--lms-radius-pill);
  background: var(--asg-accent, var(--lms-border));
}
.asg-card--graded { opacity: 0.85; }
.asg-body {
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-2);
  min-width: 0;
}
@media (min-width: 640px) {
  .asg-body {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    gap: var(--lms-space-4);
  }
}
.asg-main { min-width: 0; display: flex; flex-direction: column; gap: var(--lms-space-2); }
.asg-topline {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--lms-space-2) var(--lms-space-3);
}
.asg-title {
  font-size: clamp(1.05rem, 2.5vw, 1.2rem);
  font-weight: 700;
  line-height: 1.25;
  margin: 0;
  overflow-wrap: anywhere;
}
.asg-meta {
  color: var(--lms-text-muted);
  margin: 0;
  font-size: 0.9rem;
  overflow-wrap: anywhere;
}
.asg-type {
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-size: 0.6875rem;
}
.asg-due {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  color: var(--lms-text-muted);
  font-size: 0.9rem;
  font-weight: 600;
}
.asg-score {
  font-weight: 600;
  color: var(--lms-success);
  white-space: nowrap;
}
.asg-action { flex-shrink: 0; display: flex; }
`;

const STATUS_LABEL_KEY: Record<AssignmentStatus, MessageKey> = {
  overdue: "assignments.statusOverdue",
  not_started: "assignments.statusNotStarted",
  submitted: "assignments.statusSubmitted",
  graded: "assignments.statusGraded",
};

const STATUS_TONE: Record<AssignmentStatus, BadgeTone> = {
  overdue: "danger",
  not_started: "warning",
  submitted: "accent",
  graded: "success",
};

/** Token-driven accent rail per status — keeps the page fully white-label. */
const STATUS_ACCENT: Record<AssignmentStatus, string> = {
  overdue: "var(--lms-danger)",
  not_started: "var(--lms-warning)",
  submitted: "var(--lms-accent)",
  graded: "var(--lms-success)",
};

const SUMMARY_CARDS: {
  key: "overdue" | "dueSoon" | "submitted";
  labelKey: MessageKey;
  accent: string;
}[] = [
  {
    key: "overdue",
    labelKey: "assignments.statOverdue",
    accent: "var(--lms-danger)",
  },
  {
    key: "dueSoon",
    labelKey: "assignments.statDueSoon",
    accent: "var(--lms-warning)",
  },
  {
    key: "submitted",
    labelKey: "assignments.statSubmitted",
    accent: "var(--lms-success)",
  },
];

export default async function AssignmentsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const brand = getBranding(session.tenantId);
  const m = getMessages(await resolveRequestLocale());

  const assignments = await getAssignments(session.userId, session.tenantId);
  const summary = summarizeAssignments(assignments);

  return (
    <AppShell
      brand={brand}
      actions={
        <>
          <AppLocaleSwitcher />
          <SignOutButton />
        </>
      }
    >
      <style>{assignmentsCss}</style>
      <Stack gap={4}>
        <Button href="/" size="sm" variant="ghost">
          {t(m, "common.backToDashboard")}
        </Button>

        <PageHeader
          title={t(m, "assignments.title")}
          subtitle={t(m, "assignments.subtitle")}
          actions={
            <Button href="/grades" variant="secondary">
              {t(m, "assignments.viewGrades")}
            </Button>
          }
        />

        {assignments.length ? (
          <>
            <Grid gap={4} min="160px">
              {SUMMARY_CARDS.map((stat) => (
                <Card key={stat.key}>
                  <div
                    className="asg-stat-card"
                    style={
                      { "--lms-stat-accent": stat.accent } as CSSProperties
                    }
                  >
                    <p className="asg-stat">{summary[stat.key]}</p>
                    <p className="asg-stat-label">{t(m, stat.labelKey)}</p>
                  </div>
                </Card>
              ))}
            </Grid>

            <ul className="asg-list" aria-label={t(m, "assignments.listLabel")}>
              {assignments.map((assignment) => {
                const graded =
                  assignment.status === "graded" &&
                  assignment.score !== undefined;
                return (
                  <li key={assignment.id}>
                    <Card
                      className={
                        assignment.status === "graded"
                          ? "asg-card asg-card--graded"
                          : "asg-card"
                      }
                      style={
                        {
                          "--asg-accent": STATUS_ACCENT[assignment.status],
                        } as CSSProperties
                      }
                    >
                      <div className="asg-body">
                        <div className="asg-main">
                          <div className="asg-topline">
                            <Badge tone={STATUS_TONE[assignment.status]}>
                              {t(m, STATUS_LABEL_KEY[assignment.status])}
                            </Badge>
                            <span className="asg-due">
                              {t(m, "assignments.due", {
                                date: formatDue(assignment.dueAt),
                              })}
                            </span>
                            {graded ? (
                              <span className="asg-score">
                                {t(m, "assignments.scored", {
                                  score: assignment.score ?? 0,
                                  points: assignment.points,
                                })}
                              </span>
                            ) : null}
                          </div>
                          <h2 className="asg-title">{assignment.title}</h2>
                          <p className="asg-meta">
                            {assignment.code
                              ? `${assignment.course} (${assignment.code})`
                              : assignment.course}
                            <span aria-hidden="true"> · </span>
                            <span className="asg-type">{assignment.type}</span>
                            <span aria-hidden="true"> · </span>
                            {t(m, "assignments.points", {
                              points: assignment.points,
                            })}
                          </p>
                        </div>
                        <div className="asg-action">
                          <Button
                            href={`/courses/${assignment.courseId}`}
                            size="sm"
                            variant="ghost"
                          >
                            {t(m, "assignments.openCourse")}
                          </Button>
                        </div>
                      </div>
                    </Card>
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <EmptyState
            description={t(m, "assignments.emptyBody")}
            icon={<AssignmentsIcon />}
            title={t(m, "assignments.emptyTitle")}
          />
        )}
      </Stack>
    </AppShell>
  );
}
