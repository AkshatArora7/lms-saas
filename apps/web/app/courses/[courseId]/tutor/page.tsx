import { notFound, redirect } from "next/navigation";
import { Button } from "@lms/ui";
import { getMessages, t } from "@lms/i18n";

import { getBranding } from "../../../lib/branding";
import { getSession } from "../../../lib/auth";
import { resolveRequestLocale } from "../../../lib/i18n";
import { AppLocaleSwitcher } from "../../../lib/locale-switcher";
import { getCourseDetail } from "../../../lib/dashboard";
import { loadTutorHistory } from "../../../lib/ai-api";
import { AppShell } from "../../../lib/ui";
import SignOutButton from "../../../sign-out-button";
import TutorChat from "./tutor-chat";

/**
 * Learner AI tutor route (#313). Server Component: it guards the session
 * (redirect to /login when unauthenticated, notFound when the course isn't
 * visible to this learner), loads the most recent tutor conversation
 * server-side, and renders the client chat island inside the shared AppShell.
 *
 * History is loaded here (not via a client fetch) so the conversation is on
 * screen on first paint and the URL stays shareable. All copy resolves through
 * @lms/i18n and every visual decision flows from tenant tokens (var(--lms-*)).
 */

const PAGE_CSS = `
.tut-page { display: flex; flex-direction: column; gap: var(--lms-space-4); min-width: 0; }
.tut-page__header { display: flex; flex-direction: column; gap: var(--lms-space-2); max-width: 72ch; margin: 0 auto; width: 100%; min-width: 0; }
.tut-page__title { margin: 0; font-size: clamp(1.75rem, 4vw, 2.5rem); line-height: 1.1; font-weight: 700; overflow-wrap: anywhere; }
.tut-page__about { margin: 0; color: var(--lms-text-muted); font-size: clamp(1rem, 2vw, 1.15rem); overflow-wrap: anywhere; }
.tut-page__disclosure {
  margin: 0;
  background: var(--lms-info-soft-bg);
  color: var(--lms-info-soft-text);
  border-radius: var(--lms-radius-md);
  padding: var(--lms-space-2) var(--lms-space-3);
  font-size: 0.85rem;
  overflow-wrap: anywhere;
}
.tut-page__back { max-width: 72ch; margin: 0 auto; width: 100%; }
`;

export default async function TutorPage({
  params,
}: {
  params: { courseId: string };
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const brand = getBranding(session.tenantId);
  const locale = await resolveRequestLocale();
  const m = getMessages(locale);

  const course = await getCourseDetail(
    params.courseId,
    session.userId,
    session.tenantId,
  );
  if (!course) notFound();

  const history = await loadTutorHistory(
    params.courseId,
    session.userId,
    session.tenantId,
  );
  const initialChatId = history.ok ? history.chatId : null;
  const initialMessages = history.ok ? history.messages : [];

  return (
    <AppShell
      brand={brand}
      actions={
        <>
          <AppLocaleSwitcher />
          <SignOutButton />
        </>
      }
    >
      <style>{PAGE_CSS}</style>

      <div className="tut-page">
        <div className="tut-page__back">
          <Button href={`/courses/${course.id}`} size="sm" variant="ghost">
            {t(m, "tutor.backToCourse")}
          </Button>
        </div>

        <header className="tut-page__header">
          <h1 className="tut-page__title">{t(m, "tutor.title")}</h1>
          <p className="tut-page__about">
            {t(m, "tutor.about", { courseTitle: course.title })}
          </p>
          <p className="tut-page__disclosure">{t(m, "tutor.disclosure")}</p>
        </header>

        <TutorChat
          courseId={course.id}
          initialChatId={initialChatId}
          initialMessages={initialMessages}
          locale={locale}
        />
      </div>
    </AppShell>
  );
}
