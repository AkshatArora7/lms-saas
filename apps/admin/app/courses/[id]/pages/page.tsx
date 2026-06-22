import { redirect } from "next/navigation";
import {
  Alert,
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  PageHeader,
  Stack,
} from "@lms/ui";

import { getBranding } from "../../../lib/branding";
import { getSession, isAdmin } from "../../../lib/auth";
import { getCourse } from "../../../lib/courses-api";
import { listPages } from "../../../lib/pages-api";
import { AppShell, ContentIcon } from "../../../lib/ui";
import SignOutButton from "../../../sign-out-button";

const pagesCss = `
.pg-back { align-self: flex-start; }
.pg-name {
  color: var(--lms-accent);
  font-weight: 600;
  margin: 0;
  overflow-wrap: anywhere;
}
.pg-meta {
  color: var(--lms-text-muted);
  font-size: var(--lms-font-size-sm);
  margin: var(--lms-space-1) 0 0;
  overflow-wrap: anywhere;
}
.pg-pages-table td:first-child,
.pg-pages-table th:first-child { min-width: 200px; }
.pg-row-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--lms-space-2);
}
`;

/** Human relative time without pulling in a date library. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diffMs = Date.now() - then;
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(then).toLocaleDateString();
}

export default async function CoursePages({
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

  const courseResult = await getCourse(params.id, session.tenantId);
  const courseTitle = courseResult.ok ? courseResult.course.title : "this course";
  const result = await listPages(params.id, session.tenantId);
  const pages = result.ok ? result.pages : [];

  return (
    <AppShell brand={brand} actions={<SignOutButton />}>
      <style>{pagesCss}</style>
      <Stack gap={4}>
        <Button className="pg-back" href="/courses" size="sm" variant="ghost">
          {"<- Back to catalogue"}
        </Button>

        <PageHeader
          title="Pages"
          subtitle={`Author rich content pages for ${courseTitle}. Drafts stay private until you publish.`}
          actions={
            <Button href={`/courses/${params.id}/pages/new`} size="sm">
              New page
            </Button>
          }
        />

        {!result.ok ? (
          <Card>
            <Stack gap={2}>
              <Badge tone="warning">Service offline</Badge>
              <p className="pg-meta">{result.error}</p>
            </Stack>
          </Card>
        ) : pages.length ? (
          <section aria-labelledby="pages-heading">
            <Stack gap={3}>
              <h2 className="pg-meta" id="pages-heading" style={{ fontSize: 16 }}>
                {pages.length} page{pages.length === 1 ? "" : "s"}
              </h2>
              <div
                aria-label="Course pages"
                className="lms-table-wrap"
                role="region"
                tabIndex={0}
              >
                <table className="lms-table pg-pages-table">
                  <thead>
                    <tr>
                      <th scope="col">Page</th>
                      <th scope="col">Status</th>
                      <th scope="col">Updated</th>
                      <th scope="col">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pages.map((page) => (
                      <tr key={page.id}>
                        <td>
                          <a className="pg-name" href={`/pages/${page.id}/edit`}>
                            {page.title}
                          </a>
                          <p className="pg-meta">/{page.slug}</p>
                        </td>
                        <td>
                          <Chip
                            tone={page.status === "published" ? "success" : "warning"}
                          >
                            {page.status === "published" ? "Published" : "Draft"}
                          </Chip>
                        </td>
                        <td>
                          <span className="pg-meta">
                            {relativeTime(page.updatedAt)}
                          </span>
                        </td>
                        <td>
                          <div className="pg-row-actions">
                            <Button
                              href={`/pages/${page.id}/edit`}
                              size="sm"
                              variant="secondary"
                            >
                              Edit
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Stack>
          </section>
        ) : (
          <EmptyState
            actions={
              <Button href={`/courses/${params.id}/pages/new`} size="sm">
                New page
              </Button>
            }
            description="Create your first page to share rich materials with learners in this course."
            icon={<ContentIcon />}
            title="No pages yet"
          />
        )}
      </Stack>
    </AppShell>
  );
}
