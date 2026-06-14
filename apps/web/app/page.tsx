import { redirect } from "next/navigation";

import { dashboardCss } from "./dashboard-styles";
import { getBranding } from "./lib/branding";
import { getSession } from "./lib/auth";
import { getDashboardCourses } from "./lib/dashboard";
import SignOutButton from "./sign-out-button";

export default async function Home() {
  const session = await getSession();
  if (!session) redirect("/login");
  const brand = getBranding(session.tenantId);
  const courses = getDashboardCourses(session.tenantId);

  return (
    <>
      <style>{dashboardCss(brand)}</style>
      <div className="lms-dash">
        <header className="lms-dash-topbar">
          <p className="lms-dash-brand">{brand.name}</p>
          <div className="lms-dash-userwrap">
            <span className="lms-dash-user" title={session.userId}>
              {session.userId}
            </span>
            <SignOutButton />
          </div>
        </header>

        <div className="lms-dash-greeting">
          <h1>Welcome back</h1>
          <p>Here&apos;s your learning at a glance.</p>
        </div>

        <div className="lms-dash-body">
          <main className="lms-dash-main">
            <h2 className="lms-dash-section-title">My courses</h2>
            {courses.length ? (
              <div className="lms-dash-courses">
                {courses.map((c) => (
                  <a
                    key={c.id}
                    href="#"
                    className="lms-dash-card"
                    aria-label={`Open ${c.title}`}
                  >
                    <p className="lms-dash-card-title">{c.title}</p>
                    <p className="lms-dash-card-meta">
                      {c.code} · {c.term}
                    </p>
                    <div
                      className="lms-dash-progress"
                      role="progressbar"
                      aria-valuenow={c.progress}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`${c.title} progress`}
                    >
                      <span style={{ width: `${c.progress}%` }} />
                    </div>
                    <div className="lms-dash-card-foot">
                      <span>{c.progress}% complete</span>
                      <span className="lms-dash-chip">{c.role}</span>
                    </div>
                  </a>
                ))}
              </div>
            ) : (
              <div className="lms-dash-empty" role="status">
                <div aria-hidden="true" style={{ fontSize: 28 }}>
                  📚
                </div>
                <h3>No courses yet</h3>
                <p>Once you&apos;re enrolled, your courses will appear here.</p>
              </div>
            )}
          </main>

          <aside className="lms-dash-aside" aria-label="Account details">
            <h2>Your account</h2>
            <p className="lms-dash-kv">
              <strong>User:</strong> {session.userId}
            </p>
            <p className="lms-dash-kv">
              <strong>Tenant:</strong> {session.tenantId} ({session.tier})
            </p>
            <p className="lms-dash-kv">
              <strong>Roles</strong>
            </p>
            <div className="lms-dash-chips">
              {session.roles.length ? (
                session.roles.map((r) => (
                  <span key={r} className="lms-dash-chip">
                    {r}
                  </span>
                ))
              ) : (
                <span className="lms-dash-muted">none</span>
              )}
            </div>
            <p className="lms-dash-kv">
              <strong>Scopes</strong>
            </p>
            <div className="lms-dash-chips">
              {session.scopes.length ? (
                session.scopes.map((s) => (
                  <span key={s} className="lms-dash-chip">
                    {s}
                  </span>
                ))
              ) : (
                <span className="lms-dash-muted">none</span>
              )}
            </div>
          </aside>
        </div>
      </div>
    </>
  );
}
