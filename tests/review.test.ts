import { describe, expect, it } from "vitest";
import { ReviewSession, reviewClips } from "../src/core/review";
import type { PendingStore } from "../src/core/describe";

const store: PendingStore = {
  terms: [
    { term: "projector", definition: "Projectors.", paths: ["reel.md"] },
    { term: "home-theater", definition: "Home cinema.", paths: ["reel.md", "tv.md"] },
    { term: "golf", definition: "Golf.", paths: ["swing.md"] },
  ],
  fallbacks: { "swing.md": "reference" },
};

const now: Record<string, string[]> = { "reel.md": ["gear", "shopping"], "tv.md": ["gear"], "swing.md": [] };
const current = (path: string): string[] | null => now[path] ?? null;

describe("reviewClips", () => {
  it("lists each clip once with its suggestions, in first-suggested order", () => {
    expect(reviewClips(store)).toEqual([
      { path: "reel.md", terms: [{ term: "projector", definition: "Projectors." }, { term: "home-theater", definition: "Home cinema." }] },
      { path: "tv.md", terms: [{ term: "home-theater", definition: "Home cinema." }] },
      { path: "swing.md", terms: [{ term: "golf", definition: "Golf." }] },
    ]);
  });
});

describe("ReviewSession", () => {
  it("walks the clips and stops at the ends", () => {
    const session = new ReviewSession(store);
    expect(session.position).toBe(1);
    expect(session.total).toBe(3);
    session.step(-1);
    expect(session.current()?.path).toBe("reel.md");
    session.step(1);
    session.step(1);
    session.step(1);
    expect(session.current()?.path).toBe("swing.md");
    expect(session.position).toBe(3);
  });

  it("ticks labels per clip", () => {
    const session = new ReviewSession(store);
    session.toggle("reel.md", "home-theater");
    expect(session.isTicked("reel.md", "home-theater")).toBe(true);
    expect(session.isTicked("tv.md", "home-theater")).toBe(false);
    session.toggle("reel.md", "home-theater");
    expect(session.ticked("reel.md")).toEqual([]);
  });

  it("applies only reviewed clips, with fallbacks for empty ones", () => {
    const session = new ReviewSession(store);
    session.markShown();
    session.toggle("reel.md", "projector");
    session.step(1);
    session.markShown();
    session.step(1);
    session.markShown();
    // tv.md was shown with nothing ticked and has labels: nothing to write.
    expect(session.writes(store, current)).toEqual({
      writes: [
        { path: "reel.md", categories: ["gear", "shopping", "projector"] },
        { path: "swing.md", categories: ["reference"] },
      ],
      skipped: 0,
    });
    expect(session.counts()).toEqual({ labels: 1, clips: 3 });
  });

  it("leaves clips never shown out of the writes and keeps them waiting", () => {
    const session = new ReviewSession(store);
    session.markShown();
    session.toggle("reel.md", "projector");
    expect(session.writes(store, current).writes.map((w) => w.path)).toEqual(["reel.md"]);
    expect(session.remaining(store, []).terms.map((t) => [t.term, t.paths])).toEqual([
      ["home-theater", ["tv.md"]],
      ["golf", ["swing.md"]],
    ]);
  });

  it("keeps failed writes waiting", () => {
    const session = new ReviewSession(store);
    session.markShown();
    expect(session.remaining(store, ["reel.md"]).terms.map((t) => t.term)).toEqual([
      "projector",
      "home-theater",
      "golf",
    ]);
  });

  it("skips a reviewed clip that is gone", () => {
    const session = new ReviewSession(store);
    session.markShown();
    session.toggle("reel.md", "projector");
    expect(session.writes(store, () => null)).toEqual({ writes: [], skipped: 1 });
  });

  it("keeps ticks, reviewed marks and place across a rebuild", () => {
    const first = new ReviewSession(store);
    first.markShown();
    first.toggle("reel.md", "projector");
    first.step(1);
    const grown: PendingStore = {
      terms: [...store.terms, { term: "food", definition: "Food.", paths: ["bowl.md"] }],
      fallbacks: store.fallbacks,
    };
    const next = new ReviewSession(grown, first);
    expect(next.total).toBe(4);
    expect(next.current()?.path).toBe("tv.md");
    expect(next.isTicked("reel.md", "projector")).toBe(true);
    expect(next.writes(grown, current).writes.map((w) => w.path)).toEqual(["reel.md"]);
  });

  it("is empty for an empty store", () => {
    const session = new ReviewSession({ terms: [], fallbacks: {} });
    expect(session.current()).toBeNull();
    expect(session.position).toBe(0);
  });
});
