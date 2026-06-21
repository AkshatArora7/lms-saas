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
 * showcase panel (brand identity + value highlights + trust strip) beside an
 * elevated, centered form card. Every colour, radius and space resolves from
 * tenant theme tokens (var(--lms-*)) so the same markup renders correctly for
 * any brand. The layout collapses to a single centered column on phones (no
 * horizontal overflow at 360px): the showcase drops away, leaving a compact
 * brand header above the form. Text on the accent gradient uses
 * --lms-accent-contrast for guaranteed legibility, and the brand name is carried
 * as supporting text so the form's "Welcome back" stays the single page <h1>.
 *
 * Modern UX touches kept fully client-side and honest: a password show/hide
 * toggle and a live Caps-Lock warning — no fake "remember me" / "forgot
 * password" affordances that the backend can't yet honour.
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
  max-width: 448px;
  box-shadow: var(--lms-shadow-lg);
  border-radius: var(--lms-radius-lg);
}
.login-welcome {
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-1);
}
.login-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: var(--lms-space-2);
  margin: 0 0 var(--lms-space-1);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--lms-accent);
}
.login-eyebrow__dot {
  width: 8px;
  height: 8px;
  border-radius: var(--lms-radius-pill);
  background: var(--lms-accent);
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

/* Password field with inline show/hide toggle */
.login-pw {
  position: relative;
  min-width: 0;
}
.login-pw .lms-input {
  padding-right: 48px;
}
.login-pw__toggle {
  position: absolute;
  top: 0;
  right: 0;
  height: 100%;
  width: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  background: transparent;
  color: var(--lms-text-muted);
  cursor: pointer;
  border-radius: var(--lms-radius-sm);
  transition: color 150ms cubic-bezier(0.2,0,0,1);
}
.login-pw__toggle:hover { color: var(--lms-text); }
.login-pw__toggle:focus-visible {
  outline: 3px solid var(--lms-focus);
  outline-offset: -3px;
}
.login-pw__toggle svg { width: 20px; height: 20px; }
.login-caps {
  display: flex;
  align-items: center;
  gap: var(--lms-space-2);
  margin: 0;
  font-size: 13px;
  color: var(--lms-warning-soft-text);
}
.login-caps svg { width: 16px; height: 16px; flex-shrink: 0; }

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
    background:
      radial-gradient(120% 120% at 100% 0%, var(--lms-accent-hover) 0%, transparent 55%),
      radial-gradient(90% 90% at 0% 100%, var(--lms-accent-hover) 0%, transparent 45%),
      linear-gradient(135deg, var(--lms-accent), var(--lms-accent-hover));
    color: var(--lms-accent-contrast);
    position: relative;
    overflow: hidden;
    min-width: 0;
  }
  /* soft glow blob */
  .login-showcase::before {
    content: "";
    position: absolute;
    inset: auto -20% -30% auto;
    width: 60%;
    height: 60%;
    border-radius: var(--lms-radius-pill);
    background: var(--lms-accent-soft);
    opacity: 0.5;
    filter: blur(80px);
    pointer-events: none;
  }
  /* subtle dotted texture */
  .login-showcase::after {
    content: "";
    position: absolute;
    inset: 0;
    background-image: radial-gradient(currentColor 1px, transparent 1.4px);
    background-size: 22px 22px;
    opacity: 0.08;
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
  gap: var(--lms-space-4);
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
  opacity: 0.92;
  overflow-wrap: anywhere;
}
.login-highlights {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-3);
}
.login-highlights li {
  display: flex;
  align-items: center;
  gap: var(--lms-space-3);
  min-width: 0;
  padding: var(--lms-space-3);
  border-radius: var(--lms-radius-md);
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.18);
}
.login-highlight__icon {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--lms-radius-md);
  background: rgba(255, 255, 255, 0.18);
  color: var(--lms-accent-contrast);
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
  display: flex;
  align-items: center;
  gap: var(--lms-space-2);
  margin: 0;
  font-size: 13px;
  opacity: 0.88;
  overflow-wrap: anywhere;
}
.login-showcase__footnote svg { width: 16px; height: 16px; flex-shrink: 0; }

@media (prefers-reduced-motion: reduce) {
  .login-card,
  .login-pw__toggle,
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

function EyeIcon() {
  return (
    <svg fill="none" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M2.5 12S5.7 5.8 12 5.8 21.5 12 21.5 12 18.3 18.2 12 18.2 2.5 12 2.5 12Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg fill="none" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M3 3l18 18"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M10.6 6.1A9.6 9.6 0 0 1 12 6c6.3 0 9.5 6 9.5 6a16 16 0 0 1-3 3.6M6.3 7.5A16 16 0 0 0 2.5 12S5.7 18 12 18a9.4 9.4 0 0 0 3.9-.8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9.9 9.9a3 3 0 0 0 4.2 4.2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg fill="none" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 3 5 6v5c0 4 3 6.5 7 8 4-1.5 7-4 7-8V6l-7-3Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function WarnIcon() {
  return (
    <svg fill="none" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 4 2.7 20h18.6L12 4Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M12 10v4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="12" cy="17" r="0.4" fill="currentColor" stroke="currentColor" />
    </svg>
  );
}

export default function LoginForm({ brand }: { brand: Brand }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [capsLock, setCapsLock] = useState(false);

  function trackCaps(e: React.KeyboardEvent<HTMLInputElement>) {
    setCapsLock(e.getModifierState?.("CapsLock") ?? false);
  }

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
        <BrandMark brand={brand} size={48} />
        <p className="login-brand-compact__name">{brand.name}</p>
        <p className="login-brand-compact__tagline">{brand.tagline}</p>
      </div>

      {/* Showcase panel — tablet/desktop only */}
      <div className="login-showcase">
        <div className="login-showcase__brand">
          <BrandMark brand={brand} size={44} />
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
          <ShieldIcon />
          Secure, accessible, and built for every learner.
        </p>
      </div>

      {/* Form panel */}
      <div className="login-form-panel">
        <Card className="login-card">
          <form action="/api/auth/login" method="post" onSubmit={onSubmit}>
            <Stack gap={5}>
              <div className="login-welcome">
                <p className="login-eyebrow">
                  <span className="login-eyebrow__dot" aria-hidden="true" />
                  Sign in
                </p>
                <h1 className="login-title">Welcome back</h1>
                <p className="login-subtitle">
                  Enter your details to access your dashboard.
                </p>
              </div>

              <Stack gap={3}>
                <Field htmlFor="email" label="Email" required>
                  <Input autoComplete="email" name="email" type="email" />
                </Field>

                {/* Password field — built manually so the show/hide toggle can
                    sit inside the control while the label stays associated with
                    the input (Field clones a single child and would not). */}
                <div className="lms-field">
                  <label className="lms-field__label" htmlFor="password">
                    Password<span aria-hidden="true"> *</span>
                  </label>
                  <div className="login-pw">
                    <input
                      aria-describedby={capsLock ? "password-caps" : undefined}
                      autoComplete="current-password"
                      className="lms-input"
                      id="password"
                      name="password"
                      onBlur={() => setCapsLock(false)}
                      onKeyDown={trackCaps}
                      onKeyUp={trackCaps}
                      required
                      type={showPw ? "text" : "password"}
                    />
                    <button
                      aria-label={showPw ? "Hide password" : "Show password"}
                      aria-pressed={showPw}
                      className="login-pw__toggle"
                      onClick={() => setShowPw((v) => !v)}
                      type="button"
                    >
                      {showPw ? <EyeOffIcon /> : <EyeIcon />}
                    </button>
                  </div>
                  {capsLock ? (
                    <p className="login-caps" id="password-caps" role="status">
                      <WarnIcon />
                      Caps Lock is on.
                    </p>
                  ) : null}
                </div>
              </Stack>

              {error ? <Alert tone="danger">{error}</Alert> : null}

              <Button disabled={busy} fullWidth size="lg" type="submit">
                {busy ? "Signing in…" : "Sign in"}
              </Button>

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
