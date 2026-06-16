import type { CalendarEventRecord } from "./events.js";

/** Escape a text value per RFC 5545 (commas, semicolons, backslashes, newlines). */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** UTC date-time in iCal basic format: YYYYMMDDTHHMMSSZ. */
function utcDateTime(iso: string): string {
  const d = new Date(iso);
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/** UTC date in iCal DATE format: YYYYMMDD. */
function utcDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

function eventLines(event: CalendarEventRecord, stamp: string): string[] {
  const lines = ["BEGIN:VEVENT", `UID:${event.id}@lms`, `DTSTAMP:${stamp}`];
  if (event.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${utcDate(event.startsAt)}`);
    if (event.endsAt) lines.push(`DTEND;VALUE=DATE:${utcDate(event.endsAt)}`);
  } else {
    lines.push(`DTSTART:${utcDateTime(event.startsAt)}`);
    if (event.endsAt) lines.push(`DTEND:${utcDateTime(event.endsAt)}`);
  }
  lines.push(`SUMMARY:${escapeText(event.title)}`);
  if (event.description) {
    lines.push(`DESCRIPTION:${escapeText(event.description)}`);
  }
  lines.push("END:VEVENT");
  return lines;
}

/**
 * Render events as an RFC 5545 VCALENDAR. All times are emitted in UTC (Z), so
 * the feed is timezone-correct regardless of the subscriber's locale. `stamp`
 * (DTSTAMP) is passed in to keep this pure/deterministic.
 */
export function toICalendar(
  events: CalendarEventRecord[],
  options: { calName?: string; stamp: string },
): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//LMS SaaS//Calendar//EN",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${escapeText(options.calName ?? "LMS Calendar")}`,
    ...events.flatMap((e) => eventLines(e, options.stamp)),
    "END:VCALENDAR",
  ];
  // RFC 5545 uses CRLF line endings.
  return lines.join("\r\n") + "\r\n";
}
