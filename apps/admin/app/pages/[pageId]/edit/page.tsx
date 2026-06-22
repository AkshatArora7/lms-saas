import { redirect } from "next/navigation";
import { Alert, Button, PageHeader, Stack } from "@lms/ui";

import { getBranding } from "../../../lib/branding";
import { getSession, isAdmin } from "../../../lib/auth";
import { getPage } from "../../../lib/pages-api";
import { AppShell } from "../../../lib/ui";
import SignOutButton from "../../../sign-out-button";
import PageEditor from "../../page-editor";

export default async function EditPage({
  params,
}: {
  params: { pageId: string };
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

  const result = await getPage(params.pageId, session.tenantId);

  if (!result.ok) {
    return (
      <AppShell brand={brand} actions={<SignOutButton />}>
        <Stack gap={4}>
          <PageHeader
            title="Page unavailable"
            subtitle={
              result.status === 404
                ? "This page no longer exists or was moved."
                : undefined
            }
          />
          <Alert tone="warning">{result.error}</Alert>
          <Button href="/courses" size="sm" variant="ghost">
            {"<- Back to catalogue"}
          </Button>
        </Stack>
      </AppShell>
    );
  }

  return (
    <AppShell brand={brand} actions={<SignOutButton />}>
      <PageHeader title="Edit page" subtitle={result.page.title} />
      <PageEditor courseId={result.page.courseId} page={result.page} />
    </AppShell>
  );
}
