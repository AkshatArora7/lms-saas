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

const announcementsCss = `
.ann-list {
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-3);
  list-style: none;
  margin: 0;
  padding: 0;
}
.ann-card--unread {
  border-left: 3px solid var(--lms-accent);
}
.ann-title {
  font-weight: 600;
  margin: 0;
  overflow-wrap: anywhere;
}
.ann-body {
  color: var(--lms-text);
  margin: 0;
  overflow-wrap: anywhere;
}
.ann-meta {
  color: var(--lms-text-muted);
  margin: 0;
  overflow-wrap: anywhere;
}
.ann-dot {
  background: var(--lms-accent);
  border-radius: var(--lms-radius-pill);
  display: inline-block;
  height: 8px;
  width: 8px;
  flex-shrink: 0;
}
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

  const all = getAnnouncements(session.tenantId);
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
          <ul className="ann-list">
            {visible.map((announcement) => (
              <li key={announcement.id}>
                <Card
                  className={
                    announcement.unread ? "ann-card--unread" : undefined
                  }
                >
                  <Stack gap={2}>
                    <Inline gap={2} justify="space-between">
                      <Inline gap={2}>
                        {announcement.unread ? (
                          <span aria-label="Unread" className="ann-dot" />
                        ) : null}
                        <p className="ann-title">{announcement.title}</p>
                      </Inline>
                      <Badge
                        tone={
                          announcement.scope === "school" ? "accent" : "neutral"
                        }
                      >
                        {announcement.scope === "school" ? "School" : "Course"}
                      </Badge>
                    </Inline>
                    <p className="ann-body">{announcement.body}</p>
                    <p className="ann-meta">
                      {announcement.source} · {announcement.author} ·{" "}
                      {relativeTime(announcement.postedAt)}
                    </p>
                  </Stack>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Stack>
    </AppShell>
  );
}
