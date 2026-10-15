import { BaseAnthropic } from "@anthropic-ai/sdk/client";
import { Messages } from "@anthropic-ai/sdk/resources/messages/messages";
import { requestUrl } from "obsidian";
import { apiFailure, apiRequest, readAnswer } from "./core/api-engine";
import type { Depth, DescribeJob, RunOutcome } from "./core/claude-engine";
import type { DescribeEngine } from "./core/describe-run";

/**
 * Describe on the user's own Anthropic API key. The thin half: the request and
 * how its answer is read are in core/api-engine.ts. One Messages API call per
 * batch, through the official SDK.
 */

/**
 * The SDK's fetch, carried by Obsidian's requestUrl. It goes out from the app
 * itself, so no browser CORS rule applies, which is what Obsidian asks plugins
 * to use for the network. requestUrl cannot be cancelled, so an abort settles
 * the call at once and the late answer is dropped.
 */
async function obsidianFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const headers: Record<string, string> = {};
  new Headers(init?.headers).forEach((value, key) => {
    // requestUrl measures the body itself.
    if (key !== "content-length") headers[key] = value;
  });
  const signal = init?.signal ?? undefined;
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const call = requestUrl({
    url,
    method: init?.method ?? "GET",
    headers,
    body: typeof init?.body === "string" ? init.body : undefined,
    throw: false,
  }).then((answer) => new Response(answer.text, { status: answer.status, headers: answer.headers }));

  if (!signal) return call;
  return new Promise<Response>((resolve, reject) => {
    const abort = (): void => reject(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    call.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

/**
 * The SDK's client with the Messages API alone. The full client carries every
 * Anthropic API, which bundled into the plugin more than doubled its size.
 */
class MessagesClient extends BaseAnthropic {
  messages = new Messages(this);
}

export class ApiKeyEngine implements DescribeEngine {
  private calls = new Set<AbortController>();

  /** `key` reads the key from Obsidian's keychain at each batch, so a new key needs no reload. */
  constructor(private key: () => string | null) {}

  async run(jobs: DescribeJob[], vocabulary: string[], timeoutMs: number, depth: Depth): Promise<RunOutcome> {
    const apiKey = this.key();
    if (!apiKey) return { ok: false, failure: "key-rejected", message: "No API key is saved" };

    const client = new MessagesClient({
      apiKey,
      fetch: obsidianFetch,
      // The key is the user's own, typed into their own app: there is no page
      // visitor it could leak to, which is what the SDK's browser guard is for.
      dangerouslyAllowBrowser: true,
    });
    const controller = new AbortController();
    this.calls.add(controller);
    try {
      const message = await client.messages.create(apiRequest(jobs, vocabulary, depth), {
        signal: controller.signal,
        timeout: timeoutMs,
      });
      return readAnswer(message);
    } catch (error) {
      return apiFailure(error);
    } finally {
      this.calls.delete(controller);
    }
  }

  cancelAll(): void {
    for (const controller of this.calls) controller.abort();
    this.calls.clear();
  }
}
