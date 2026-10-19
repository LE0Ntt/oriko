import { describe, expect, it } from "vitest";
import {
  REVISIT_REST_MS,
  RevisitSession,
  RevisitStore,
  isRevisitForget,
  pickRevisit,
} from "../src/core/revisit";

/** A fixed sequence, so a shuffle is repeatable. */
function seeded(seed = 1): () => number {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

const paths = (n: number): string[] => Array.from({ length: n }, (_, i) => `clip-${i}.md`);
const NOW = 1_800_000_000_000;

describe("pickRevisit", () => {
  it("picks the pass size from a bigger wall, each clip once", () => {
    const picked = pickRevisit(paths(100), () => undefined, NOW, seeded());
    expect(picked).toHaveLength(20);
    expect(new Set(picked).size).toBe(20);
  });

  it("takes the whole wall when it has fewer clips than a pass", () => {
    expect(pickRevisit(paths(5), () => undefined, NOW, seeded()).sort()).toEqual(paths(5).sort());
  });

  it("shuffles, so two seeds give two orders", () => {
    const a = pickRevisit(paths(50), () => undefined, NOW, seeded(1));
    const b = pickRevisit(paths(50), () => undefined, NOW, seeded(7));
    expect(a).not.toEqual(b);
  });

  it("leaves out clips shown in the last month while there are enough others", () => {
    const recent = new Set(paths(30).slice(0, 10));
    const picked = pickRevisit(paths(30), (p) => (recent.has(p) ? NOW - 1000 : undefined), NOW, seeded());
    expect(picked.some((p) => recent.has(p))).toBe(false);
  });

  it("counts a clip shown over a month ago as rested", () => {
    const old = NOW - REVISIT_REST_MS;
    const picked = pickRevisit(paths(20), () => old, NOW, seeded());
    expect(picked).toHaveLength(20);
  });

  it("tops up with the clips shown longest ago", () => {
    const seen: Record<string, number> = {
      "clip-0.md": NOW - 1000,
      "clip-1.md": NOW - 5000,
      "clip-2.md": NOW - 3000,
    };
    const picked = pickRevisit(paths(4), (p) => seen[p], NOW, seeded(), 3);
    expect(picked).toEqual(["clip-3.md", "clip-1.md", "clip-2.md"]);
  });

  it("returns nothing for an empty wall", () => {
    expect(pickRevisit([], () => undefined, NOW, seeded())).toEqual([]);
  });
});

describe("RevisitSession", () => {
  it("moves on after each decision and stays on the last clip", () => {
    const session = new RevisitSession(["a.md", "b.md"]);
    session.markShown();
    session.decide("keep");
    expect(session.current()).toBe("b.md");
    session.decide("forget");
    expect(session.current()).toBe("b.md");
    expect(session.position).toBe(2);
    expect(session.finished).toBe(true);
  });

  it("lets a mark be changed by stepping back", () => {
    const session = new RevisitSession(["a.md", "b.md"]);
    session.decide("forget");
    session.step(-1);
    session.decide("keep");
    expect(session.markOf("a.md")).toBe("keep");
    expect(session.forgotten()).toEqual([]);
  });

  it("is not finished while a clip is undecided", () => {
    const session = new RevisitSession(["a.md", "b.md"]);
    session.decide("keep");
    expect(session.finished).toBe(false);
  });

  it("lists forgotten clips in pass order and counts both marks", () => {
    const session = new RevisitSession(["a.md", "b.md", "c.md"]);
    session.decide("forget");
    session.decide("keep");
    session.decide("forget");
    expect(session.forgotten()).toEqual(["a.md", "c.md"]);
    expect(session.counts()).toEqual({ kept: 1, forgotten: 2 });
  });

  it("counts as seen only the clips that were on show", () => {
    const session = new RevisitSession(["a.md", "b.md", "c.md"]);
    session.markShown();
    session.step(1);
    expect(session.seen()).toEqual(["a.md", "b.md"]);
  });

  it("does nothing on an empty pass", () => {
    const session = new RevisitSession([]);
    session.decide("keep");
    session.step(1);
    expect(session.position).toBe(0);
    expect(session.finished).toBe(false);
  });
});

describe("RevisitStore", () => {
  it("round-trips through JSON and ignores what it cannot read", () => {
    const store = new RevisitStore();
    store.record(["a.md", "b.md"], 42);
    const back = RevisitStore.fromJSON(JSON.parse(JSON.stringify(store.toJSON())));
    expect(back.lastSeen("a.md")).toBe(42);
    expect(RevisitStore.fromJSON({ seen: { "x.md": "soon" } }).lastSeen("x.md")).toBeUndefined();
    expect(RevisitStore.fromJSON(null).lastSeen("x.md")).toBeUndefined();
  });

  it("prunes clips that are gone", () => {
    const store = new RevisitStore();
    store.record(["a.md", "b.md"], 1);
    store.prune((p) => p === "a.md");
    expect(store.toJSON()).toEqual({ seen: { "a.md": 1 } });
  });
});

describe("isRevisitForget", () => {
  it("accepts the two choices only", () => {
    expect(isRevisitForget("trash")).toBe(true);
    expect(isRevisitForget("archive")).toBe(true);
    expect(isRevisitForget("delete")).toBe(false);
  });
});
