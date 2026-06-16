import { redirect } from "next/navigation";
import type { CSSProperties } from "react";
import {
  AppShell,
  Badge,
  Button,
  Card,
  EmptyState,
  Grid,
  PageHeader,
  ProgressBar,
  Stack,
} from "@lms/ui";

import { getBranding } from "../lib/branding";
import { getSession } from "../lib/auth";
import { getCourseGrades, summarizeGrades } from "../lib/grades";
import SignOutButton from "../sign-out-button";

/**
 * Scoped layout polish for the learner grades screen. Every visual decision
 * resolves from the tenant theme tokens (var(--lms-*)) so the page stays fully
 * white-label: the same markup renders correctly for a teal/rounded brand and a
 * red/sharp one. The per-course letter grade is the focal point — a prominent
 * badge tinted by standing (success / warning / danger) — but the standing is
 * always carried by TEXT (letter + percent), never colour alone. The layout
 * reflows from a single stacked column on phones to a two-up grid on wider
 * screens with no horizontal overflow at 360px.
 */
const gradesCss = `
.grd-stat-card {
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-1);
  align-items: flex-start;
}
.grd-stat {
  font-size: clamp(2rem, 6vw, 2.6rem);
  font-weight: 700;
  line-height: 1;
  margin: 0;
  font-variant-numeric: tabular-nums;
  color: var(--lms-stat-accent, var(--lms-text));
}
.grd-stat-label {
  color: var(--lms-text-muted);
  margin: 0;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.grd-section-heading {
  font-size: clamp(1.15rem, 3vw, 1.4rem);
  font-weight: 700;
  line-height: 1.25;
  margin: 0 0 var(--lms-space-2);
  padding-bottom: var(--lms-space-2);
  border-bottom: 1px solid var(--lms-border);
}
.grd-card {
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-3);
  height: 100%;
}
.grd-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--lms-space-3);
}
.grd-head__main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-1);
  align-items: flex-start;
}
.grd-title {
  font-size: clamp(1.05rem, 2.5vw, 1.25rem);
  font-weight: 700;
  line-height: 1.25;
  margin: 0;
  overflow-wrap: anywhere;
}
.grd-grade {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  flex-shrink: 0;
  min-width: 64px;
  padding: var(--lms-space-2) var(--lms-space-3);
  border-radius: var(--lms-radius-md);
  background: color-mix(in srgb, var(--grd-accent) 14%, var(--lms-surface));
  color: var(--grd-accent);
}
.grd-grade__letter {
  font-size: clamp(1.5rem, 4vw, 1.9rem);
  font-weight: 700;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.grd-grade__pct {
  font-size: 0.8rem;
  font-weight: 600;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
}
.grd-cats {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-3);
}
.grd-cat { display: flex; flex-direction: column; gap: var(--lms-space-1); }
.grd-cat__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--lms-space-2);
}
.grd-cat__name { font-weight: 600; overflow-wrap: anywhere; min-width: 0; }
.grd-cat__meta {
  display: flex;
  align-items: center;
  gap: var(--lms-space-2);
  flex-shrink: 0;
}
.grd-cat__score {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  min-width: 2.75ch;
  text-align: right;
}
.grd-cat__bar {
  height: 6px;
  width: 100%;
  border-radius: var(--lms-radius-pill);
  background: var(--lms-surface-2);
  overflow: hidden;
}
.grd-cat__fill {
  height: 100%;
  border-radius: var(--lms-radius-pill);
  background: var(--lms-accent);
}
`;

type GradeTone = "success" | "warning" | "danger";

/** Map standing to a token-driven accent so the badge tint stays white-label. */
const GRADE_ACCENT: Record<GradeTone, string> = {
  success: "var(--lms-success)",
  warning: "var(--lms-warning)",
  danger: "var(--lms-danger)",
};

/**
 * Derive a standing tone from the letter (preferred) with a numeric fallback.
 * A/B → on track, C → watch, D/F → at risk. Colour is supplementary only; the
 * letter and percent always communicate the grade in text.
 */
function gradeTone(letter: string, percent: number): GradeTone {
  const first = letter.trim().charAt(0).toUpperCase();
  if (first === "A" || first === "B") return "success";
  if (first === "C") return "warning";
  if (first === "D" || first === "F") return "danger";
  if (percent >= 80) return "success";
  if (percent >= 70) return "warning";
  return "danger";
}

export default async function Grades() {
  const session = await getSession();
  if (!session) redirect("/login");
  const brand = getBranding(session.tenantId);
  const grades = getCourseGrades(session.tenantId);
  const summary = summarizeGrades(grades);

  return (
    <AppShell brand={brand} actions={<SignOutButton />}>
      <style>{gradesCss}</style>
      <Stack gap={4}>
        <Button href="/" size="sm" variant="ghost">
          ← Back to dashboard
        </Button>

        <PageHeader
          title="Grades"
          subtitle="Your current grade in each course, with a breakdown by category."
        />

        {grades.length ? (
          <>
            <Grid gap={4} min="200px">
              <Card>
                <div
                  className="grd-stat-card"
                  style={
                    { "--lms-stat-accent": "var(--lms-accent)" } as CSSProperties
                  }
                >
                  <p className="grd-stat">{summary.average ?? "—"}%</p>
                  <p className="grd-stat-label">Average across courses</p>
                </div>
              </Card>
              <Card>
                <div className="grd-stat-card">
                  <p className="grd-stat">{summary.courseCount}</p>
                  <p className="grd-stat-label">Graded courses</p>
                </div>
              </Card>
            </Grid>

            <section aria-labelledby="grades-heading">
              <h2 className="grd-section-heading" id="grades-heading">
                By course
              </h2>
              <Grid gap={4} min="320px">
                {grades.map((grade) => {
                  const tone = gradeTone(grade.letter, grade.percent);
                  return (
                    <Card key={grade.courseId}>
                      <div className="grd-card">
                        <div className="grd-head">
                          <div className="grd-head__main">
                            <h3 className="grd-title">{grade.title}</h3>
                            <Badge tone="neutral">{grade.code}</Badge>
                          </div>
                          <div
                            className="grd-grade"
                            style={
                              {
                                "--grd-accent": GRADE_ACCENT[tone],
                              } as CSSProperties
                            }
                          >
                            <span className="grd-grade__letter">
                              {grade.letter}
                            </span>
                            <span className="grd-grade__pct">
                              {grade.percent}%
                            </span>
                          </div>
                        </div>

                        <ProgressBar
                          label={`${grade.title} overall grade: ${grade.percent}%`}
                          value={grade.percent}
                        />

                        <ul className="grd-cats">
                          {grade.categories.map((category) => (
                            <li className="grd-cat" key={category.name}>
                              <div className="grd-cat__row">
                                <span className="grd-cat__name">
                                  {category.name}
                                </span>
                                <div className="grd-cat__meta">
                                  <Badge tone="neutral">
                                    {category.weight}% weight
                                  </Badge>
                                  <span className="grd-cat__score">
                                    {category.score}%
                                  </span>
                                </div>
                              </div>
                              <div className="grd-cat__bar" aria-hidden="true">
                                <div
                                  className="grd-cat__fill"
                                  style={{ width: `${category.score}%` }}
                                />
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </Card>
                  );
                })}
              </Grid>
            </section>
          </>
        ) : (
          <EmptyState
            description="Grades will appear here once your work has been graded."
            icon="📊"
            title="No grades yet"
          />
        )}
      </Stack>
    </AppShell>
  );
}
