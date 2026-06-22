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

/**
 * Flagship white-label sign-in. A full-height split screen: an accent-tinted
 * showcase panel (brand identity + generic value highlights) beside a centered
 * form card. Every colour, radius and space resolves from tenant theme tokens
 * (var(--lms-*)) so the same markup renders correctly for any brand. The layout
 * collapses to a single centered column on phones (no horizontal overflow at
 * 360px): the gradient panel and value list drop away, leaving a compact brand
 * header above the form. Text on the accent gradient uses --lms-accent-contrast
 * for guaranteed legibility, and the brand name is carried as supporting text so
 * the form's "Welcome back" stays the single page <h1>.
 */
const loginCss = `
.login-split {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  min-width: 0;
}
.login-brand-compact {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--lms-space-2);
  text-align: center;
  padding: var(--lms-space-6) clamp(16px, 5vw, 32px) 0;
}
.login-brand-compact__name {
  margin: 0;
  font-size: clamp(1.25rem, 6vw, 1.6rem);
  font-weight: 700;
  line-height: 1.15;
  overflow-wrap: anywhere;
}
.login-brand-compact__tagline {
  margin: 0;
  color: var(--lms-text-muted);
  overflow-wrap: anywhere;
}
.login-showcase {
  display: none;
}
.login-form-panel {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: clamp(16px, 5vw, 40px);
  min-width: 0;
}
.login-card {
  width: 100%;
  max-width: 440px;
}
.login-welcome {
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-1);
}
.login-title {
  margin: 0;
  font-size: clamp(1.5rem, 5vw, 1.9rem);
  font-weight: 700;
  line-height: 1.15;
  overflow-wrap: anywhere;
}
.login-subtitle {
  margin: 0;
  color: var(--lms-text-muted);
  overflow-wrap: anywhere;
}
.login-hint {
  margin: 0;
  color: var(--lms-text-muted);
  font-size: 13px;
  text-align: center;
  overflow-wrap: anywhere;
}
.login-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

@media (min-width: 641px) {
  .login-split {
    flex-direction: row;
  }
  .login-brand-compact {
    display: none;
  }
  .login-showcase {
    flex: 1 1 55%;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: var(--lms-space-6);
    padding: clamp(32px, 5vw, 64px);
    background: linear-gradient(135deg, var(--lms-accent), var(--lms-accent-hover));
    color: var(--lms-accent-contrast);
    position: relative;
    overflow: hidden;
    min-width: 0;
  }
  .login-showcase::before {
    content: "";
    position: absolute;
    inset: auto -20% -30% auto;
    width: 60%;
    height: 60%;
    border-radius: var(--lms-radius-pill);
    background: var(--lms-accent-soft);
    opacity: 0.35;
    filter: blur(80px);
    pointer-events: none;
  }
  .login-showcase > * {
    position: relative;
    z-index: 1;
  }
  .login-form-panel {
    flex: 1 1 45%;
  }
}

.login-showcase__brand {
  display: flex;
  align-items: center;
  gap: var(--lms-space-3);
  min-width: 0;
}
.login-showcase__name {
  margin: 0;
  font-size: clamp(1.25rem, 2.5vw, 1.6rem);
  font-weight: 700;
  line-height: 1.2;
  overflow-wrap: anywhere;
}
.login-showcase__lead {
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-3);
}
.login-showcase__headline {
  margin: 0;
  font-size: clamp(1.8rem, 3.4vw, 2.6rem);
  font-weight: 700;
  line-height: 1.1;
  max-width: 16ch;
  overflow-wrap: anywhere;
}
.login-showcase__tagline {
  margin: 0;
  font-size: clamp(1rem, 1.4vw, 1.15rem);
  line-height: 1.5;
  max-width: 40ch;
  opacity: 0.9;
  overflow-wrap: anywhere;
}
.login-highlights {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-4);
}
.login-highlights li {
  display: flex;
  align-items: center;
  gap: var(--lms-space-3);
  min-width: 0;
}
.login-highlight__icon {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--lms-radius-md);
  background: var(--lms-accent-soft);
  color: var(--lms-accent);
}
.login-highlight__icon svg {
  width: 20px;
  height: 20px;
}
.login-highlight__label {
  font-size: clamp(0.95rem, 1.3vw, 1.05rem);
  line-height: 1.4;
  overflow-wrap: anywhere;
}
.login-showcase__footnote {
  margin: 0;
  font-size: 13px;
  opacity: 0.8;
  overflow-wrap: anywhere;
}

@media (prefers-reduced-motion: reduce) {
  .login-card,
  .login-showcase::before {
    transition: none;
  }
}
`;

const HIGHLIGHTS = [
  {
    label: "All your courses in one place",
    icon: (
      <svg fill="none" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v15.5l-1-.6a4 4 0 0 0-4 0l-1.5.9V5.5Z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <path
          d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v15.5l1-.6a4 4 0 0 1 4 0l1.5.9V5.5Z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    label: "Track progress and grades in real time",
    icon: (
      <svg fill="none" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M4 20h16"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        <path
          d="M7 20v-6M12 20V8M17 20v-9"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    label: "Secure single sign-on",
    icon: (
      <svg fill="none" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M12 3 5 6v5c0 4 3 6.5 7 8 4-1.5 7-4 7-8V6l-7-3Z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <path
          d="m9.2 12 2 2 3.6-3.6"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
];

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
    <main className="login-split">
      <style>{loginCss}</style>

      {/* Compact brand header — phone only */}
      <div className="login-brand-compact">
        <BrandMark brand={brand} decorative size={48} />
        <p className="login-brand-compact__name">{brand.name}</p>
        <p className="login-brand-compact__tagline">{brand.tagline}</p>
      </div>

      {/* Showcase panel — tablet/desktop only */}
      <div className="login-showcase">
        <div className="login-showcase__brand">
          <BrandMark brand={brand} decorative size={44} />
          <p className="login-showcase__name">{brand.name}</p>
        </div>

        <div className="login-showcase__lead">
          <h2 className="login-showcase__headline">{brand.tagline}</h2>
          <p className="login-showcase__tagline">
            A focused, modern learning experience that keeps everything you need
            for class a single sign-in away.
          </p>
          <ul className="login-highlights">
            {HIGHLIGHTS.map((item) => (
              <li key={item.label}>
                <span className="login-highlight__icon">{item.icon}</span>
                <span className="login-highlight__label">{item.label}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="login-showcase__footnote">
          Secure, accessible, and built for every learner.
        </p>
      </div>

      {/* Form panel */}
      <div className="login-form-panel">
        <Card className="login-card">
          <form action="/api/auth/login" method="post" onSubmit={onSubmit}>
            <Stack gap={5}>
              <div className="login-welcome">
                <h1 className="login-title">Welcome back</h1>
                <p className="login-subtitle">
                  Enter your details to access your dashboard.
                </p>
              </div>

              <Stack gap={3}>
                <Field htmlFor="email" label="Email" required>
                  <Input
                    aria-describedby={error ? "login-error" : undefined}
                    aria-invalid={error ? true : undefined}
                    autoComplete="email"
                    name="email"
                    type="email"
                  />
                </Field>

                <Field htmlFor="password" label="Password" required>
                  <Input
                    aria-describedby={error ? "login-error" : undefined}
                    aria-invalid={error ? true : undefined}
                    autoComplete="current-password"
                    name="password"
                    type="password"
                  />
                </Field>
              </Stack>

              {error ? (
                <div id="login-error">
                  <Alert tone="danger">{error}</Alert>
                </div>
              ) : null}

              <Button disabled={busy} fullWidth type="submit">
                {busy ? "Signing in…" : "Sign in"}
              </Button>

              <p aria-live="polite" className="login-sr-only" role="status">
                {busy ? "Signing in…" : ""}
              </p>

              <Divider />

              <Button fullWidth href="/api/auth/sso/start" variant="secondary">
                Sign in with your school account
              </Button>

              <p className="login-hint">
                Demo: admin@demo.school / student@demo.school · password123
              </p>
            </Stack>
          </form>
        </Card>
      </div>
    </main>
  );
}
