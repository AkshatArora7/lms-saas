import type { AppConfig } from "@lms/config";

import type { Citation } from "./store.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Abstraction over the LLM completion call. Production wires {@link groqChatModel}
 * (Groq) when `GROQ_API_KEY` is set; otherwise {@link FakeChatModel} keeps the
 * service booting and tests passing with no key/network. Tests inject their own
 * deterministic fake explicitly.
 */
export interface ChatModel {
  complete(messages: ChatMessage[]): Promise<string>;
}

const SYSTEM_PROMPT =
  "You are a study assistant for a course. Answer the student's question using " +
  "ONLY the provided course context. If the answer is not in the context, say " +
  "you don't have enough course material to answer. Be concise and cite the " +
  "relevant material.";

/**
 * Build the grounded chat prompt: a fixed system instruction plus the question
 * and the numbered retrieved context chunks. Pure and reusable across chat
 * models. When `citations` is empty the model is told no context was found.
 */
export function buildGroundedMessages(
  question: string,
  citations: Citation[],
): ChatMessage[] {
  const context =
    citations.length === 0
      ? "(no relevant course content was found)"
      : citations
          .map((c, i) => `[${i + 1}] ${c.chunk}`)
          .join("\n\n");
  return [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `Question: ${question}\n\nCourse context:\n${context}`,
    },
  ];
}

/**
 * Deterministic offline ChatModel. Produces a templated grounded answer from the
 * context embedded in the prompt — no network, no key — so the service runs and
 * tests pass without `GROQ_API_KEY`.
 */
export class FakeChatModel implements ChatModel {
  async complete(messages: ChatMessage[]): Promise<string> {
    const user = [...messages].reverse().find((m) => m.role === "user");
    const content = user?.content ?? "";
    const hasContext =
      content.includes("Course context:") &&
      !content.includes("(no relevant course content was found)");
    if (!hasContext) {
      return "I don't have enough course material to answer that question yet.";
    }
    const firstChunk = content.split("[1] ")[1]?.split("\n")[0]?.trim() ?? "";
    return `Based on the course material: ${firstChunk}`;
  }
}

/**
 * Groq-backed ChatModel. The `groq-sdk` import is lazy so importing this module
 * never pulls the SDK or requires a key at load time — only an actual
 * `complete()` call (with a configured key) touches the network.
 */
export function groqChatModel(config: AppConfig): ChatModel {
  return {
    async complete(messages: ChatMessage[]): Promise<string> {
      const { default: Groq } = await import("groq-sdk");
      const client = new Groq({ apiKey: config.GROQ_API_KEY });
      const completion = await client.chat.completions.create({
        model: config.GROQ_MODEL,
        messages,
      });
      return completion.choices[0]?.message?.content ?? "";
    },
  };
}

/** Default chat model: Groq when a key is configured, else the offline fake. */
export function makeChatModel(config: AppConfig): ChatModel {
  return config.GROQ_API_KEY ? groqChatModel(config) : new FakeChatModel();
}
