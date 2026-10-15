import { describe, expect, it } from "vitest";
import { SwitchingEngine, effectiveEngine, engineReady } from "../src/core/engines";
import type { DescribeEngine } from "../src/core/describe-run";

const fake = (name: string, log: string[]): DescribeEngine => ({
  run: async () => {
    log.push(`run:${name}`);
    return { ok: true, results: [] };
  },
  cancelAll: () => log.push(`cancel:${name}`),
});

describe("effectiveEngine", () => {
  it("keeps the engine the user chose", () => {
    expect(effectiveEngine("api-key", true)).toBe("api-key");
    expect(effectiveEngine("claude-code", false)).toBe("claude-code");
  });

  it("starts on Claude Code when it is installed, otherwise the API key", () => {
    expect(effectiveEngine("", true)).toBe("claude-code");
    expect(effectiveEngine("", false)).toBe("api-key");
  });
});

describe("engineReady", () => {
  const base = { enabled: true, desktop: true, claudeFound: true, hasKey: false, hasLicense: false };

  it("offers Describe once the chosen engine can run", () => {
    expect(engineReady({ ...base, engine: "claude-code" })).toBe(true);
    expect(engineReady({ ...base, engine: "api-key" })).toBe(false);
    expect(engineReady({ ...base, engine: "api-key", hasKey: true })).toBe(true);
    expect(engineReady({ ...base, engine: "claude-code", claudeFound: false })).toBe(false);
  });

  it("offers Oriko Cloud once a license key is saved", () => {
    expect(engineReady({ ...base, engine: "oriko-cloud" })).toBe(false);
    expect(engineReady({ ...base, engine: "oriko-cloud", hasLicense: true })).toBe(true);
  });

  it("stays off when switched off or away from the desktop", () => {
    expect(engineReady({ ...base, engine: "claude-code", enabled: false })).toBe(false);
    expect(engineReady({ ...base, engine: "claude-code", desktop: false })).toBe(false);
  });
});

describe("SwitchingEngine", () => {
  it("runs each batch on the engine chosen at that moment", async () => {
    const log: string[] = [];
    let choice: "claude-code" | "api-key" | "oriko-cloud" = "claude-code";
    const engine = new SwitchingEngine(
      { "claude-code": fake("cc", log), "api-key": fake("api", log), "oriko-cloud": fake("cloud", log) },
      () => choice
    );
    await engine.run([], [], 1000, "standard");
    choice = "api-key";
    await engine.run([], [], 1000, "standard");
    choice = "oriko-cloud";
    await engine.run([], [], 1000, "standard");
    expect(log).toEqual(["run:cc", "run:api", "run:cloud"]);
  });

  it("cancels every engine", () => {
    const log: string[] = [];
    const engine = new SwitchingEngine(
      { "claude-code": fake("cc", log), "api-key": fake("api", log), "oriko-cloud": fake("cloud", log) },
      () => "api-key"
    );
    engine.cancelAll();
    expect(log).toEqual(["cancel:cc", "cancel:api", "cancel:cloud"]);
  });
});
