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
      onClick={signOut}
      disabled={busy}
      style={{
        padding: ".5rem .9rem",
        border: "1px solid #d0d3d9",
        borderRadius: 8,
        background: "#fff",
        cursor: "pointer",
        fontWeight: 600,
      }}
    >
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
