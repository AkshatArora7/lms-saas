import { redirect } from "next/navigation";
import {
  AppShell,
  Badge,
  Button,
  Card,
  EmptyState,
  Grid,
  Inline,
  PageHeader,
  Stack,
} from "@lms/ui";

import { getBranding } from "../lib/branding";
import { getSession } from "../lib/auth";
import {
  getWeekSchedule,
  groupByDay,
  summarizeWeek,
  type ScheduleEntry,
} from "../lib/schedule";
import SignOutButton from "../sign-out-button";

const scheduleCss = `
.sched-stat {
  font-size: 28px;
  font-weight: 700;
  line-height: 1.1;
  margin: 0;
}
.sched-stat-label {
  color: var(--lms-text-muted);
  margin: 0;
}
.sched-day-title {
  font-size: 16px;
  margin: 0;
}
.sched-list {
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-2);
  list-style: none;
  margin: 0;
  padding: 0;
}
.sched-entry {
  border-left: 3px solid var(--lms-accent);
  padding: var(--lms-space-1) 0 var(--lms-space-1) var(--lms-space-3);
}
.sched-time {
  color: var(--lms-text-muted);
  font-variant-numeric: tabular-nums;
  margin: 0;
}
.sched-course {
  font-weight: 600;
  margin: 0;
  overflow-wrap: anywhere;
}
.sched-meta {
  color: var(--lms-text-muted);
  margin: 0;
  overflow-wrap: anywhere;
}
.sched-next {
  overflow-wrap: anywhere;
}
`;

function formatTime(hhmm: string): string {
  const [hRaw = "0", m = "00"] = hhmm.split(":");
  const h = Number.parseInt(hRaw, 10);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${m} ${period}`;
}

function formatRange(entry: ScheduleEntry): string {
  return `${formatTime(entry.start)} – ${formatTime(entry.end)}`;
}

export default async function SchedulePage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const brand = getBranding(session.tenantId);

  const entries = getWeekSchedule(session.tenantId);
  const days = groupByDay(entries);
  const summary = summarizeWeek(entries);

  return (
    <AppShell brand={brand} actions={<SignOutButton />}>
      <style>{scheduleCss}</style>
      <Stack gap={4}>
        <Button href="/" size="sm" variant="ghost">
          ← Back to dashboard
        </Button>

        <PageHeader
          title="My schedule"
          subtitle="Your classes this week — times, rooms, and instructors."
        />

        {entries.length ? (
          <>
            <Grid gap={4} min="200px">
              <Card>
                <Stack gap={1}>
                  <p className="sched-stat">{summary.totalClasses}</p>
                  <p className="sched-stat-label">Classes this week</p>
                </Stack>
              </Card>
              <Card>
                <Stack gap={1}>
                  <p className="sched-stat">{summary.daysWithClasses}</p>
                  <p className="sched-stat-label">Teaching days</p>
                </Stack>
              </Card>
              <Card>
                <Stack gap={2}>
                  <p className="sched-stat-label">Up next</p>
                  {summary.next ? (
                    <div className="sched-next">
                      <p className="sched-course">{summary.next.course}</p>
                      <p className="sched-meta">
                        {summary.next.day} · {formatRange(summary.next)} ·{" "}
                        {summary.next.room}
                      </p>
                    </div>
                  ) : (
                    <p className="sched-meta">No upcoming classes.</p>
                  )}
                </Stack>
              </Card>
            </Grid>

            <Grid gap={4} min="260px">
              {days.map((group) => (
                <section key={group.day} aria-labelledby={`day-${group.day}`}>
                  <Card>
                    <Stack gap={3}>
                      <h2 className="sched-day-title" id={`day-${group.day}`}>
                        {group.day}
                      </h2>
                      <ul className="sched-list">
                        {group.entries.map((entry) => (
                          <li className="sched-entry" key={entry.id}>
                            <Stack gap={1}>
                              <p className="sched-time">{formatRange(entry)}</p>
                              <Inline gap={2} justify="space-between">
                                <p className="sched-course">{entry.course}</p>
                                <Badge tone="neutral">{entry.code}</Badge>
                              </Inline>
                              <p className="sched-meta">
                                {entry.room} · {entry.instructor}
                              </p>
                            </Stack>
                          </li>
                        ))}
                      </ul>
                    </Stack>
                  </Card>
                </section>
              ))}
            </Grid>
          </>
        ) : (
          <EmptyState
            description="Once your school publishes a timetable, your weekly classes will appear here."
            icon="🗓️"
            title="No schedule published"
          />
        )}
      </Stack>
    </AppShell>
  );
}
