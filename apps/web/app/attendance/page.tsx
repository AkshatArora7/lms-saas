import { redirect } from "next/navigation";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Grid,
  PageHeader,
  Stack,
  StatCard,
} from "@lms/ui";

import { getBranding } from "../lib/branding";
import { getSession } from "../lib/auth";
import {
  ATTENDANCE_DISPLAY,
  getUserAttendance,
  groupAttendanceByDate,
  summarizeAttendance,
} from "../lib/attendance";
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

  return (
    <AppShell brand={brand} actions={<SignOutButton />}>
      <style>{attendanceCss}</style>
      <Stack gap={4}>
        <Button href="/" size="sm" variant="ghost">
          ← Back to dashboard
        </Button>

        <PageHeader
          title="My attendance"
          subtitle="Your recorded attendance across every session, newest first."
        />

        {!result.ok ? (
          <Alert tone="danger">{result.error}</Alert>
        ) : (
          <>
            <Grid gap={4} min="200px">
              <StatCard
                label="Sessions recorded"
                tone="accent"
                value={summary.total}
              />
              <StatCard label="Absences" tone="danger" value={summary.absent} />
              <StatCard label="Tardies" value={summary.tardy} />
              <StatCard label="Excused" value={summary.excused} />
            </Grid>

            {groups.length ? (
              <section aria-labelledby="att-history-heading">
                <h2 className="att-section-heading" id="att-history-heading">
                  History
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
                                      {record.minutesLate} min late
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
                description="Once your sessions are recorded, your attendance history will appear here."
                icon={<ScheduleIcon />}
                title="No attendance recorded yet"
              />
            )}
          </>
        )}
      </Stack>
    </AppShell>
  );
}
