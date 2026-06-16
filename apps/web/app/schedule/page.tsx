import { redirect } from "next/navigation";
import type { CSSProperties } from "react";
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
  type BadgeTone,
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
.sched-stat-card {
  position: relative;
  min-height: 100%;
  padding-left: var(--lms-space-4);
}
.sched-stat-card::before {
  content: "";
  position: absolute;
  inset-block: var(--lms-space-3);
  inset-inline-start: 0;
  width: 0.25rem;
  border-radius: var(--lms-radius-pill);
  background: var(--sched-accent, var(--lms-accent));
}
.sched-stat {
  color: var(--sched-accent, var(--lms-text));
  font-size: clamp(2rem, 6vw, 2.75rem);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  margin: 0;
}
.sched-stat-label,
.sched-kicker {
  color: var(--lms-text-muted);
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  line-height: 1.3;
  margin: 0;
  text-transform: uppercase;
}
.sched-next-card {
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-2);
  min-width: 0;
}
.sched-next-title {
  font-size: clamp(1.05rem, 3vw, 1.25rem);
  font-weight: 700;
  line-height: 1.25;
  margin: 0;
  overflow-wrap: anywhere;
}
.sched-meta,
.sched-time {
  color: var(--lms-text-muted);
  margin: 0;
  overflow-wrap: anywhere;
}
.sched-time {
  flex: 0 0 auto;
  font-size: 0.86rem;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  letter-spacing: 0.01em;
  white-space: nowrap;
}
.sched-section-heading {
  border-bottom: 1px solid var(--lms-border);
  font-size: clamp(1.15rem, 3vw, 1.4rem);
  font-weight: 700;
  line-height: 1.25;
  margin: 0 0 var(--lms-space-3);
  padding-bottom: var(--lms-space-2);
}
.sched-day-card {
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-3);
  height: 100%;
  min-width: 0;
}
.sched-day-head {
  align-items: baseline;
  border-bottom: 1px solid var(--lms-border);
  display: flex;
  gap: var(--lms-space-2);
  justify-content: space-between;
  padding-bottom: var(--lms-space-2);
}
.sched-day-title {
  font-size: clamp(1.1rem, 3vw, 1.35rem);
  font-weight: 700;
  line-height: 1.2;
  margin: 0;
}
.sched-day-count {
  color: var(--lms-text-muted);
  flex-shrink: 0;
  font-size: 0.82rem;
  font-weight: 700;
}
.sched-list {
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-3);
  list-style: none;
  margin: 0;
  padding: 0;
}
.sched-entry {
  background: var(--lms-surface);
  border: 1px solid var(--lms-border);
  border-radius: var(--lms-radius-md);
  min-width: 0;
  overflow: hidden;
  position: relative;
}
.sched-entry::before {
  content: "";
  position: absolute;
  inset-block: var(--lms-space-2);
  inset-inline-start: 0;
  width: 0.25rem;
  border-radius: 0 var(--lms-radius-pill) var(--lms-radius-pill) 0;
  background: var(--sched-entry-accent, var(--lms-accent));
}
.sched-entry--next {
  background: color-mix(in srgb, var(--lms-accent) 10%, var(--lms-surface));
  border-color: var(--lms-accent);
  box-shadow: var(--lms-shadow-sm);
}
.sched-entry-body {
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-2);
  min-width: 0;
  padding: var(--lms-space-3) var(--lms-space-3) var(--lms-space-3) var(--lms-space-4);
}
.sched-entry-head {
  flex-wrap: wrap;
  min-width: 0;
}
.sched-course-row {
  align-items: flex-start;
  display: flex;
  flex-wrap: wrap;
  gap: var(--lms-space-2);
  min-width: 0;
}
.sched-course {
  font-size: clamp(1rem, 2.6vw, 1.12rem);
  font-weight: 700;
  line-height: 1.25;
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
}
.sched-meta-line {
  color: var(--lms-text-muted);
  display: flex;
  flex-wrap: wrap;
  gap: var(--lms-space-1);
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
}
@media (min-width: 46rem) {
  .sched-entry-body {
    display: grid;
    grid-template-columns: minmax(8.5rem, 0.42fr) minmax(0, 1fr);
    gap: var(--lms-space-3);
  }
  .sched-time {
    padding-top: var(--lms-space-1);
  }
}
`;

const SUMMARY_ACCENTS = {
  classes: "var(--lms-accent)",
  days: "var(--lms-success)",
  next: "var(--lms-warning)",
} as const;

const NEXT_BADGE_TONE: BadgeTone = "accent";

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
  const nextEntryId = summary.next?.id;

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
            <Grid gap={4} min="13rem">
              <Card>
                <div
                  className="sched-stat-card"
                  style={
                    { "--sched-accent": SUMMARY_ACCENTS.classes } as CSSProperties
                  }
                >
                  <Stack gap={1}>
                    <p className="sched-stat">{summary.totalClasses}</p>
                    <p className="sched-stat-label">Classes this week</p>
                  </Stack>
                </div>
              </Card>
              <Card>
                <div
                  className="sched-stat-card"
                  style={
                    { "--sched-accent": SUMMARY_ACCENTS.days } as CSSProperties
                  }
                >
                  <Stack gap={1}>
                    <p className="sched-stat">{summary.daysWithClasses}</p>
                    <p className="sched-stat-label">Teaching days</p>
                  </Stack>
                </div>
              </Card>
              <Card>
                <div
                  className="sched-stat-card"
                  style={
                    { "--sched-accent": SUMMARY_ACCENTS.next } as CSSProperties
                  }
                >
                  <div className="sched-next-card">
                    <p className="sched-kicker">Up next</p>
                    {summary.next ? (
                      <>
                        <p className="sched-next-title">{summary.next.course}</p>
                        <p className="sched-meta">
                          {summary.next.day} · {formatRange(summary.next)} ·{" "}
                          {summary.next.room}
                        </p>
                      </>
                    ) : (
                      <p className="sched-meta">No upcoming classes.</p>
                    )}
                  </div>
                </div>
              </Card>
            </Grid>

            <section aria-label="This week">
              <p className="sched-section-heading">
                This week
              </p>
              <Grid gap={4} min="18rem">
                {days.map((group) => (
                  <Card as="article" className="sched-day-card" key={group.day}>
                    <div className="sched-day-head">
                      <h2 className="sched-day-title">{group.day}</h2>
                      <span className="sched-day-count">
                        {group.entries.length}{" "}
                        {group.entries.length === 1 ? "class" : "classes"}
                      </span>
                    </div>
                    <ul className="sched-list" aria-label={`${group.day} classes`}>
                      {group.entries.map((entry) => {
                        const isNext = entry.id === nextEntryId;
                        return (
                          <li
                            className={
                              isNext
                                ? "sched-entry sched-entry--next"
                                : "sched-entry"
                            }
                            key={entry.id}
                          >
                            <div className="sched-entry-body">
                              <p className="sched-time">{formatRange(entry)}</p>
                              <div className="sched-entry-main">
                                <Stack gap={2}>
                                  <Inline
                                    align="flex-start"
                                    className="sched-entry-head"
                                    gap={2}
                                    justify="space-between"
                                  >
                                    <div className="sched-course-row">
                                      {isNext ? (
                                        <Badge tone={NEXT_BADGE_TONE}>
                                          Up next
                                        </Badge>
                                      ) : null}
                                      <p className="sched-course">{entry.course}</p>
                                    </div>
                                    <Badge tone="neutral">{entry.code}</Badge>
                                  </Inline>
                                  <p className="sched-meta-line">
                                    <span>{entry.room}</span>
                                    <span aria-hidden="true">·</span>
                                    <span>{entry.instructor}</span>
                                  </p>
                                </Stack>
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </Card>
                ))}
              </Grid>
            </section>
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
