import { notFound, redirect } from "next/navigation";
import {
  Alert,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Stack,
  Textarea,
} from "@lms/ui";
import { getMessages, t } from "@lms/i18n";

import { getBranding } from "../../../../../lib/branding";
import { getSession } from "../../../../../lib/auth";
import { resolveRequestLocale } from "../../../../../lib/i18n";
import { AppLocaleSwitcher } from "../../../../../lib/locale-switcher";
import { AppShell } from "../../../../../lib/ui";
import { canTeach } from "../../../../../lib/teaching";
import { getAnnouncement } from "../../../../../lib/announcements-api";
import SignOutButton from "../../../../../sign-out-button";
import {
  deleteAnnouncementAction,
  updateAnnouncementAction,
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
  const m = getMessages(await resolveRequestLocale());

  const shellActions = (
    <>
      <AppLocaleSwitcher />
      <SignOutButton />
    </>
  );

  if (!canTeach(session.roles)) {
    return (
      <AppShell actions={shellActions} brand={brand}>
        <PageHeader
          subtitle={t(m, "teach.notAuthorizedSubtitle")}
          title={t(m, "teach.notAuthorizedTitle")}
        />
        <Alert tone="warning">
          <strong>{session.userId}</strong> — {t(m, "teach.notAuthorizedBody")}
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
    <AppShell actions={shellActions} brand={brand}>
      <style>{formCss}</style>
      <Stack gap={4}>
        <Button className="asg-back" href={base} size="sm" variant="ghost">
          {t(m, "teach.announcementForm.backToAnnouncements")}
        </Button>

        <PageHeader
          subtitle={announcement.title}
          title={t(m, "teach.announcementForm.editTitle")}
        />

        {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}

        <Card className="asg-form-card">
          <form action={updateAnnouncementAction} className="asg-form">
            <input name="courseId" type="hidden" value={courseId} />
            <input name="id" type="hidden" value={announcement.id} />

            <section className="asg-section">
              <div className="asg-section-head">
                <h2 className="asg-section-title">
                  {t(m, "teach.announcementForm.detailsSection")}
                </h2>
                <p className="asg-section-hint">
                  {t(m, "teach.announcementForm.detailsHint")}
                </p>
              </div>
              <Field
                htmlFor="title"
                label={t(m, "teach.announcementForm.fieldTitle")}
                required
              >
                <Input name="title" defaultValue={announcement.title} required />
              </Field>
              <Field
                htmlFor="body"
                label={t(m, "teach.announcementForm.fieldBody")}
                required
              >
                <Textarea
                  name="body"
                  defaultValue={announcement.body}
                  required
                  rows={4}
                />
              </Field>
            </section>

            <section className="asg-section">
              <div className="asg-section-head">
                <h2 className="asg-section-title">
                  {t(m, "teach.announcementForm.scheduleSection")}
                </h2>
                <p className="asg-section-hint">
                  {t(m, "teach.announcementForm.scheduleHint")}
                </p>
              </div>
              <div className="asg-grid-2">
                <Field
                  htmlFor="publishAt"
                  label={t(m, "teach.announcementForm.fieldPublishAt")}
                >
                  <Input
                    name="publishAt"
                    type="datetime-local"
                    defaultValue={toDateTimeLocal(announcement.publishAt)}
                  />
                </Field>
                <Field
                  htmlFor="expiresAt"
                  label={t(m, "teach.announcementForm.fieldExpiresAt")}
                  help={t(m, "teach.announcementForm.expiresAtHelp")}
                >
                  <Input
                    name="expiresAt"
                    type="datetime-local"
                    defaultValue={toDateTimeLocal(announcement.expiresAt)}
                  />
                </Field>
              </div>
            </section>

            <div className="asg-actionbar">
              <Button href={base} variant="ghost">
                {t(m, "teach.announcementForm.cancel")}
              </Button>
              <Button type="submit">
                {t(m, "teach.announcementForm.save")}
              </Button>
            </div>
          </form>
        </Card>

        <Card className="asg-danger">
          <div className="asg-danger-row">
            <div className="asg-danger-copy">
              <p className="asg-danger-title">
                {t(m, "teach.announcementForm.dangerTitle")}
              </p>
              <p className="asg-danger-text">
                {t(m, "teach.announcementForm.dangerHint")}
              </p>
            </div>
            <form action={deleteAnnouncementAction}>
              <input name="courseId" type="hidden" value={courseId} />
              <input name="id" type="hidden" value={announcement.id} />
              <Button type="submit" variant="danger">
                {t(m, "teach.announcementForm.delete")}
              </Button>
            </form>
          </div>
        </Card>
      </Stack>
    </AppShell>
  );
}
