import { notFound, redirect } from "next/navigation";
import {
  Alert,
  AppShell,
  Button,
  Card,
  Field,
  Inline,
  Input,
  PageHeader,
  Select,
  Stack,
  Textarea,
} from "@lms/ui";

import { getBranding } from "../../../../../lib/branding";
import { getSession } from "../../../../../lib/auth";
import { canTeach } from "../../../../../lib/teaching";
import { getAssignment } from "../../../../../lib/assignments-api";
import SignOutButton from "../../../../../sign-out-button";
import { deleteAssignmentAction, updateAssignmentAction } from "../../actions";

function toDateInput(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

export default async function EditAssignment({
  params,
  searchParams,
}: {
  params: { courseId: string; assignmentId: string };
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
          subtitle="Your account cannot manage assignments."
        />
        <Alert tone="warning">
          You are signed in as <strong>{session.userId}</strong>, but your
          account does not hold a teaching role.
        </Alert>
      </AppShell>
    );
  }

  const { courseId, assignmentId } = params;
  const base = `/teach/${courseId}/assignments`;

  const result = await getAssignment(assignmentId, session.tenantId);
  if (!result.ok) notFound();
  const assignment = result.assignment;

  const errorMessage = Array.isArray(searchParams.error)
    ? searchParams.error[0]
    : searchParams.error;

  return (
    <AppShell brand={brand} actions={<SignOutButton />}>
      <Stack gap={4}>
        <Button href={base} size="sm" variant="ghost">
          {"<- Back to assignments"}
        </Button>

        <PageHeader
          title="Edit assignment"
          subtitle={assignment.title}
        />

        {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}

        <Card>
          <form action={updateAssignmentAction}>
            <input name="courseId" type="hidden" value={courseId} />
            <input name="id" type="hidden" value={assignment.id} />
            <Stack gap={4}>
              <Field htmlFor="title" label="Title" required>
                <Input name="title" defaultValue={assignment.title} required />
              </Field>
              <Field htmlFor="instructions" label="Instructions">
                <Textarea
                  name="instructions"
                  defaultValue={assignment.instructions ?? ""}
                  rows={3}
                />
              </Field>
              <Inline gap={3}>
                <Field htmlFor="dueAt" label="Due date">
                  <Input
                    name="dueAt"
                    type="date"
                    defaultValue={toDateInput(assignment.dueAt)}
                  />
                </Field>
                <Field htmlFor="points" label="Points">
                  <Input
                    name="points"
                    type="number"
                    defaultValue={String(assignment.points)}
                  />
                </Field>
              </Inline>
              <Field htmlFor="submissionType" label="Submission type">
                <Select
                  name="submissionType"
                  defaultValue={assignment.submissionType}
                >
                  <option value="file">File upload</option>
                  <option value="text">Text entry</option>
                  <option value="url">URL</option>
                  <option value="none">No submission</option>
                </Select>
              </Field>
              <label>
                <Inline gap={2}>
                  <input
                    defaultChecked={assignment.allowLate}
                    name="allowLate"
                    type="checkbox"
                  />
                  <span>Allow late submissions</span>
                </Inline>
              </label>
              <Inline gap={2}>
                <Button type="submit">Save changes</Button>
                <Button href={base} variant="ghost">
                  Cancel
                </Button>
              </Inline>
            </Stack>
          </form>
        </Card>

        <Card>
          <Stack gap={3}>
            <p style={{ margin: 0 }}>
              Deleting an assignment also removes its submissions. This cannot be
              undone.
            </p>
            <form action={deleteAssignmentAction}>
              <input name="courseId" type="hidden" value={courseId} />
              <input name="id" type="hidden" value={assignment.id} />
              <Button type="submit" variant="danger">
                Delete assignment
              </Button>
            </form>
          </Stack>
        </Card>
      </Stack>
    </AppShell>
  );
}
