"use client";

import {
  Alert,
  BrandMark,
  Button,
  Card,
  Divider,
  Field,
  Input,
  Stack,
} from "@lms/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { Brand } from "@lms/ui";

const loginRoot: React.CSSProperties = {
  display: "grid",
  minHeight: "100vh",
  padding: "clamp(16px, 5vw, 32px)",
  placeItems: "center",
};

const loginCard: React.CSSProperties = {
  width: "100%",
  maxWidth: 420,
};

const centered: React.CSSProperties = {
  alignItems: "center",
  display: "flex",
  flexDirection: "column",
  gap: "var(--lms-space-2)",
  textAlign: "center",
};

const title: React.CSSProperties = {
  fontSize: "clamp(22px, 7vw, 30px)",
  lineHeight: 1.15,
  margin: 0,
  overflowWrap: "anywhere",
};

const tagline: React.CSSProperties = {
  color: "var(--lms-text-muted)",
  margin: 0,
  overflowWrap: "anywhere",
};

const hint: React.CSSProperties = {
  color: "var(--lms-text-muted)",
  fontSize: 13,
  margin: 0,
  textAlign: "center",
};

export default function LoginForm({ brand }: { brand: Brand }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget as HTMLFormElement);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
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
    <main style={loginRoot}>
      <Card style={loginCard}>
        <form onSubmit={onSubmit}>
          <Stack gap={5}>
            <div style={centered}>
              <BrandMark brand={brand} size={48} />
              <h1 style={title}>{brand.name}</h1>
              <p style={tagline}>{brand.tagline}</p>
            </div>

            <Stack gap={3}>
              <Field htmlFor="email" label="Email" required>
                <Input
                  defaultValue="admin@demo.school"
                  name="email"
                  type="email"
                />
              </Field>

              <Field htmlFor="password" label="Password" required>
                <Input
                  defaultValue="password123"
                  name="password"
                  type="password"
                />
              </Field>
            </Stack>

            {error ? <Alert tone="danger">{error}</Alert> : null}

            <Button disabled={busy} fullWidth type="submit">
              {busy ? "Signing in…" : "Sign in"}
            </Button>

            <Divider />

            <Button fullWidth href="/api/auth/sso/start" variant="secondary">
              Sign in with your school account
            </Button>

            <p style={hint}>Demo admin: admin@demo.school · password123</p>
          </Stack>
        </form>
      </Card>
    </main>
  );
}
