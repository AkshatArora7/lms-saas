import { redirect } from "next/navigation";

import { getBranding } from "./lib/branding";
import { getSession, isAdmin } from "./lib/auth";
import SignOutButton from "./sign-out-button";

const page: React.CSSProperties = {
  fontFamily: "system-ui",
  padding: "3rem",
  maxWidth: 760,
  margin: "0 auto",
  color: "#1b2030",
};
const chip: React.CSSProperties = {
  display: "inline-block",
  padding: ".2rem .6rem",
  margin: "0 .35rem .35rem 0",
  borderRadius: 999,
  background: "#eef1f8",
  color: "#2952cc",
  fontSize: 12,
  fontWeight: 600,
};

export default async function AdminHome() {
  const session = await getSession();
  if (!session) redirect("/login");
  const brand = getBranding(session.tenantId);

  const brandLabel = (
    <p
      style={{
        margin: 0,
        fontSize: 13,
        fontWeight: 700,
        color: brand.accent,
        textTransform: "uppercase",
        letterSpacing: ".04em",
      }}
    >
      {brand.name}
    </p>
  );

  if (!isAdmin(session)) {
    return (
      <main style={page}>
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            {brandLabel}
            <h1 style={{ margin: ".15rem 0 0" }}>Not authorized</h1>
          </div>
          <SignOutButton />
        </header>
        <p style={{ color: "#5b606b" }}>
          You are signed in as <strong>{session.userId}</strong>, but your
          account does not hold an administrator role, so the admin console is
          unavailable. Roles on this account:{" "}
          {session.roles.length ? session.roles.join(", ") : "none"}.
        </p>
      </main>
    );
  }

  return (
    <main style={page}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div>
          {brandLabel}
          <h1 style={{ margin: ".15rem 0 0" }}>Administration</h1>
        </div>
        <SignOutButton />
      </header>

      <p style={{ color: "#5b606b" }}>
        Org-unit hierarchy, users &amp; roles, enrollment, SIS sync, and tenant
        settings. Super-admin tooling for pool/silo tenant management lives
        behind the tenant service.
      </p>

      <section
        style={{
          marginTop: "1.5rem",
          padding: "1.25rem 1.5rem",
          border: "1px solid #e6e8ec",
          borderRadius: 12,
        }}
      >
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Administrator session</h2>
        <p style={{ margin: ".25rem 0" }}>
          <strong>User:</strong> {session.userId}
        </p>
        <p style={{ margin: ".25rem 0" }}>
          <strong>Tenant:</strong> {session.tenantId} ({session.tier})
        </p>
        <p style={{ margin: ".75rem 0 .35rem" }}>
          <strong>Roles</strong>
        </p>
        <div>
          {session.roles.map((r) => (
            <span key={r} style={chip}>
              {r}
            </span>
          ))}
        </div>
        <p style={{ margin: ".75rem 0 .35rem" }}>
          <strong>Scopes</strong>
        </p>
        <div>
          {session.scopes.length ? (
            session.scopes.map((s) => (
              <span key={s} style={chip}>
                {s}
              </span>
            ))
          ) : (
            <span style={{ color: "#8a8f99" }}>none</span>
          )}
        </div>
      </section>
    </main>
  );
}
