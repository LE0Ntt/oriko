import { APIError, AuthenticationError, PermissionDeniedError, RateLimitError } from "@anthropic-ai/sdk/core/error";
import type { MessageCreateParamsNonStreaming, Message } from "@anthropic-ai/sdk/resources/messages";
import { BATCH_SCHEMA, SYSTEM_PROMPT, batchContent, resultsFrom } from "./claude-engine";
import type { DescribeJob, Depth, RunOutcome } from "./claude-engine";

/**
 * Describe on the user's own Anthropic API key: the request a batch is sent
 * as and how the answer, or the refusal, is read back. The same prompt,
 * content and schema as the Claude Code engine, so either writes the same
 * labels. Pure; the call itself is src/api-engine.ts.
 */

export const API_MODEL = "claude-haiku-5-5";

/**
 * Room for ten clippings' answers. A busy screenshot's text runs long, and an
 * answer cut short is a batch lost, while only the tokens used are billed.
 */
const MAX_TOKENS = 8192;

export function apiRequest(jobs: DescribeJob[], vocabulary: string[], depth: Depth): MessageCreateParamsNonStreaming {
  return {
    model: API_MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    // Labelling is reading, not reasoning: Haiku takes thinking off at low effort.
    thinking: { type: "disabled" },
    output_config: { effort: "low", format: { type: "json_schema", schema: BATCH_SCHEMA } },
    messages: [{ role: "user", content: batchContent(jobs, vocabulary, depth) }],
  };
}

export function readAnswer(message: Pick<Message, "content" | "stop_reason">): RunOutcome {
  if (message.stop_reason !== "end_turn") {
    return { ok: false, failure: "error", message: `Claude stopped early (${message.stop_reason ?? "no reason"})` };
  }
  const text = message.content.map((block) => (block.type === "text" ? block.text : "")).join("");
  let answer: unknown;
  try {
    answer = JSON.parse(text);
  } catch {
    return { ok: false, failure: "error", message: "Claude gave no structured answer" };
  }
  if (!answer || typeof answer !== "object") {
    return { ok: false, failure: "error", message: "Claude gave no structured answer" };
  }
  return { ok: true, results: resultsFrom(answer) };
}

/** What a failed call means for the run: a key or an account that will fail every batch halts it. */
export function apiFailure(error: unknown): RunOutcome & { ok: false } {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof AuthenticationError || error instanceof PermissionDeniedError) {
    return { ok: false, failure: "key-rejected", message };
  }
  if (error instanceof RateLimitError) return { ok: false, failure: "rate-limit", message };
  if (error instanceof APIError) {
    // An empty account answers 400 with this wording, before the request is
    // even read; 402 is the billing error proper.
    if (error.status === 402 || (error.status === 400 && /credit balance/i.test(message))) {
      return { ok: false, failure: "no-credit", message };
    }
    if (error.status === 529) return { ok: false, failure: "rate-limit", message };
  }
  return { ok: false, failure: "error", message };
}
