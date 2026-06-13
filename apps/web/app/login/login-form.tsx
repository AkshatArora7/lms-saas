"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { Branding } from "../lib/branding";

const wrap: React.CSSProperties = {
  fontFamily: "system-ui",
  display: "grid",
  placeItems: "center",
  minHeight: "100vh",
  background: "#f5f6f8",
};
const card: React.CSSProperties = {
  background: "#fff",
  padding: "2.5rem",
  borderRadius: 12,
  boxShadow: "0 1px 3px rgba(0,0,0,.12)",
  width: 360,
};
const input: React.CSSProperties = {
  width: "100%",
  padding: ".6rem .7rem",
  margin: ".25rem 0 1rem",
  border: "1px solid #d0d3d9",
  borderRadius: 8,
  fontSize: 14,
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
        <p style={{ margin: "0 0 1.5rem", color: "#5b606b", fontSize: 14 }}>
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
          <p style={{ color: "#b60205", fontSize: 13, margin: "0 0 1rem" }}>
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
            color: "#fff",
            fontWeight: 600,
            cursor: "pointer",
          }}
          disabled={busy}
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>

        <p style={{ marginTop: "1.25rem", fontSize: 12, color: "#8a8f99" }}>
          Demo: admin@demo.school / student@demo.school · password123
        </p>
      </form>
    </main>
  );
}
