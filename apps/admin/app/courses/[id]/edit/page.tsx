import { redirect } from "next/navigation";
import {
  Alert,
  Breadcrumbs,
  Button,
  Card,
  Chip,
  Field,
  Input,
  PageHeader,
  Stack,
  Textarea,
} from "@lms/ui";

import { getBranding } from "../../../lib/branding";
import { getSession, isAdmin } from "../../../lib/auth";
import { getCourse } from "../../../lib/courses-api";
import { AppShell } from "../../../lib/ui";
import SignOutButton from "../../../sign-out-button";
import {
  deleteCourseAction,
  publishCourseAction,
  updateCourseAction,
} from "../../actions";

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
.asg-lifecycle {
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-3);
  padding: var(--lms-space-5);
}
.asg-danger {
  border: 1px solid var(--lms-danger);
}
.asg-danger-row {
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-3);
}
@media (min-width: 600px) {
  .asg-danger-row {
    align-items: center;
    flex-direction: row;
    justify-content: space-between;
  }
}
.asg-danger-copy {
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-1);
}
.asg-danger-title {
  color: var(--lms-danger);
  font-weight: 600;
  margin: 0;
}
.asg-danger-text {
  color: var(--lms-text-muted);
  margin: 0;
  overflow-wrap: anywhere;
}
`;

function toDateInput(value: string | null): string | undefined {
  if (!value) return undefined;
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : undefined;
}

export default async function EditCourse({
  params,
  searchParams,
}: {
  params: { id: string };
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

  const result = await getCourse(params.id, session.tenantId);

  if (!result.ok) {
    return (
      <AppShell brand={brand} actions={<SignOutButton />}>
        <style>{formCss}</style>
        <Stack gap={4}>
          <Button
            className="asg-back"
            href="/courses"
            size="sm"
            variant="ghost"
          >
            ← Back to catalogue
          </Button>
          <PageHeader title="Course unavailable" />
          <Alert tone="warning">{result.error}</Alert>
        </Stack>
      </AppShell>
    );
  }

  const course = result.course;

  return (
    <AppShell brand={brand} actions={<SignOutButton />}>
      <style>{formCss}</style>
      <Stack gap={4}>
        <Breadcrumbs
          items={[
            { label: "Console", href: "/" },
            { label: "Courses", href: "/courses" },
            { label: course.title },
          ]}
        />

        <PageHeader
          title="Edit course"
          subtitle={course.title}
          actions={
            <Chip tone={course.isPublished ? "success" : "warning"}>
              {course.isPublished ? "Published" : "Draft"}
            </Chip>
          }
        />

        {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}

        <Card className="asg-form-card">
          <form action={updateCourseAction} className="asg-form">
            <input name="id" type="hidden" value={course.id} />

            <section className="asg-section">
              <div className="asg-section-head">
                <h2 className="asg-section-title">Details</h2>
                <p className="asg-section-hint">
                  Give the course a clear title and describe what it covers.
                </p>
              </div>
              <Field htmlFor="title" label="Title" required>
                <Input name="title" defaultValue={course.title} required />
              </Field>
              <Field htmlFor="description" label="Description">
                <Textarea
                  name="description"
                  defaultValue={course.description ?? undefined}
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
                  <Input
                    name="startDate"
                    type="date"
                    defaultValue={toDateInput(course.startDate)}
                  />
                </Field>
                <Field htmlFor="endDate" label="End date">
                  <Input
                    name="endDate"
                    type="date"
                    defaultValue={toDateInput(course.endDate)}
                  />
                </Field>
              </div>
            </section>

            <div className="asg-actionbar">
              <Button href="/courses" variant="ghost">
                Cancel
              </Button>
              <Button type="submit">Save changes</Button>
            </div>
          </form>
        </Card>

        <Card className="asg-lifecycle">
          <div className="asg-section-head">
            <h2 className="asg-section-title">Lifecycle</h2>
            <p className="asg-section-hint">
              Publish the course to make it visible to learners.
            </p>
          </div>
          {!course.isPublished ? (
            <form action={publishCourseAction}>
              <input name="id" type="hidden" value={course.id} />
              <Button type="submit">Publish course</Button>
            </form>
          ) : (
            <Alert tone="success">This course is published.</Alert>
          )}
        </Card>

        <Card className="asg-danger">
          <div className="asg-danger-row">
            <div className="asg-danger-copy">
              <p className="asg-danger-title">Danger zone</p>
              <p className="asg-danger-text">
                Deleting a course removes it for this tenant. This cannot be
                undone.
              </p>
            </div>
            <form action={deleteCourseAction}>
              <input name="id" type="hidden" value={course.id} />
              <Button type="submit" variant="danger">
                Delete course
              </Button>
            </form>
          </div>
        </Card>
      </Stack>
    </AppShell>
  );
}
