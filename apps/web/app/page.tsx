import { redirect } from "next/navigation";
import type { CSSProperties } from "react";
import {
  AppShell,
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  Grid,
  Inline,
  PageHeader,
  ProgressBar,
  Stack,
} from "@lms/ui";

import { getBranding } from "./lib/branding";
import { getSession } from "./lib/auth";
import { getDashboardCourses } from "./lib/dashboard";
import { getAnnouncements, summarizeAnnouncements } from "./lib/announcements";
import { canTeach } from "./lib/teaching";
import SignOutButton from "./sign-out-button";

const headingStyle: CSSProperties = {
  fontSize: "1rem",
  lineHeight: 1.3,
  margin: 0,
  overflowWrap: "anywhere",
};

const bodyTextStyle: CSSProperties = {
  margin: 0,
  overflowWrap: "anywhere",
};

export default async function Home() {
  const session = await getSession();
  if (!session) redirect("/login");
  const brand = getBranding(session.tenantId);
  const courses = getDashboardCourses(session.tenantId);
  const announcements = summarizeAnnouncements(
    getAnnouncements(session.tenantId),
  );

  return (
    <AppShell brand={brand} actions={<SignOutButton />}>
      <PageHeader
        title="Welcome back"
        subtitle="Here's your learning at a glance."
        actions={
          <Inline gap={2}>
            {canTeach(session.roles) ? (
              <Button href="/teach" variant="secondary">
                Teaching
              </Button>
            ) : null}
            <Button href="/schedule" variant="secondary">
              Schedule
            </Button>
            <Button href="/announcements" variant="secondary">
              Announcements{announcements.unread ? ` (${announcements.unread})` : ""}
            </Button>
            <Button href="/assignments" variant="secondary">
              Assignments
            </Button>
            <Button href="/grades" variant="secondary">
              View grades
            </Button>
          </Inline>
        }
      />

      <Grid gap={5} min="280px">
        <section aria-labelledby="courses-heading">
          <Stack gap={3}>
            <h2 id="courses-heading" style={headingStyle}>
              My courses
            </h2>
            {courses.length ? (
              <Grid min="240px">
                {courses.map((course) => (
                  <Card
                    aria-label={`Open ${course.title}`}
                    as="a"
                    href={`/courses/${course.id}`}
                    interactive
                    key={course.id}
                  >
                    <Stack gap={3}>
                      <div>
                        <h3 style={headingStyle}>{course.title}</h3>
                        <Inline gap={2}>
                          <Badge tone="neutral">{course.code}</Badge>
                          <Badge tone="neutral">{course.term}</Badge>
                        </Inline>
                      </div>
                      <ProgressBar
                        label={`${course.title} progress`}
                        value={course.progress}
                      />
                      <Inline gap={2} justify="space-between">
                        <Badge tone="neutral">{course.progress}% complete</Badge>
                        <Chip tone="accent">{course.role}</Chip>
                      </Inline>
                    </Stack>
                  </Card>
                ))}
              </Grid>
            ) : (
              <EmptyState
                description="Once you're enrolled, your courses will appear here."
                icon="📚"
                title="No courses yet"
              />
            )}
          </Stack>
        </section>

        <aside aria-labelledby="account-heading">
          <Card>
            <Stack gap={3}>
              <h2 id="account-heading" style={headingStyle}>
                Your account
              </h2>
              <Stack gap={1}>
                <p style={bodyTextStyle}>
                  <strong>User:</strong> {session.userId}
                </p>
                <p style={bodyTextStyle}>
                  <strong>Tenant:</strong> {session.tenantId} ({session.tier})
                </p>
              </Stack>
              <Stack gap={2}>
                <strong>Roles</strong>
                <Inline gap={2}>
                  {session.roles.length ? (
                    session.roles.map((role) => (
                      <Badge key={role} tone="accent">
                        {role}
                      </Badge>
                    ))
                  ) : (
                    <span style={bodyTextStyle}>none</span>
                  )}
                </Inline>
              </Stack>
              <Stack gap={2}>
                <strong>Scopes</strong>
                <Inline gap={2}>
                  {session.scopes.length ? (
                    session.scopes.map((scope) => (
                      <Badge key={scope} tone="neutral">
                        {scope}
                      </Badge>
                    ))
                  ) : (
                    <span style={bodyTextStyle}>none</span>
                  )}
                </Inline>
              </Stack>
            </Stack>
          </Card>
        </aside>
      </Grid>
    </AppShell>
  );
}
