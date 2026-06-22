import { redirect } from "next/navigation";
import type { CSSProperties } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Grid,
  PageHeader,
  Stack,
} from "@lms/ui";

import { getMessages, t } from "@lms/i18n";

import { getBranding } from "../lib/branding";
import { getSession } from "../lib/auth";
import {
  ATTENDANCE_DISPLAY,
  getUserAttendance,
  groupAttendanceByDate,
  summarizeAttendance,
} from "../lib/attendance";
import { resolveRequestLocale } from "../lib/i18n";
import { AppLocaleSwitcher } from "../lib/locale-switcher";
import { AppShell, ScheduleIcon } from "../lib/ui";
import SignOutButton from "../sign-out-button";

/**
 * Scoped layout polish for the learner attendance screen. Every visual decision
 * resolves from the tenant theme tokens (var(--lms-*)) so the page stays fully
 * white-label. The summary KPI band reflows from a single stacked column on
 * phones to a multi-up grid on wider screens, and the grouped history list wraps
 * its rows so there is no horizontal overflow at 360px. Attendance status is
 * always carried by TEXT (the badge label plus an explicit "N min late"); colour
 * is only ever supplementary.
 */
const attendanceCss = `
.att-stat-card {
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-1);
  align-items: flex-start;
}
.att-stat {
  font-size: clamp(2rem, 6vw, 2.6rem);
  font-weight: 700;
  line-height: 1;
  margin: 0;
  font-variant-numeric: tabular-nums;
  color: var(--lms-stat-accent, var(--lms-text));
}
.att-stat-label {
  color: var(--lms-text-muted);
  margin: 0;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.att-section-heading {
  font-size: clamp(1.15rem, 3vw, 1.4rem);
  font-weight: 700;
  line-height: 1.25;
  margin: 0 0 var(--lms-space-3);
  padding-bottom: var(--lms-space-2);
  border-bottom: 1px solid var(--lms-border);
}
.att-group { display: flex; flex-direction: column; gap: var(--lms-space-3); }
.att-group__date {
  font-size: clamp(1rem, 2.5vw, 1.15rem);
  font-weight: 700;
  line-height: 1.25;
  margin: 0;
  overflow-wrap: anywhere;
}
.att-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}
.att-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--lms-space-2) var(--lms-space-3);
  padding: var(--lms-space-3) 0;
  border-bottom: 1px solid var(--lms-border);
}
.att-row:last-child { border-bottom: 0; padding-bottom: 0; }
.att-row:first-child { padding-top: 0; }
.att-row__main {
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-1);
  min-width: 0;
}
.att-row__period { font-weight: 600; overflow-wrap: anywhere; }
.att-row__context {
  color: var(--lms-text-muted);
  font-size: 0.85rem;
  overflow-wrap: anywhere;
}
.att-row__status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--lms-space-2);
  flex-shrink: 0;
}
.att-row__late {
  color: var(--lms-text-muted);
  font-size: 0.85rem;
  font-variant-numeric: tabular-nums;
}
`;

/**
 * Format a YYYY-MM-DD string to a human date from its PARTS, so the displayed
 * day never shifts due to UTC parsing. We build a local Date from the integer
 * components (month is 0-based) — never `new Date(str)` on the raw ISO string.
 */
function formatMeetingDate(iso: string): string {
  const [year, month, day] = iso.split("-").map((part) => Number(part));
  if (!year || !month || !day) return iso;
  const local = new Date(year, month - 1, day);
  return local.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default async function Attendance() {
  const session = await getSession();
  if (!session) redirect("/login");
  const brand = getBranding(session.tenantId);

  const result = await getUserAttendance(session.userId, session.tenantId);
  const summary = result.ok
    ? summarizeAttendance(result.history)
    : { total: 0, present: 0, absent: 0, tardy: 0, excused: 0 };
  const groups = result.ok ? groupAttendanceByDate(result.history) : [];
  const m = getMessages(await resolveRequestLocale());

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
      <style>{attendanceCss}</style>
      <Stack gap={4}>
        <Button href="/" size="sm" variant="ghost">
          {t(m, "common.backToDashboard")}
        </Button>

        <PageHeader
          title={t(m, "attendance.title")}
          subtitle={t(m, "attendance.subtitle")}
        />

        {!result.ok ? (
          <Alert tone="danger">{result.error}</Alert>
        ) : (
          <>
            <Grid gap={4} min="200px">
              <Card>
                <div
                  className="att-stat-card"
                  style={
                    { "--lms-stat-accent": "var(--lms-accent)" } as CSSProperties
                  }
                >
                  <p className="att-stat">{summary.total}</p>
                  <p className="att-stat-label">
                    {t(m, "attendance.sessionsRecorded")}
                  </p>
                </div>
              </Card>
              <Card>
                <div
                  className="att-stat-card"
                  style={
                    { "--lms-stat-accent": "var(--lms-danger)" } as CSSProperties
                  }
                >
                  <p className="att-stat">{summary.absent}</p>
                  <p className="att-stat-label">{t(m, "attendance.absences")}</p>
                </div>
              </Card>
              <Card>
                <div
                  className="att-stat-card"
                  style={
                    {
                      "--lms-stat-accent": "var(--lms-warning)",
                    } as CSSProperties
                  }
                >
                  <p className="att-stat">{summary.tardy}</p>
                  <p className="att-stat-label">{t(m, "attendance.tardies")}</p>
                </div>
              </Card>
              <Card>
                <div className="att-stat-card">
                  <p className="att-stat">{summary.excused}</p>
                  <p className="att-stat-label">{t(m, "attendance.excused")}</p>
                </div>
              </Card>
            </Grid>

            {groups.length ? (
              <section aria-labelledby="att-history-heading">
                <h2 className="att-section-heading" id="att-history-heading">
                  {t(m, "attendance.history")}
                </h2>
                <Stack gap={4}>
                  {groups.map((group) => (
                    <Card key={group.meetingDate}>
                      <div className="att-group">
                        <h3 className="att-group__date">
                          <time dateTime={group.meetingDate}>
                            {formatMeetingDate(group.meetingDate)}
                          </time>
                        </h3>
                        <ul className="att-list">
                          {group.records.map((record) => {
                            const display = ATTENDANCE_DISPLAY[record.category];
                            return (
                              <li
                                className="att-row"
                                key={`${record.sessionId}-${record.code}`}
                              >
                                <div className="att-row__main">
                                  <span className="att-row__period">
                                    {record.periodLabel ?? "Session"}
                                  </span>
                                  <span className="att-row__context">
                                    {record.orgUnitId}
                                  </span>
                                </div>
                                <div className="att-row__status">
                                  <Badge tone={display.tone}>
                                    {display.label}
                                  </Badge>
                                  {record.category === "tardy" &&
                                  record.minutesLate != null ? (
                                    <span className="att-row__late">
                                      {record.minutesLate}{" "}
                                      {t(m, "attendance.minLate")}
                                    </span>
                                  ) : null}
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    </Card>
                  ))}
                </Stack>
              </section>
            ) : (
              <EmptyState
                description={t(m, "attendance.emptyBody")}
                icon={<ScheduleIcon />}
                title={t(m, "attendance.emptyTitle")}
              />
            )}
          </>
        )}
      </Stack>
    </AppShell>
  );
}
