import { redirect } from "next/navigation";
import { Alert, Button, PageHeader, Stack } from "@lms/ui";

import { getBranding } from "../../lib/branding";
import { getSession, isAdmin } from "../../lib/auth";
import { AppShell } from "../../lib/ui";
import SignOutButton from "../../sign-out-button";
import ImportForm from "./import-form";

const pageCss = `
.si-back { align-self: flex-start; }
.si-shell { max-width: 760px; }
`;

/**
 * Admin "Import SCORM package" screen (#31). RSC gate mirrors courses/new:
 * resolve the session, redirect to /login when absent, and render the
 * role-denied state for non-admins (import is org_admin+). Once gated, the
 * interactive ImportForm client component drives the signed .zip upload +
 * manifest parse against the BFF route POST /api/scorm/packages.
 *
 * Arriving from a course content section may pass ?topicId= to attach the
 * package to a topic; otherwise it is created unattached.
 */
export default async function ScormImportPage({
  searchParams,
}: {
  searchParams: { topicId?: string | string[] };
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const brand = getBranding(session.tenantId);

  if (!isAdmin(session)) {
    return (
      <AppShell actions={<SignOutButton />} brand={brand}>
        <PageHeader
          subtitle="Your account cannot access the administration console."
          title="Not authorized"
        />
        <Alert tone="warning">
          You are signed in as <strong>{session.userId}</strong>, but your
          account does not hold an administrator role, so importing SCORM
          packages is unavailable.
        </Alert>
      </AppShell>
    );
  }

  const topicId = Array.isArray(searchParams.topicId)
    ? searchParams.topicId[0]
    : searchParams.topicId;

  return (
    <AppShell actions={<SignOutButton />} brand={brand}>
      <style>{pageCss}</style>
      <Stack className="si-shell" gap={4}>
        <Button className="si-back" href="/courses" size="sm" variant="ghost">
          ← Back to courses
        </Button>

        <PageHeader
          subtitle="Upload a SCORM 1.2 or 2004 archive and we'll read its manifest to create a launchable package. Serving the package's runtime files is coming soon — for now this records the manifest and the uploaded archive."
          title="Import SCORM package"
        />

        <ImportForm topicId={topicId} />
      </Stack>
    </AppShell>
  );
}
