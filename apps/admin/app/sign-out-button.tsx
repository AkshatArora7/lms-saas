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
      aria-label="Sign out"
      className="lms-btn lms-btn--secondary lms-btn--sm"
      onClick={signOut}
      disabled={busy}
    >
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
