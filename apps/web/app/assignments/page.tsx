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
  StatCard,
  type BadgeTone,
  type StatCardTone,
} from "@lms/ui";

import { getBranding } from "../lib/branding";
import { getSession } from "../lib/auth";
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
  font-size: 11px;
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

const STATUS_LABEL: Record<AssignmentStatus, string> = {
  overdue: "Overdue",
  not_started: "Not started",
  submitted: "Submitted",
  graded: "Graded",
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
  label: string;
  tone: StatCardTone;
}[] = [
  { key: "overdue", label: "Overdue", tone: "danger" },
  { key: "dueSoon", label: "Due soon", tone: "neutral" },
  { key: "submitted", label: "Submitted", tone: "success" },
];

export default async function AssignmentsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const brand = getBranding(session.tenantId);

  const assignments = await getAssignments(session.userId, session.tenantId);
  const summary = summarizeAssignments(assignments);

  return (
    <AppShell brand={brand} actions={<SignOutButton />}>
      <style>{assignmentsCss}</style>
      <Stack gap={4}>
        <Button href="/" size="sm" variant="ghost">
          ← Back to dashboard
        </Button>

        <PageHeader
          title="Assignments"
          subtitle="Everything due across your courses — overdue and upcoming work first."
          actions={
            <Button href="/grades" variant="secondary">
              View grades
            </Button>
          }
        />

        {assignments.length ? (
          <>
            <Grid gap={4} min="160px">
              {SUMMARY_CARDS.map((stat) => (
                <StatCard
                  key={stat.key}
                  label={stat.label}
                  tone={stat.tone}
                  value={summary[stat.key]}
                />
              ))}
            </Grid>

            <ul className="asg-list" aria-label="Assignments">
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
                              {STATUS_LABEL[assignment.status]}
                            </Badge>
                            <span className="asg-due">
                              Due {formatDue(assignment.dueAt)}
                            </span>
                            {graded ? (
                              <span className="asg-score">
                                Scored {assignment.score}/{assignment.points}
                              </span>
                            ) : null}
                          </div>
                          <h2 className="asg-title">{assignment.title}</h2>
                          <p className="asg-meta">
                            {assignment.course}
                            {assignment.code ? ` (${assignment.code})` : ""} ·{" "}
                            <span className="asg-type">{assignment.type}</span>{" "}
                            · {assignment.points} pts
                          </p>
                        </div>
                        <div className="asg-action">
                          <Button
                            href={`/courses/${assignment.courseId}`}
                            size="sm"
                            variant="ghost"
                          >
                            Open course →
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
            description="When your courses post assignments, quizzes and projects, they'll appear here."
            icon={<AssignmentsIcon />}
            title="No assignments yet"
          />
        )}
      </Stack>
    </AppShell>
  );
}
