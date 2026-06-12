export default function AdminHome() {
  return (
    <main style={{ fontFamily: "system-ui", padding: "3rem", maxWidth: 720 }}>
      <h1>LMS Administration</h1>
      <p>
        Org-unit hierarchy, users &amp; roles, enrollment, SIS sync, and tenant
        settings. Deployed on Vercel; super-admin tooling for pool/silo tenant
        management lives behind the tenant service.
      </p>
    </main>
  );
}
