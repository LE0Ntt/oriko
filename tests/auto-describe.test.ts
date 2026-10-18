import { describe, expect, it } from "vitest";
import { AutoDescribe, clipComplete } from "../src/core/auto-describe";
import type { MediaRef } from "../src/core/scan";

function harness(over: { enabled?: boolean; busy?: boolean; labeled?: string[]; incomplete?: string[] } = {}) {
  const state = {
    enabled: over.enabled ?? true,
    busy: over.busy ?? false,
    labeled: new Set(over.labeled ?? []),
    incomplete: new Set(over.incomplete ?? []),
  };
  const runs: string[][] = [];
  let finish: (() => void) | null = null;
  const auto = new AutoDescribe({
    enabled: () => state.enabled,
    complete: (path) => !state.incomplete.has(path),
    needs: (path) => !state.labeled.has(path),
    busy: () => state.busy,
    run: (paths) => {
      runs.push(paths);
      return new Promise<void>((resolve) => (finish = resolve));
    },
  });
  /** Ends the run going, then lets the follow-up check happen. */
  const end = async (): Promise<void> => {
    finish?.();
    finish = null;
    await Promise.resolve();
    await Promise.resolve();
  };
  return { auto, state, runs, end };
}

const ref = (url: string): MediaRef => ({ url, kind: "image", alt: "" });

describe("AutoDescribe", () => {
  it("describes a clip as capture's last step, with no wait", () => {
    const h = harness();
    h.auto.claim("a.md");
    h.auto.captured("a.md");
    expect(h.runs).toEqual([["a.md"]]);
  });

  it("leaves a clip capture is making to capture, even when its arrival is heard first", () => {
    const h = harness();
    h.auto.claim("a.md");
    h.auto.arrived("a.md");
    expect(h.runs).toEqual([]);
  });

  it("describes a synced clip the moment it is complete on arrival", () => {
    const h = harness();
    h.auto.arrived("phone.md");
    expect(h.runs).toEqual([["phone.md"]]);
  });

  it("holds a synced clip until its files arrive, then goes at the next check", () => {
    const h = harness({ incomplete: ["phone.md"] });
    h.auto.arrived("phone.md");
    h.auto.check();
    expect(h.runs).toEqual([]);
    h.state.incomplete.clear();
    h.auto.check();
    expect(h.runs).toEqual([["phone.md"]]);
  });

  it("queues clips behind a run already going and sends them together when it ends", async () => {
    const h = harness();
    h.auto.captured("a.md");
    h.auto.captured("b.md");
    h.auto.arrived("c.md");
    expect(h.runs).toEqual([["a.md"]]);
    await h.end();
    expect(h.runs).toEqual([["a.md"], ["b.md", "c.md"]]);
  });

  it("waits out a run someone else started, going when that run's end is checked", () => {
    const h = harness({ busy: true });
    h.auto.captured("a.md");
    expect(h.runs).toEqual([]);
    h.state.busy = false;
    h.auto.check();
    expect(h.runs).toEqual([["a.md"]]);
  });

  it("skips clips that got labels meanwhile, as from another device", () => {
    const h = harness({ busy: true, labeled: ["b.md"] });
    h.auto.captured("a.md");
    h.auto.captured("b.md");
    h.state.busy = false;
    h.auto.check();
    expect(h.runs).toEqual([["a.md"]]);
  });

  it("does nothing while the setting is off or Describe isn't ready", () => {
    const h = harness({ enabled: false });
    h.auto.captured("a.md");
    h.auto.arrived("b.md");
    expect(h.runs).toEqual([]);
  });

  it("drops waiting clips if the setting goes off before they are complete", () => {
    const h = harness({ incomplete: ["a.md"] });
    h.auto.arrived("a.md");
    h.state.enabled = false;
    h.auto.check();
    h.state.enabled = true;
    h.state.incomplete.clear();
    h.auto.check();
    expect(h.runs).toEqual([]);
  });

  it("follows a waiting clip that is renamed", () => {
    const h = harness({ incomplete: ["Untitled.md", "Reel.md"] });
    h.auto.arrived("Untitled.md");
    h.auto.renamed("Untitled.md", "Reel.md");
    h.state.incomplete.clear();
    h.auto.check();
    expect(h.runs).toEqual([["Reel.md"]]);
  });

  it("forgets everything on clear", () => {
    const h = harness({ incomplete: ["a.md"] });
    h.auto.arrived("a.md");
    h.auto.clear();
    h.state.incomplete.clear();
    h.auto.check();
    expect(h.runs).toEqual([]);
  });
});

describe("clipComplete", () => {
  const here = new Set(["Attachments/Clippings/a.jpg"]);
  const has = (path: string): boolean => here.has(path);

  it("is complete once every file the note embeds is in the vault", () => {
    expect(clipComplete([ref("Attachments/Clippings/a.jpg")], has, false)).toBe(true);
    expect(clipComplete([ref("Attachments/Clippings/a.jpg"), ref("Attachments/Clippings/b.mp4")], has, false)).toBe(false);
  });

  it("isn't complete while a download is waiting or going", () => {
    expect(clipComplete([ref("https://example.com/a.jpg")], has, true)).toBe(false);
    expect(clipComplete([], has, true)).toBe(false);
  });

  it("takes web media as done once no download is pending, and a clip with no media at once", () => {
    expect(clipComplete([ref("https://example.com/a.jpg")], has, false)).toBe(true);
    expect(clipComplete([], has, false)).toBe(true);
  });
});
