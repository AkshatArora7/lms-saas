"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactElement,
} from "react";
import { Alert, Card } from "@lms/ui";
import { getMessages, t, type Locale } from "@lms/i18n";

import {
  MAX_MESSAGE_CHARS,
  type AiErrorCode,
  type ChatMessage,
  type EnrichedCitation,
} from "../../../lib/ai-types";

/**
 * Learner AI tutor chat panel (#313). The single client island for the tutor
 * route: it owns the conversation state, the composer, and all interaction
 * states (empty / thinking / error / history-loaded). Identity is NEVER handled
 * here — the panel POSTs the BFF (/api/ai/courses/{courseId}/chat), which stamps
 * the server-trusted tenant + user.
 *
 * Accessibility: the message list is an aria-live=polite region so each
 * completed assistant answer is announced once (the BFF is non-streaming).
 * Thinking is role=status; failures are role=alert. Enter sends, Shift+Enter
 * inserts a newline; focus returns to the composer after each send. All
 * interactive targets are >=44px with a visible 3px focus ring, and the dot
 * animation + smooth auto-scroll are disabled under prefers-reduced-motion.
 * Every string flows through @lms/i18n — no hard-coded copy.
 */

const CSS = `
.tut { display: flex; flex-direction: column; gap: var(--lms-space-4); min-width: 0; }
.tut__col { width: 100%; max-width: 72ch; margin: 0 auto; display: flex; flex-direction: column; gap: var(--lms-space-4); min-width: 0; }
.tut__list {
  list-style: none; margin: 0; padding: 0;
  display: flex; flex-direction: column; gap: var(--lms-space-4);
  min-width: 0;
}
.tut__row { display: flex; min-width: 0; }
.tut__row--user { justify-content: flex-end; }
.tut__row--assistant { justify-content: flex-start; }
.tut__bubble {
  max-width: 88%;
  border-radius: var(--lms-radius-md);
  padding: var(--lms-space-3) var(--lms-space-4);
  min-width: 0;
  overflow-wrap: anywhere;
  line-height: var(--lms-line, 1.6);
}
.tut__bubble--user {
  background: var(--lms-accent-soft);
  color: var(--lms-text);
}
.tut__bubble--assistant {
  background: var(--lms-surface-2);
  color: var(--lms-text);
  border: 1px solid var(--lms-border);
}
.tut__author {
  display: block;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--lms-text-muted);
  margin-bottom: var(--lms-space-1);
}
.tut__content { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.tut__sources { margin-top: var(--lms-space-3); display: flex; flex-direction: column; gap: var(--lms-space-2); }
.tut__sources-label {
  font-size: 0.75rem; font-weight: 600; letter-spacing: 0.04em;
  text-transform: uppercase; color: var(--lms-text-muted); margin: 0;
}
.tut__chips { display: flex; flex-wrap: wrap; gap: var(--lms-space-2); margin: 0; padding: 0; list-style: none; }
.tut__chip {
  display: inline-flex; align-items: center; gap: var(--lms-space-1);
  min-height: 44px; padding: var(--lms-space-1) var(--lms-space-3);
  border: 1px solid var(--lms-border); border-radius: var(--lms-radius-pill);
  background: var(--lms-surface); color: var(--lms-text);
  text-decoration: none; font-size: 0.85rem; max-width: 100%;
  overflow-wrap: anywhere;
}
.tut__chip:hover { text-decoration: underline; }
.tut__chip:focus-visible { outline: 3px solid var(--lms-focus); outline-offset: 2px; }
.tut__chip-num { font-weight: 700; color: var(--lms-accent); }
@media (min-width: 601px) {
  .tut__bubble { max-width: 75%; }
}
.tut__thinking {
  display: inline-flex; align-items: center; gap: var(--lms-space-2);
  color: var(--lms-text-muted);
}
.tut__dots { display: inline-flex; gap: 3px; }
.tut__dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--lms-text-muted);
  animation: tut-bounce 1.2s infinite ease-in-out both;
}
.tut__dot:nth-child(2) { animation-delay: 0.16s; }
.tut__dot:nth-child(3) { animation-delay: 0.32s; }
@keyframes tut-bounce {
  0%, 80%, 100% { transform: translateY(0); opacity: 0.5; }
  40% { transform: translateY(-4px); opacity: 1; }
}
.tut__composer {
  position: sticky; bottom: 0;
  background: var(--lms-bg);
  padding-top: var(--lms-space-3);
  border-top: 1px solid var(--lms-border);
  display: flex; flex-direction: column; gap: var(--lms-space-2);
  min-width: 0;
}
.tut__composer-row { display: flex; flex-direction: column; gap: var(--lms-space-2); min-width: 0; }
.tut__textarea {
  width: 100%; box-sizing: border-box;
  min-height: 44px; resize: vertical;
  font: inherit; line-height: var(--lms-line, 1.6);
  padding: var(--lms-space-3); border-radius: var(--lms-radius-md);
  border: 1px solid var(--lms-border); background: var(--lms-surface);
  color: var(--lms-text);
}
.tut__textarea:focus-visible { outline: 3px solid var(--lms-focus); outline-offset: 2px; border-color: var(--lms-accent); }
.tut__send { width: 100%; }
.tut__helper { font-size: 0.8rem; color: var(--lms-text-muted); margin: 0; overflow-wrap: anywhere; }
.tut__helper--warn { color: var(--lms-danger); }
.tut__examples { display: flex; flex-wrap: wrap; gap: var(--lms-space-2); margin: 0; padding: 0; list-style: none; }
.tut__example {
  min-height: 44px; padding: var(--lms-space-2) var(--lms-space-3);
  border: 1px solid var(--lms-border); border-radius: var(--lms-radius-pill);
  background: var(--lms-surface); color: var(--lms-text);
  font: inherit; cursor: pointer; text-align: left; max-width: 100%;
  overflow-wrap: anywhere;
}
.tut__example:hover { border-color: var(--lms-accent); }
.tut__example:focus-visible { outline: 3px solid var(--lms-focus); outline-offset: 2px; }
.tut__empty { display: flex; flex-direction: column; gap: var(--lms-space-4); }
.tut__empty-title { margin: 0; font-size: clamp(1.15rem, 2.5vw, 1.4rem); line-height: 1.25; }
.tut__empty-body { margin: 0; color: var(--lms-text-muted); }
.tut__sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
}
@media (min-width: 601px) {
  .tut__composer-row { flex-direction: row; align-items: flex-end; }
  .tut__textarea { flex: 1; }
  .tut__send { width: auto; flex-shrink: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .tut__dot { animation: none; }
}
`;

interface DisplayMessage {
  role: "user" | "assistant";
  content: string;
  citations: EnrichedCitation[];
}

interface ErrorState {
  code: AiErrorCode;
  retryAfter?: number;
  retryable: boolean;
}

interface ApiErrorBody {
  error?: string;
  retryAfter?: number;
}

const EXAMPLE_KEYS = [
  "tutor.example1",
  "tutor.example2",
  "tutor.example3",
] as const;

function toDisplay(messages: ChatMessage[]): DisplayMessage[] {
  return messages.map((message) => ({
    role: message.role === "assistant" ? "assistant" : "user",
    content: message.content,
    citations: message.citations,
  }));
}

function errorStateFrom(status: number, body: ApiErrorBody): ErrorState {
  const code = (body.error ?? "error") as AiErrorCode;
  if (code === "cost_exceeded") return { code, retryable: false };
  if (code === "rate_limited") {
    return { code, retryAfter: body.retryAfter, retryable: false };
  }
  if (code === "invalid_request") return { code, retryable: false };
  if (code === "user_required" || code === "tenant_required") {
    return { code, retryable: false };
  }
  if (status === 401) return { code: "user_required", retryable: false };
  return { code: "error", retryable: true };
}

export interface TutorChatProps {
  courseId: string;
  initialChatId: string | null;
  initialMessages: ChatMessage[];
  locale: Locale;
}

export default function TutorChat({
  courseId,
  initialChatId,
  initialMessages,
  locale,
}: TutorChatProps): ReactElement {
  const m = getMessages(locale);
  const formId = useId();
  const textareaId = `${formId}-input`;
  const helperId = `${formId}-helper`;

  const [messages, setMessages] = useState<DisplayMessage[]>(
    toDisplay(initialMessages),
  );
  const [chatId, setChatId] = useState<string | null>(initialChatId);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorState | null>(null);
  const [lastQuestion, setLastQuestion] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the newest turn after a send / thinking change.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length, busy]);

  async function ask(question: string): Promise<void> {
    setBusy(true);
    setError(null);
    setLastQuestion(question);

    try {
      const res = await fetch(
        `/api/ai/courses/${encodeURIComponent(courseId)}/chat`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            chatId ? { message: question, chatId } : { message: question },
          ),
        },
      );

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
        const next = errorStateFrom(res.status, body);
        // A stale/unowned chat -> drop the chatId and let the next send start fresh.
        if (next.code === "not_found") setChatId(null);
        setError(next);
        return;
      }

      const data = (await res.json()) as {
        chatId: string;
        answer: string;
        citations: EnrichedCitation[];
      };
      setChatId(data.chatId);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.answer, citations: data.citations },
      ]);
      setLastQuestion(null);
    } catch {
      setError({ code: "unavailable", retryable: true });
    } finally {
      setBusy(false);
      // Return focus to the composer after a round-trip.
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }

  function submitQuestion(): void {
    const question = draft.trim();
    if (question.length === 0 || busy) return;
    if (question.length > MAX_MESSAGE_CHARS) return;
    setMessages((prev) => [
      ...prev,
      { role: "user", content: question, citations: [] },
    ]);
    setDraft("");
    void ask(question);
  }

  function onSubmit(event: FormEvent): void {
    event.preventDefault();
    submitQuestion();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitQuestion();
    }
  }

  function onRetry(): void {
    if (lastQuestion) void ask(lastQuestion);
  }

  function fillExample(text: string): void {
    setDraft(text);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  const remaining = MAX_MESSAGE_CHARS - draft.length;
  const nearLimit = draft.length > 3800;
  const isEmpty = messages.length === 0;

  return (
    <div className="tut">
      <style>{CSS}</style>
      <div className="tut__col">
        {isEmpty ? (
          <Card>
            <div className="tut__empty">
              <div>
                <h2 className="tut__empty-title">{t(m, "tutor.emptyTitle")}</h2>
                <p className="tut__empty-body">{t(m, "tutor.emptyBody")}</p>
              </div>
              <section aria-label={t(m, "tutor.examplesLabel")}>
                <ul className="tut__examples">
                  {EXAMPLE_KEYS.map((key) => {
                    const text = t(m, key);
                    return (
                      <li key={key}>
                        <button
                          className="tut__example"
                          onClick={() => fillExample(text)}
                          type="button"
                        >
                          {text}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            </div>
          </Card>
        ) : null}

        <ol
          aria-label={t(m, "tutor.conversationLabel")}
          aria-live="polite"
          className="tut__list"
        >
          {messages.map((message, index) => {
            const isUser = message.role === "user";
            return (
              <li
                className={`tut__row tut__row--${isUser ? "user" : "assistant"}`}
                key={index}
              >
                <div
                  className={`tut__bubble tut__bubble--${
                    isUser ? "user" : "assistant"
                  }`}
                >
                  <span className="tut__author">
                    {isUser ? t(m, "tutor.you") : t(m, "tutor.tutor")}
                  </span>
                  <p className="tut__content">{message.content}</p>
                  {!isUser && message.citations.length > 0 ? (
                    <nav
                      aria-label={t(m, "tutor.sourcesLabel")}
                      className="tut__sources"
                    >
                      <p className="tut__sources-label">
                        {t(m, "tutor.sources")}
                      </p>
                      <ul className="tut__chips">
                        {message.citations.map((citation, cIndex) => {
                          const n = cIndex + 1;
                          const label =
                            citation.title ??
                            t(m, "tutor.sourceFallback", { n });
                          return (
                            <li key={`${citation.sourceId}-${cIndex}`}>
                              <a
                                aria-label={t(m, "tutor.sourceLink", {
                                  n,
                                  title: label,
                                })}
                                className="tut__chip"
                                href={citation.href}
                                title={citation.chunk}
                              >
                                <span aria-hidden="true" className="tut__chip-num">
                                  [{n}]
                                </span>
                                <span>{label}</span>
                              </a>
                            </li>
                          );
                        })}
                      </ul>
                    </nav>
                  ) : null}
                </div>
              </li>
            );
          })}

          {busy ? (
            <li className="tut__row tut__row--assistant">
              <div
                className="tut__bubble tut__bubble--assistant"
                role="status"
              >
                <span className="tut__author">{t(m, "tutor.tutor")}</span>
                <span className="tut__thinking">
                  <span aria-hidden="true" className="tut__dots">
                    <span className="tut__dot" />
                    <span className="tut__dot" />
                    <span className="tut__dot" />
                  </span>
                  <span>{t(m, "tutor.thinking")}</span>
                </span>
                <span className="tut__sr-only">
                  {t(m, "tutor.thinkingAnnounce")}
                </span>
              </div>
            </li>
          ) : null}
        </ol>

        {error ? (
          <Alert
            tone={
              error.code === "rate_limited" || error.code === "cost_exceeded"
                ? "warning"
                : "danger"
            }
          >
            <div className="tut__empty">
              <span>{errorMessage(m, error)}</span>
              {error.retryable && lastQuestion ? (
                <span>
                  <button
                    className="lms-btn lms-btn--secondary lms-btn--sm"
                    onClick={onRetry}
                    type="button"
                  >
                    {t(m, "tutor.retry")}
                  </button>
                </span>
              ) : null}
            </div>
          </Alert>
        ) : null}

        <div ref={endRef} />

        <form
          aria-label={t(m, "tutor.formLabel")}
          className="tut__composer"
          id={formId}
          onSubmit={onSubmit}
        >
          <label className="tut__sr-only" htmlFor={textareaId}>
            {t(m, "tutor.questionLabel")}
          </label>
          <div className="tut__composer-row">
            <textarea
              aria-describedby={helperId}
              className="tut__textarea"
              disabled={busy}
              id={textareaId}
              maxLength={MAX_MESSAGE_CHARS}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder={t(m, "tutor.placeholder")}
              ref={textareaRef}
              rows={2}
              value={draft}
            />
            <span className="tut__send">
              <button
                aria-busy={busy}
                className="lms-btn lms-btn--primary lms-btn--full"
                disabled={busy || draft.trim().length === 0}
                type="submit"
              >
                {busy ? t(m, "tutor.sending") : t(m, "tutor.send")}
              </button>
            </span>
          </div>
          <p
            className={`tut__helper${nearLimit ? " tut__helper--warn" : ""}`}
            id={helperId}
          >
            {nearLimit
              ? t(m, "tutor.charsRemaining", { remaining })
              : t(m, "tutor.helper", { max: MAX_MESSAGE_CHARS })}
          </p>
        </form>
      </div>
    </div>
  );
}

function errorMessage(
  m: ReturnType<typeof getMessages>,
  error: ErrorState,
): string {
  switch (error.code) {
    case "rate_limited":
      return error.retryAfter !== undefined
        ? t(m, "tutor.errorRateLimitedAfter", { seconds: error.retryAfter })
        : t(m, "tutor.errorRateLimited");
    case "cost_exceeded":
      return t(m, "tutor.errorCostExceeded");
    case "invalid_request":
      return t(m, "tutor.errorTooLong");
    case "user_required":
    case "tenant_required":
      return t(m, "tutor.errorSignIn");
    case "unavailable":
      return t(m, "tutor.errorUnavailable");
    default:
      return t(m, "tutor.errorGeneric");
  }
}
