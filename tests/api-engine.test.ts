import { APIConnectionError, APIError, APIUserAbortError } from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { API_MODEL, apiFailure, apiRequest, readAnswer } from "../src/core/api-engine";
import { BATCH_SCHEMA, SYSTEM_PROMPT, batchContent } from "../src/core/claude-engine";
import type { DescribeJob } from "../src/core/claude-engine";

const job = (over: Partial<DescribeJob> = {}): DescribeJob => ({
  id: 0,
  path: "Clippings/A.md",
  image: "QUJD",
  title: "A",
  description: "",
  domain: "example.com",
  body: "",
  ...over,
});

/** An error as the SDK raises it for a status and body Anthropic sent. */
const answered = (status: number, type: string, message: string): unknown =>
  APIError.generate(status, { type: "error", error: { type, message } }, message, new Headers());

const item = {
  id: 0,
  categories: ["design"],
  proposals: [],
  fallback: "design",
  caption: "A poster.",
  media_text: "",
};

describe("apiRequest", () => {
  it("asks Haiku for the batch's structured answer, with no thinking and low effort", () => {
    const jobs = [job(), job({ id: 1, image: null })];
    const request = apiRequest(jobs, ["design"], "specific");
    expect(request.model).toBe(API_MODEL);
    expect(API_MODEL).toBe("claude-haiku-5-5");
    expect(request.system).toBe(SYSTEM_PROMPT);
    expect(request.thinking).toEqual({ type: "disabled" });
    expect(request.output_config).toEqual({
      effort: "low",
      format: { type: "json_schema", schema: BATCH_SCHEMA },
    });
    expect(request.messages).toEqual([{ role: "user", content: batchContent(jobs, ["design"], "specific") }]);
    expect(request.max_tokens).toBeGreaterThanOrEqual(4096);
  });
});

describe("readAnswer", () => {
  it("reads the batch from the answer's text", () => {
    const run = readAnswer({
      stop_reason: "end_turn",
      content: [{ type: "text", text: JSON.stringify({ items: [item, { ...item, id: 1 }] }), citations: null }],
    });
    expect(run).toMatchObject({ ok: true });
    if (run.ok) expect(run.results.map((r) => r.id)).toEqual([0, 1]);
  });

  it("fails a batch whose answer was cut off or refused", () => {
    const text = JSON.stringify({ items: [item] });
    for (const stop_reason of ["max_tokens", "refusal"] as const) {
      expect(readAnswer({ stop_reason, content: [{ type: "text", text, citations: null }] })).toMatchObject({
        ok: false,
        failure: "error",
      });
    }
  });

  it("fails a batch whose answer is not JSON", () => {
    expect(
      readAnswer({ stop_reason: "end_turn", content: [{ type: "text", text: "Sorry.", citations: null }] })
    ).toMatchObject({ ok: false, failure: "error" });
  });
});

describe("apiFailure", () => {
  it("stops on a refused key", () => {
    expect(apiFailure(answered(401, "authentication_error", "invalid x-api-key"))).toMatchObject({
      ok: false,
      failure: "key-rejected",
    });
    expect(apiFailure(answered(403, "permission_error", "not allowed"))).toMatchObject({ failure: "key-rejected" });
  });

  it("stops on an account with no credit, as Anthropic really answers it", () => {
    const real =
      "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.";
    expect(apiFailure(answered(400, "invalid_request_error", real))).toMatchObject({ failure: "no-credit" });
    expect(apiFailure(answered(402, "billing_error", "Payment required"))).toMatchObject({ failure: "no-credit" });
  });

  it("waits out a rate limit or an overloaded API", () => {
    expect(apiFailure(answered(429, "rate_limit_error", "slow down"))).toMatchObject({ failure: "rate-limit" });
    expect(apiFailure(answered(529, "overloaded_error", "Overloaded"))).toMatchObject({ failure: "rate-limit" });
  });

  it("fails only the batch on anything else", () => {
    expect(apiFailure(answered(400, "invalid_request_error", "bad image"))).toMatchObject({ failure: "error" });
    expect(apiFailure(answered(500, "api_error", "oops"))).toMatchObject({ failure: "error" });
    expect(apiFailure(new APIConnectionError({ message: "offline" }))).toMatchObject({ failure: "error" });
    expect(apiFailure(new APIUserAbortError())).toMatchObject({ failure: "error" });
    expect(apiFailure(new Error("odd"))).toMatchObject({ failure: "error" });
  });
});
