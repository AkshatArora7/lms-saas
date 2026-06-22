import { redirect } from "next/navigation";
import { Alert, PageHeader } from "@lms/ui";

import { getBranding } from "../../../../lib/branding";
import { getSession, isAdmin } from "../../../../lib/auth";
import { AppShell } from "../../../../lib/ui";
import SignOutButton from "../../../../sign-out-button";
import PageEditor from "../../../../pages/page-editor";

export default async function NewCoursePage({
  params,
}: {
  params: { id: string };
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const brand = getBranding(session.tenantId);

  if (!isAdmin(session)) {
    return (
      <AppShell brand={brand} actions={<SignOutButton />}>
        <PageHeader
          title="Not authorized"
          subtitle="Your account cannot author content pages."
        />
        <Alert tone="warning">
          You are signed in as <strong>{session.userId}</strong>, but your
          account does not hold a teaching or administrator role, so page
          authoring is unavailable.
        </Alert>
      </AppShell>
    );
  }

  return (
    <AppShell brand={brand} actions={<SignOutButton />}>
      <PageHeader
        title="New page"
        subtitle="Write rich content, embed media, then save a draft and publish when ready."
      />
      <PageEditor courseId={params.id} />
    </AppShell>
  );
}
