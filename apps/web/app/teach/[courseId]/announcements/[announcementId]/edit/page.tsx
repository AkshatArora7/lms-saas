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
  Stack,
  Textarea,
} from "@lms/ui";

import { getBranding } from "../../../../../lib/branding";
import { getSession } from "../../../../../lib/auth";
import { canTeach } from "../../../../../lib/teaching";
import { getAnnouncement } from "../../../../../lib/announcements-api";
import SignOutButton from "../../../../../sign-out-button";
import {
  deleteAnnouncementAction,
  updateAnnouncementAction,
} from "../../actions";

/** Format an ISO timestamp for an HTML `datetime-local` input (local time). */
function toDateTimeLocal(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default async function EditAnnouncement({
  params,
  searchParams,
}: {
  params: { courseId: string; announcementId: string };
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

  const { courseId, announcementId } = params;
  const base = `/teach/${courseId}/announcements`;

  const result = await getAnnouncement(announcementId, session.tenantId);
  if (!result.ok) notFound();
  const announcement = result.announcement;

  const errorMessage = Array.isArray(searchParams.error)
    ? searchParams.error[0]
    : searchParams.error;

  return (
    <AppShell brand={brand} actions={<SignOutButton />}>
      <Stack gap={4}>
        <Button href={base} size="sm" variant="ghost">
          {"<- Back to announcements"}
        </Button>

        <PageHeader title="Edit announcement" subtitle={announcement.title} />

        {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}

        <Card>
          <form action={updateAnnouncementAction}>
            <input name="courseId" type="hidden" value={courseId} />
            <input name="id" type="hidden" value={announcement.id} />
            <Stack gap={4}>
              <Field htmlFor="title" label="Title" required>
                <Input
                  name="title"
                  defaultValue={announcement.title}
                  required
                />
              </Field>
              <Field htmlFor="body" label="Message" required>
                <Textarea
                  name="body"
                  defaultValue={announcement.body}
                  required
                  rows={4}
                />
              </Field>
              <Inline gap={3}>
                <Field htmlFor="publishAt" label="Publish at">
                  <Input
                    name="publishAt"
                    type="datetime-local"
                    defaultValue={toDateTimeLocal(announcement.publishAt)}
                  />
                </Field>
                <Field htmlFor="expiresAt" label="Expires at" help="Optional">
                  <Input
                    name="expiresAt"
                    type="datetime-local"
                    defaultValue={toDateTimeLocal(announcement.expiresAt)}
                  />
                </Field>
              </Inline>
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
              Deleting an announcement removes it for everyone. This cannot be
              undone.
            </p>
            <form action={deleteAnnouncementAction}>
              <input name="courseId" type="hidden" value={courseId} />
              <input name="id" type="hidden" value={announcement.id} />
              <Button type="submit" variant="danger">
                Delete announcement
              </Button>
            </form>
          </Stack>
        </Card>
      </Stack>
    </AppShell>
  );
}
