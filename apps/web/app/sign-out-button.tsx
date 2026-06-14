"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      className="lms-dash-signout"
      onClick={signOut}
      disabled={busy}
      aria-label="Sign out"
    >
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
