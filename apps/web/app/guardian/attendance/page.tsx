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
} from "@lms/ui";

import { getMessages, t } from "@lms/i18n";
import type { MessageKey } from "@lms/i18n";

import { getBranding } from "../../lib/branding";
import { getSession } from "../../lib/auth";
import {
  type AttendanceCategory,
  type AttendanceTone,
  groupAttendanceByDate,
  summarizeAttendance,
} from "../../lib/attendance";
import {
  type GuardianChild,
  getGuardianChildAttendance,
  getGuardianChildren,
  relationshipKey,
} from "../../lib/guardian-attendance";
import { resolveRequestLocale } from "../../lib/i18n";
import { AppLocaleSwitcher } from "../../lib/locale-switcher";
import { AppShell, CoursesIcon, ScheduleIcon, statAccent } from "../../lib/ui";
import SignOutButton from "../../sign-out-button";

/**
 * Scoped layout polish for the guardian attendance screen. The KPI band + history
 * list reuse the learner screen's `.att-*` classes verbatim (imported below) so
 * the two views stay byte-for-byte consistent; this stylesheet adds ONLY the new
 * `.gatt-*` child-selector pattern — a wrapping list of pill links that reflow
 * (never scroll) on narrow screens and meet the 44px target. Every value resolves
 * from a tenant theme token (var(--lms-*)) so the page is fully white-label, and
 * the selected chip is conveyed by aria-current + visual weight (border + filled
 * background), never colour alone.
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

/* --- New child-selector pattern (guardian only) --- */
.gatt-selector { border: 0; margin: 0; padding: 0; min-width: 0; }
.gatt-selector__legend {
  padding: 0;
  margin: 0 0 var(--lms-space-2);
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--lms-text-muted);
}
.gatt-chips {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: var(--lms-space-2);
}
.gatt-chip {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-height: 44px;
  justify-content: center;
  padding: var(--lms-space-2) var(--lms-space-3);
  border: 1px solid var(--lms-border);
  border-radius: var(--lms-radius-pill);
  background: var(--lms-surface);
  color: var(--lms-text);
  text-decoration: none;
  line-height: 1.2;
  max-width: 100%;
}
.gatt-chip:hover { border-color: var(--lms-accent); }
.gatt-chip:focus-visible {
  outline: 2px solid var(--lms-focus, var(--lms-accent));
  outline-offset: 2px;
}
.gatt-chip[aria-current="true"] {
  border-color: var(--lms-accent);
  background: var(--lms-accent-soft, var(--lms-surface));
  font-weight: 700;
}
.gatt-chip__name { font-weight: 600; overflow-wrap: anywhere; }
.gatt-chip[aria-current="true"] .gatt-chip__name { font-weight: 700; }
.gatt-chip__rel {
  font-size: 0.75rem;
  color: var(--lms-text-muted);
  overflow-wrap: anywhere;
}
.gatt-caption {
  margin: 0;
  color: var(--lms-text-muted);
  font-size: 0.85rem;
  overflow-wrap: anywhere;
}
`;

/**
 * Format a YYYY-MM-DD string to a human date from its PARTS, so the displayed
 * day never shifts due to UTC parsing. Mirrors the learner attendance screen.
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

/** Supplementary badge tone per attendance category (label always carries status). */
const CATEGORY_TONE: Record<AttendanceCategory, AttendanceTone> = {
  present: "success",
  absent: "danger",
  tardy: "warning",
  excused: "neutral",
};

/** i18n key per attendance category, so the status label is fully localized. */
const CATEGORY_LABEL_KEY: Record<AttendanceCategory, MessageKey> = {
  present: "guardianAttendance.statusPresent",
  absent: "guardianAttendance.statusAbsent",
  tardy: "guardianAttendance.statusTardy",
  excused: "guardianAttendance.statusExcused",
};

type Messages = ReturnType<typeof getMessages>;

/**
 * The display name for a child. The backend contract returns only
 * { studentUserId, relationship } — there is NO name (a reusable cross-service
 * name lookup does not exist; #326's resolution is embedded in the enrollment
 * store's own withTenant query, not a callable port). So v1 falls back to the
 * localized "Student" label, exactly as the design's childFallbackName supports.
 */
function childName(m: Messages): string {
  return t(m, "guardianAttendance.childFallbackName");
}

/** Localized relationship label for a child (display only, never authz). */
function childRelationship(m: Messages, child: GuardianChild): string {
  return t(m, `guardianAttendance.${relationshipKey(child.relationship)}` as MessageKey);
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function GuardianAttendance({
  searchParams,
}: {
  searchParams?: { child?: string | string[] };
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const brand = getBranding(session.tenantId);
  const m = getMessages(await resolveRequestLocale());

  const shell = (body: React.ReactNode) => (
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
          title={t(m, "guardianAttendance.title")}
          subtitle={t(m, "guardianAttendance.subtitle")}
        />
        {body}
      </Stack>
    </AppShell>
  );

  // 1. Authorized children (active link + consent), tenant-scoped. The guardian id
  //    is the server-side session identity, NEVER a client-supplied value.
  const childrenResult = await getGuardianChildren(session.userId, session.tenantId);

  if (!childrenResult.ok) {
    return shell(
      <Alert tone="danger">{t(m, "guardianAttendance.childrenError")}</Alert>,
    );
  }

  const children = childrenResult.children;
  const [firstChild] = children;
  if (!firstChild) {
    return shell(
      <EmptyState
        description={t(m, "guardianAttendance.noChildrenBody")}
        icon={<CoursesIcon />}
        title={t(m, "guardianAttendance.noChildrenTitle")}
      />,
    );
  }

  // 2. Resolve the selected child from ?child=ID. Deny-by-default + defense in
  //    depth: a requested id that is not in the authorized set silently falls back
  //    to the first authorized child — we NEVER confirm whether the id exists.
  const requested = firstParam(searchParams?.child);
  const selected =
    children.find((c) => c.studentUserId === requested) ?? firstChild;

  // 3. The selected child's attendance history. A backend 404 (denied) means the
  //    id is not authorized — already handled by the fallback above for the
  //    resolved child, so a denial here is treated as "no history" rather than an
  //    error that would confirm existence.
  const historyResult = await getGuardianChildAttendance(
    session.userId,
    selected.studentUserId,
    session.tenantId,
  );

  const selectedName = childName(m);
  const isError = !historyResult.ok && !historyResult.denied;

  const summary =
    historyResult.ok
      ? summarizeAttendance(historyResult.history)
      : { total: 0, present: 0, absent: 0, tardy: 0, excused: 0 };
  const groups = historyResult.ok
    ? groupAttendanceByDate(historyResult.history)
    : [];

  const selector =
    children.length > 1 ? (
      <fieldset className="gatt-selector">
        <legend className="gatt-selector__legend">
          {t(m, "guardianAttendance.selectChild")}
        </legend>
        <ul className="gatt-chips">
          {children.map((child) => {
            const isActive = child.studentUserId === selected.studentUserId;
            const name = childName(m);
            return (
              <li key={child.studentUserId}>
                <a
                  aria-current={isActive ? "true" : undefined}
                  aria-label={t(m, "guardianAttendance.viewChild", { name })}
                  className="gatt-chip"
                  href={`/guardian/attendance?child=${encodeURIComponent(
                    child.studentUserId,
                  )}`}
                >
                  <span className="gatt-chip__name">{name}</span>
                  <span className="gatt-chip__rel">
                    {childRelationship(m, child)}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      </fieldset>
    ) : (
      <p className="gatt-caption">
        {t(m, "guardianAttendance.childMeta", {
          name: selectedName,
          relationship: childRelationship(m, selected),
        })}
      </p>
    );

  return shell(
    <>
      {selector}

      {isError ? (
        <Alert tone="danger">
          {t(m, "guardianAttendance.historyError", { name: selectedName })}
        </Alert>
      ) : (
        <>
          <Grid gap={4} min="200px">
            <Card>
              <div
                className="att-stat-card"
                style={statAccent("var(--lms-accent)")}
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
                style={statAccent("var(--lms-danger)")}
              >
                <p className="att-stat">{summary.absent}</p>
                <p className="att-stat-label">{t(m, "attendance.absences")}</p>
              </div>
            </Card>
            <Card>
              <div
                className="att-stat-card"
                style={statAccent("var(--lms-warning)")}
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
            <section aria-labelledby="gatt-history-heading">
              <h2 className="att-section-heading" id="gatt-history-heading">
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
                        {group.records.map((record) => (
                          <li
                            className="att-row"
                            key={`${record.sessionId}-${record.code}`}
                          >
                            <div className="att-row__main">
                              <span className="att-row__period">
                                {record.periodLabel ??
                                  t(m, "guardianAttendance.sessionFallback")}
                              </span>
                              <span className="att-row__context">
                                {record.orgUnitId}
                              </span>
                            </div>
                            <div className="att-row__status">
                              <Badge tone={CATEGORY_TONE[record.category]}>
                                {t(m, CATEGORY_LABEL_KEY[record.category])}
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
                        ))}
                      </ul>
                    </div>
                  </Card>
                ))}
              </Stack>
            </section>
          ) : (
            <EmptyState
              description={t(m, "guardianAttendance.emptyHistoryBody", {
                name: selectedName,
              })}
              icon={<ScheduleIcon />}
              title={t(m, "guardianAttendance.emptyHistoryTitle")}
            />
          )}
        </>
      )}
    </>,
  );
}
