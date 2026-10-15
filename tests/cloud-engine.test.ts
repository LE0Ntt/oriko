import { describe, expect, it } from "vitest";
import {
  ActivationGate,
  CLOUD_IMAGE_MAX,
  CLOUD_LIMITS,
  cloudBody,
  cloudOutcome,
  installLabel,
  looksLikeKey,
  usageLine,
} from "../src/core/cloud-engine";
import type { DescribeJob } from "../src/core/claude-engine";

const job = (over: Partial<DescribeJob> = {}): DescribeJob => ({
  id: 0,
  path: "Clippings/A.md",
  image: "/9j/AAAA",
  title: "A",
  description: "",
  domain: "example.com",
  body: "",
  ...over,
});

const item = (id: number) => ({ id, categories: ["design"], proposals: [], fallback: "design", caption: "A poster.", media_text: "" });

describe("cloudBody", () => {
  it("sends structured jobs without the note's path, never prompt text", () => {
    const body = cloudBody([job(), job({ id: 1, image: null })], ["design"], "specific");
    expect(body).toEqual({
      protocol: 1,
      depth: "specific",
      vocabulary: ["design"],
      jobs: [
        { id: 0, image: "/9j/AAAA", title: "A", description: "", domain: "example.com", body: "" },
        { id: 1, image: null, title: "A", description: "", domain: "example.com", body: "" },
      ],
    });
  });
});

describe("cloudBody limits", () => {
  it("sends a picture past the server's cap as no picture, so one clip can't sink its batch", () => {
    const body = cloudBody([job({ image: "/9j/" + "A".repeat(CLOUD_IMAGE_MAX) })], [], "standard");
    expect(body.jobs[0].image).toBeNull();
    expect(CLOUD_IMAGE_MAX).toBe(1_000_000);
  });
});

describe("cloudBody text limits", () => {
  it("cuts long text and the category list to what the server takes, so no clip sinks its batch", () => {
    const body = cloudBody(
      [job({ title: "t".repeat(800), description: "d".repeat(800), domain: "x".repeat(600) })],
      [...Array.from({ length: 600 }, (_, i) => `term-${i}`), "y".repeat(120)],
      "standard"
    );
    expect(body.jobs[0].title.length).toBe(CLOUD_LIMITS.field);
    expect(body.jobs[0].description.length).toBe(CLOUD_LIMITS.field);
    expect(body.jobs[0].domain.length).toBe(CLOUD_LIMITS.field);
    expect(body.vocabulary.length).toBe(CLOUD_LIMITS.terms);
    expect(body.vocabulary.every((term) => term.length <= CLOUD_LIMITS.term)).toBe(true);
    expect(CLOUD_LIMITS).toEqual({ field: 500, terms: 500, term: 80 });
  });

  it("drops overlong categories before cutting the list, keeping the most used", () => {
    const body = cloudBody([job()], ["design", "z".repeat(81), "food"], "standard");
    expect(body.vocabulary).toEqual(["design", "food"]);
  });
});

describe("ActivationGate", () => {
  it("checks once for all the lanes of a run", async () => {
    let checks = 0;
    const gate = new ActivationGate(async () => {
      checks++;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { ok: true };
    });
    const all = await Promise.all(Array.from({ length: 6 }, () => gate.wait("KEY")));
    expect(all.every((r) => r.ok)).toBe(true);
    expect(checks).toBe(1);
    await gate.wait("KEY");
    expect(checks).toBe(1);
  });

  it("checks again for a new key, after a failure, or when told to forget", async () => {
    let checks = 0;
    let answer: { ok: true } | { ok: false; failure: "device-limit"; message: string } = { ok: false, failure: "device-limit", message: "full" };
    const gate = new ActivationGate(async () => {
      checks++;
      return answer;
    });
    expect(await gate.wait("KEY")).toMatchObject({ ok: false, failure: "device-limit" });
    answer = { ok: true };
    expect(await gate.wait("KEY")).toMatchObject({ ok: true });
    await gate.wait("OTHER");
    gate.forget();
    await gate.wait("OTHER");
    expect(checks).toBe(4);
  });
});

describe("looksLikeKey", () => {
  it("knows a whole license key from a half-typed one", () => {
    expect(looksLikeKey("ORIKO-1C285B2D-6CE6-4BC7-B8BE-ADB6A7E304DA")).toBe(true);
    expect(looksLikeKey("1c285b2d-6ce6-4bc7-b8be-adb6a7e304da")).toBe(true);
    expect(looksLikeKey("ORIKO-1C285B2D-6CE6")).toBe(false);
    expect(looksLikeKey("")).toBe(false);
  });
});

describe("cloudOutcome", () => {
  it("reads the server's results", () => {
    const run = cloudOutcome(200, { results: [item(0), item(1)], usage: { month: "2026-10", used: 2, limit: 1000, bonus: 2000 } });
    expect(run).toMatchObject({ ok: true });
    if (run !== "not-activated" && run.ok) expect(run.results.map((r) => r.id)).toEqual([0, 1]);
  });

  it("asks for activation when the device is not activated yet", () => {
    expect(cloudOutcome(409, { error: "not-activated", message: "" })).toBe("not-activated");
  });

  it("halts on a key, subscription, device or allowance problem, and when the service is unavailable", () => {
    const cases: [number, string, string][] = [
      [401, "license-unknown", "license-rejected"],
      [403, "license-inactive", "license-inactive"],
      [403, "device-limit", "device-limit"],
      [402, "allowance-used", "allowance-used"],
      [503, "unavailable", "cloud-unavailable"],
    ];
    for (const [status, error, failure] of cases) {
      expect(cloudOutcome(status, { error, message: "m" })).toMatchObject({ ok: false, failure });
    }
  });

  it("waits out a rate limit or an overloaded service", () => {
    expect(cloudOutcome(429, { error: "rate-limited", message: "" })).toMatchObject({ failure: "rate-limit" });
    expect(cloudOutcome(503, { error: "overloaded", message: "" })).toMatchObject({ failure: "rate-limit" });
  });

  it("stops the run when the server can't read what Oriko sent, since every batch would fail the same way", () => {
    expect(cloudOutcome(400, { error: "bad-request", message: "" })).toMatchObject({ failure: "cloud-refused" });
  });

  it("fails a batch Claude ran out of time on without retrying its clips, since it was charged", () => {
    expect(cloudOutcome(504, { error: "timeout", message: "" })).toMatchObject({ failure: "batch-lost" });
  });

  it("fails only the batch on anything else, including an answer that is not the server's", () => {
    expect(cloudOutcome(500, { error: "server-error", message: "" })).toMatchObject({ failure: "error" });
    expect(cloudOutcome(502, { error: "upstream", message: "" })).toMatchObject({ failure: "error" });
    expect(cloudOutcome(500, "<html>")).toMatchObject({ failure: "error" });
    expect(cloudOutcome(200, { nothing: true })).toMatchObject({ failure: "error" });
  });
});

describe("usageLine", () => {
  it("says how much of the month is used, and the bonus once it is being drawn on", () => {
    expect(usageLine({ month: "2026-10", used: 212, limit: 1000, bonus: 2000 })).toBe("212 of 1,000 this month");
    expect(usageLine({ month: "2026-10", used: 1000, limit: 1000, bonus: 1800 })).toBe("1,000 of 1,000 this month, 1,800 bonus left");
  });
});

describe("installLabel", () => {
  it("names the device by platform and vault, within the server's limit", () => {
    expect(installLabel("macOS", "Aegis")).toBe("macOS · Aegis");
    expect(installLabel("macOS", "x".repeat(200)).length).toBeLessThanOrEqual(100);
  });
});
