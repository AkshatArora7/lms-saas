import { redirect } from "next/navigation";
import {
  AppShell,
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Inline,
  PageHeader,
  Stack,
} from "@lms/ui";

import { getBranding } from "../lib/branding";
import { getSession } from "../lib/auth";
import {
  getAnnouncements,
  relativeTime,
  summarizeAnnouncements,
  type AnnouncementScope,
} from "../lib/announcements";
import SignOutButton from "../sign-out-button";

/**
 * Scoped layout polish for the learner announcements inbox. Every visual
 * decision resolves from the tenant theme tokens (var(--lms-*)) so the page
 * stays fully white-label — the same markup renders correctly for a teal/rounded
 * brand and a red/sharp one, and never names a single school. Unread items are
 * differentiated by a token-driven accent rail PLUS a text-labelled "Unread"
 * dot (never colour alone), scope is carried by a labelled Badge, and the list
 * reflows from a single stacked column on phones to a roomier desktop layout
 * with no horizontal overflow at 360px.
 */
const announcementsCss = `
.ann-list {
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-3);
  list-style: none;
  margin: 0;
  padding: 0;
}
.ann-card {
  position: relative;
  padding-left: var(--lms-space-5);
}
.ann-card::before {
  content: "";
  position: absolute;
  left: 0;
  top: var(--lms-space-3);
  bottom: var(--lms-space-3);
  width: 4px;
  border-radius: var(--lms-radius-pill);
  background: transparent;
}
.ann-card--unread::before {
  background: var(--lms-accent);
}
.ann-card--read { opacity: 0.92; }
.ann-body-wrap {
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-2);
  min-width: 0;
}
.ann-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--lms-space-2) var(--lms-space-3);
}
.ann-headline {
  display: flex;
  align-items: baseline;
  gap: var(--lms-space-2);
  min-width: 0;
}
.ann-dot {
  background: var(--lms-accent);
  border-radius: var(--lms-radius-pill);
  display: inline-block;
  height: 8px;
  width: 8px;
  flex-shrink: 0;
  transform: translateY(-1px);
}
.ann-title {
  font-size: clamp(1.05rem, 2.5vw, 1.25rem);
  font-weight: 700;
  line-height: 1.3;
  margin: 0;
  overflow-wrap: anywhere;
  min-width: 0;
}
.ann-card--read .ann-title { font-weight: 600; }
.ann-body {
  color: var(--lms-text-muted);
  margin: 0;
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
}
.ann-meta {
  color: var(--lms-text-muted);
  margin: 0;
  font-size: 0.9rem;
  overflow-wrap: anywhere;
}
.ann-meta__sep { color: var(--lms-border); padding: 0 0.15em; }
`;

type Filter = "all" | AnnouncementScope;

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "all", label: "All" },
  { key: "course", label: "Courses" },
  { key: "school", label: "School" },
];

function parseFilter(value: string | string[] | undefined): Filter {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "course" || raw === "school" ? raw : "all";
}

export default async function AnnouncementsPage({
  searchParams,
}: {
  searchParams?: { scope?: string | string[] };
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const brand = getBranding(session.tenantId);

  const all = await getAnnouncements(session.userId, session.tenantId);
  const summary = summarizeAnnouncements(all);
  const filter = parseFilter(searchParams?.scope);
  const visible = filter === "all" ? all : all.filter((a) => a.scope === filter);

  return (
    <AppShell brand={brand} actions={<SignOutButton />}>
      <style>{announcementsCss}</style>
      <Stack gap={4}>
        <Button href="/" size="sm" variant="ghost">
          ← Back to dashboard
        </Button>

        <PageHeader
          title="Announcements"
          subtitle={
            summary.unread
              ? `You have ${summary.unread} unread of ${summary.total}.`
              : "You're all caught up."
          }
          actions={
            <Inline gap={2}>
              {FILTERS.map((option) => (
                <Button
                  href={
                    option.key === "all"
                      ? "/announcements"
                      : `/announcements?scope=${option.key}`
                  }
                  key={option.key}
                  size="sm"
                  variant={filter === option.key ? "primary" : "secondary"}
                >
                  {option.label}
                </Button>
              ))}
            </Inline>
          }
        />

        {all.length === 0 ? (
          <EmptyState
            description="When your school or your courses post updates, they'll show up here."
            icon="📣"
            title="No announcements yet"
          />
        ) : visible.length === 0 ? (
          <Alert tone="info">
            No {filter === "course" ? "course" : "school"} announcements right
            now. Try a different filter.
          </Alert>
        ) : (
          <ul className="ann-list" aria-label="Announcements">
            {visible.map((announcement) => (
              <li key={announcement.id}>
                <Card
                  className={
                    announcement.unread
                      ? "ann-card ann-card--unread"
                      : "ann-card ann-card--read"
                  }
                >
                  <div className="ann-body-wrap">
                    <div className="ann-head">
                      <div className="ann-headline">
                        {announcement.unread ? (
                          <span aria-label="Unread" className="ann-dot" />
                        ) : null}
                        <h2 className="ann-title">{announcement.title}</h2>
                      </div>
                      <Badge
                        tone={
                          announcement.scope === "school" ? "accent" : "neutral"
                        }
                      >
                        {announcement.scope === "school" ? "School" : "Course"}
                      </Badge>
                    </div>
                    <p className="ann-body">{announcement.body}</p>
                    <p className="ann-meta">
                      {announcement.source}
                      <span aria-hidden="true" className="ann-meta__sep">
                        ·
                      </span>
                      {announcement.author}
                      <span aria-hidden="true" className="ann-meta__sep">
                        ·
                      </span>
                      {relativeTime(announcement.postedAt)}
                    </p>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Stack>
    </AppShell>
  );
}
