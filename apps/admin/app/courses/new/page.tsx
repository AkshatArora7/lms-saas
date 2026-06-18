import { redirect } from "next/navigation";
import {
  Alert,
  AppShell,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Stack,
  Textarea,
} from "@lms/ui";

import { getBranding } from "../../lib/branding";
import { getSession, isAdmin } from "../../lib/auth";
import SignOutButton from "../../sign-out-button";
import { createCourseAction } from "../actions";

const formCss = `
.asg-back {
  align-self: flex-start;
}
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

export default async function NewCourse({
  searchParams,
}: {
  searchParams: { error?: string | string[] };
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const brand = getBranding(session.tenantId);

  if (!isAdmin(session)) {
    return (
      <AppShell brand={brand} actions={<SignOutButton />}>
        <PageHeader
          title="Not authorized"
          subtitle="Your account cannot access the administration console."
        />
        <Alert tone="warning">
          You are signed in as <strong>{session.userId}</strong>, but your
          account does not hold an administrator role.
        </Alert>
      </AppShell>
    );
  }

  const errorMessage = Array.isArray(searchParams.error)
    ? searchParams.error[0]
    : searchParams.error;

  return (
    <AppShell brand={brand} actions={<SignOutButton />}>
      <style>{formCss}</style>
      <Stack gap={4}>
        <Button className="asg-back" href="/courses" size="sm" variant="ghost">
          ← Back to catalogue
        </Button>

        <PageHeader
          title="New course"
          subtitle="Add a course to this tenant. It starts as a draft until you publish it."
        />

        {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}

        <Card className="asg-form-card">
          <form action={createCourseAction} className="asg-form">
            <section className="asg-section">
              <div className="asg-section-head">
                <h2 className="asg-section-title">Details</h2>
                <p className="asg-section-hint">
                  Give the course a clear title and describe what it covers.
                </p>
              </div>
              <Field htmlFor="title" label="Title" required>
                <Input name="title" placeholder="e.g. Algebra I" required />
              </Field>
              <Field htmlFor="description" label="Description">
                <Textarea
                  name="description"
                  placeholder="What this course covers"
                  rows={3}
                />
              </Field>
            </section>

            <section className="asg-section">
              <div className="asg-section-head">
                <h2 className="asg-section-title">Schedule</h2>
                <p className="asg-section-hint">
                  Optionally set when the course runs.
                </p>
              </div>
              <div className="asg-grid-2">
                <Field htmlFor="startDate" label="Start date">
                  <Input name="startDate" type="date" />
                </Field>
                <Field htmlFor="endDate" label="End date">
                  <Input name="endDate" type="date" />
                </Field>
              </div>
            </section>

            <div className="asg-actionbar">
              <Button href="/courses" variant="ghost">
                Cancel
              </Button>
              <Button type="submit">Create course</Button>
            </div>
          </form>
        </Card>
      </Stack>
    </AppShell>
  );
}
