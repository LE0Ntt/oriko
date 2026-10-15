import { describe, expect, it } from "vitest";
import { cloudBody, cloudOutcome, installLabel, usageLine } from "../src/core/cloud-engine";
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

  it("fails only the batch on anything else, including an answer that is not the server's", () => {
    expect(cloudOutcome(400, { error: "bad-request", message: "" })).toMatchObject({ failure: "error" });
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
