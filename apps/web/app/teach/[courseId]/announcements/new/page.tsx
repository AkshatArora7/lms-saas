import { notFound, redirect } from "next/navigation";
import {
  Alert,
  AppShell,
  Breadcrumbs,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Stack,
  Textarea,
} from "@lms/ui";

import { getBranding } from "../../../../lib/branding";
import { getSession } from "../../../../lib/auth";
import { canTeach, getTaughtCourse } from "../../../../lib/teaching";
import SignOutButton from "../../../../sign-out-button";
import { createAnnouncementAction } from "../actions";

const formCss = `
.asg-form-card {
  padding: var(--lms-space-5);
}
.asg-form {
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-5);
}
.asg-section {
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-4);
}
.asg-section + .asg-section {
  border-top: 1px solid var(--lms-border);
  padding-top: var(--lms-space-5);
}
.asg-section-head {
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-1);
}
.asg-section-title {
  font-size: 0.95rem;
  font-weight: 600;
  margin: 0;
}
.asg-section-hint {
  color: var(--lms-text-muted);
  font-size: 0.875rem;
  margin: 0;
  overflow-wrap: anywhere;
}
.asg-grid-2 {
  display: grid;
  gap: var(--lms-space-4);
  grid-template-columns: 1fr;
}
@media (min-width: 600px) {
  .asg-grid-2 {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }
}
.asg-actionbar {
  border-top: 1px solid var(--lms-border);
  display: flex;
  flex-wrap: wrap;
  gap: var(--lms-space-2);
  justify-content: flex-end;
  padding-top: var(--lms-space-4);
}
@media (max-width: 599px) {
  .asg-actionbar {
    justify-content: stretch;
  }
  .asg-actionbar .lms-btn {
    flex: 1 1 auto;
    text-align: center;
  }
}
`;

export default async function NewAnnouncement({
  params,
  searchParams,
}: {
  params: { courseId: string };
  searchParams: { error?: string | string[] };
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const brand = getBranding(session.tenantId);

  if (!canTeach(session.roles)) {
    return (
      <AppShell brand={brand} actions={<SignOutButton />}>
        <PageHeader
          title="Not authorized"
          subtitle="Your account cannot manage announcements."
        />
        <Alert tone="warning">
          You are signed in as <strong>{session.userId}</strong>, but your
          account does not hold a teaching role.
        </Alert>
      </AppShell>
    );
  }

  const { courseId } = params;
  const course = await getTaughtCourse(session.userId, courseId, session.tenantId);
  if (!course) notFound();

  const errorMessage = Array.isArray(searchParams.error)
    ? searchParams.error[0]
    : searchParams.error;

  const base = `/teach/${courseId}/announcements`;

  return (
    <AppShell brand={brand} actions={<SignOutButton />}>
      <style>{formCss}</style>
      <Stack gap={4}>
        <Breadcrumbs
          items={[
            { label: "Teaching", href: "/teach" },
            { label: course.title, collapsible: true },
            { label: "Announcements", href: base },
            { label: "New" },
          ]}
        />

        <PageHeader
          title="New announcement"
          subtitle={`Post an announcement to ${course.title}. Leave the publish time blank to post immediately.`}
        />

        {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}

        <Card className="asg-form-card">
          <form action={createAnnouncementAction} className="asg-form">
            <input name="courseId" type="hidden" value={courseId} />
            <input name="orgUnitId" type="hidden" value={course.orgUnitId} />

            <section className="asg-section">
              <div className="asg-section-head">
                <h2 className="asg-section-title">Details</h2>
                <p className="asg-section-hint">
                  Give the announcement a clear title and tell learners what
                  they need to know.
                </p>
              </div>
              <Field htmlFor="title" label="Title" required>
                <Input
                  name="title"
                  placeholder="e.g. Unit 1 quiz is live"
                  required
                />
              </Field>
              <Field htmlFor="body" label="Message" required>
                <Textarea
                  name="body"
                  placeholder="What you want learners to know"
                  required
                  rows={4}
                />
              </Field>
            </section>

            <section className="asg-section">
              <div className="asg-section-head">
                <h2 className="asg-section-title">Scheduling</h2>
                <p className="asg-section-hint">
                  Choose when this announcement goes live and when it should
                  stop showing.
                </p>
              </div>
              <div className="asg-grid-2">
                <Field
                  htmlFor="publishAt"
                  label="Publish at"
                  help="Leave blank to publish now"
                >
                  <Input name="publishAt" type="datetime-local" />
                </Field>
                <Field htmlFor="expiresAt" label="Expires at" help="Optional">
                  <Input name="expiresAt" type="datetime-local" />
                </Field>
              </div>
            </section>

            <div className="asg-actionbar">
              <Button href={base} variant="ghost">
                Cancel
              </Button>
              <Button type="submit">Post announcement</Button>
            </div>
          </form>
        </Card>
      </Stack>
    </AppShell>
  );
}
