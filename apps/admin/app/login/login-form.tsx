"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { Branding } from "../lib/branding";

const wrap: React.CSSProperties = {
  fontFamily: "system-ui",
  display: "grid",
  placeItems: "center",
  minHeight: "100vh",
  background: "#10131a",
};
const card: React.CSSProperties = {
  background: "#1b2030",
  padding: "2.5rem",
  borderRadius: 12,
  boxShadow: "0 1px 3px rgba(0,0,0,.4)",
  width: 360,
  color: "#e8eaf0",
};
const input: React.CSSProperties = {
  width: "100%",
  padding: ".6rem .7rem",
  margin: ".25rem 0 1rem",
  border: "1px solid #353b4d",
  borderRadius: 8,
  fontSize: 14,
  background: "#10131a",
  color: "#e8eaf0",
  boxSizing: "border-box",
};

export default function LoginForm({ brand }: { brand: Branding }) {
  const router = useRouter();
  const [email, setEmail] = useState("admin@demo.school");
  const [password, setPassword] = useState("password123");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (res.ok) {
      router.push("/");
      router.refresh();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(
        data.error === "invalid_credentials"
          ? "Email or password is incorrect."
          : (data.message ?? "Sign in failed. Please try again."),
      );
      setBusy(false);
    }
  }

  return (
    <main style={wrap}>
      <form style={card} onSubmit={onSubmit}>
        <h1 style={{ margin: "0 0 .25rem", fontSize: 22, color: brand.accent }}>
          {brand.name}
        </h1>
        <p style={{ margin: "0 0 1.5rem", color: "#9aa1b2", fontSize: 14 }}>
          {brand.tagline}
        </p>

        <label htmlFor="email" style={{ fontSize: 13, fontWeight: 600 }}>
          Email
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={input}
          autoComplete="username"
          required
        />

        <label htmlFor="password" style={{ fontSize: 13, fontWeight: 600 }}>
          Password
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={input}
          autoComplete="current-password"
          required
        />

        {error && (
          <p style={{ color: "#ff6b6b", fontSize: 13, margin: "0 0 1rem" }}>
            {error}
          </p>
        )}

        <button
          type="submit"
          style={{
            width: "100%",
            padding: ".7rem",
            border: 0,
            borderRadius: 8,
            background: brand.accent,
            color: "#0b0e14",
            fontWeight: 700,
            cursor: "pointer",
          }}
          disabled={busy}
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: ".75rem",
            margin: "1.25rem 0",
            color: "#6b7280",
            fontSize: 12,
          }}
        >
          <span style={{ flex: 1, height: 1, background: "#353b4d" }} />
          or
          <span style={{ flex: 1, height: 1, background: "#353b4d" }} />
        </div>

        <a
          href="/api/auth/sso/start"
          style={{
            display: "block",
            width: "100%",
            padding: ".7rem",
            border: `1px solid ${brand.accent}`,
            borderRadius: 8,
            background: "transparent",
            color: brand.accent,
            fontWeight: 600,
            textAlign: "center",
            textDecoration: "none",
            boxSizing: "border-box",
          }}
        >
          Sign in with your school account
        </a>

        <p style={{ marginTop: "1.25rem", fontSize: 12, color: "#6b7280" }}>
          Demo admin: admin@demo.school · password123
        </p>
      </form>
    </main>
  );
}
