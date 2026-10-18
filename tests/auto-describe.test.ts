import { describe, expect, it } from "vitest";
import { AUTO_QUIET_MS, AUTO_RETRY_MS, AutoDescribe } from "../src/core/auto-describe";

function harness(over: { enabled?: boolean; busy?: boolean; labeled?: string[] } = {}) {
  const state = { enabled: over.enabled ?? true, busy: over.busy ?? false, labeled: new Set(over.labeled ?? []) };
  const runs: string[][] = [];
  const timers = new Map<number, { fn: () => void; ms: number }>();
  let next = 1;
  const auto = new AutoDescribe({
    enabled: () => state.enabled,
    busy: () => state.busy,
    needs: (path) => !state.labeled.has(path),
    run: (paths) => runs.push(paths),
    setTimer: (fn, ms) => {
      timers.set(next, { fn, ms });
      return next++;
    },
    clearTimer: (id) => timers.delete(id),
  });
  /** Fires the one pending timer, returning how long it was set for. */
  const fire = (): number => {
    expect(timers.size).toBe(1);
    const [[id, timer]] = [...timers];
    timers.delete(id);
    timer.fn();
    return timer.ms;
  };
  return { auto, state, runs, timers, fire };
}

describe("AutoDescribe", () => {
  it("describes a new clip once it has settled", () => {
    const h = harness();
    h.auto.arrived("a.md");
    expect(h.runs).toEqual([]);
    expect(h.fire()).toBe(AUTO_QUIET_MS);
    expect(h.runs).toEqual([["a.md"]]);
  });

  it("gathers clips that land close together into one run, waiting from the last", () => {
    const h = harness();
    h.auto.arrived("a.md");
    h.auto.arrived("b.md");
    h.auto.arrived("a.md");
    expect(h.timers.size).toBe(1);
    h.fire();
    expect(h.runs).toEqual([["a.md", "b.md"]]);
  });

  it("waits a couple of seconds, then checks again every second while something else runs", () => {
    expect(AUTO_QUIET_MS).toBe(2_000);
    expect(AUTO_RETRY_MS).toBe(1_000);
  });

  it("restarts the wait each time a waiting clip is written to, as the Web Clipper does in passes", () => {
    const h = harness();
    h.auto.arrived("a.md");
    h.auto.touched("a.md");
    expect(h.timers.size).toBe(1);
    expect(h.fire()).toBe(AUTO_QUIET_MS);
    expect(h.runs).toEqual([["a.md"]]);
  });

  it("pays no attention to writes to clips it isn't waiting on", () => {
    const h = harness();
    h.auto.touched("old.md");
    expect(h.timers.size).toBe(0);
  });

  it("does nothing while the setting is off or Describe isn't ready", () => {
    const h = harness({ enabled: false });
    h.auto.arrived("a.md");
    expect(h.timers.size).toBe(0);
    expect(h.runs).toEqual([]);
  });

  it("drops the waiting clips if the setting goes off before they run", () => {
    const h = harness();
    h.auto.arrived("a.md");
    h.state.enabled = false;
    h.fire();
    h.state.enabled = true;
    h.auto.arrived("b.md");
    h.fire();
    expect(h.runs).toEqual([["b.md"]]);
  });

  it("waits for a run or a download already going, then describes", () => {
    const h = harness({ busy: true });
    h.auto.arrived("a.md");
    h.fire();
    expect(h.runs).toEqual([]);
    h.state.busy = false;
    expect(h.fire()).toBe(AUTO_RETRY_MS);
    expect(h.runs).toEqual([["a.md"]]);
  });

  it("skips clips that got labels in the meantime, as from another device", () => {
    const h = harness({ labeled: ["b.md"] });
    h.auto.arrived("a.md");
    h.auto.arrived("b.md");
    h.fire();
    expect(h.runs).toEqual([["a.md"]]);
  });

  it("starts no run when every waiting clip was labeled", () => {
    const h = harness({ labeled: ["a.md"] });
    h.auto.arrived("a.md");
    h.fire();
    expect(h.runs).toEqual([]);
  });

  it("follows a waiting clip that is renamed", () => {
    const h = harness();
    h.auto.arrived("Untitled.md");
    h.auto.renamed("Untitled.md", "Reel.md");
    h.auto.renamed("other.md", "elsewhere.md");
    h.fire();
    expect(h.runs).toEqual([["Reel.md"]]);
  });

  it("forgets everything on clear", () => {
    const h = harness();
    h.auto.arrived("a.md");
    h.auto.clear();
    expect(h.timers.size).toBe(0);
    h.auto.arrived("b.md");
    h.fire();
    expect(h.runs).toEqual([["b.md"]]);
  });
});
