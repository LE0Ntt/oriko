import { describe, expect, it } from "vitest";
import {
  EMPTY_PENDING,
  addPending,
  batches,
  bodyExcerpt,
  describedValues,
  fitWithin,
  gridCell,
  inPool,
  isDescribed,
  limiter,
  kebab,
  matchResults,
  matchVocabulary,
  needsDescribing,
  parsePending,
  resolveReview,
  retainPending,
  snapshot,
  subjectSummary,
  suggestionsFor,
  validate,
  wallVocabulary,
} from "../src/core/describe";
import type { Described } from "../src/core/describe";
import type { RawResult } from "../src/core/claude-engine";
import type { ClippingRecord } from "../src/core/scan";

const record = (path: string, over: Partial<ClippingRecord> = {}): ClippingRecord => ({
  path,
  title: path,
  source: "",
  description: "",
  categories: [],
  status: "unread",
  created: "",
  cover: "",
  grid: "",
  folder: "",
  media: [],
  haystack: "",
  properties: {},
  ...over,
});

const raw = (over: Partial<RawResult> = {}): RawResult => ({
  id: 0,
  categories: [],
  proposals: [],
  fallback: "",
  caption: "A caption.",
  media_text: "",
  ...over,
});

const described = (over: Partial<Described> = {}): Described => ({
  path: "a.md",
  categories: [],
  proposals: [],
  fallback: null,
  caption: "A caption.",
  mediaText: "",
  ...over,
});

describe("choosing clippings", () => {
  it("counts a clipping with a caption as described", () => {
    expect(isDescribed(record("a.md", { properties: { caption: ["A golfer."] } }))).toBe(true);
    expect(isDescribed(record("a.md", { properties: { caption: ["  "] } }))).toBe(false);
  });

  it("describes clippings with no categories and no caption", () => {
    const list = needsDescribing([
      record("new.md"),
      record("tagged.md", { categories: ["design"] }),
      record("waiting.md", { properties: { caption: ["Waiting for review."] } }),
    ]);
    expect(list.map((r) => r.path)).toEqual(["new.md"]);
  });

  it("splits into batches of ten", () => {
    const sizes = batches(Array.from({ length: 23 }, (_, i) => i)).map((b) => b.length);
    expect(sizes).toEqual([10, 10, 3]);
  });

  it("never runs more than the limit at once", async () => {
    let running = 0;
    let peak = 0;
    await inPool([1, 2, 3, 4, 5, 6, 7], 3, async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
    });
    expect(peak).toBe(3);
  });

  it("keeps the other lanes going when one item throws, and reports it", async () => {
    const done: number[] = [];
    const errors: number[] = [];
    await inPool(
      [1, 2, 3, 4],
      2,
      async (n) => {
        if (n === 2) throw new Error("boom");
        done.push(n);
      },
      (n) => errors.push(n)
    );
    expect(done.sort()).toEqual([1, 3, 4]);
    expect(errors).toEqual([2]);
  });

  it("shares one limit across separate callers", async () => {
    const limit = limiter(2);
    let running = 0;
    let peak = 0;
    const task = (): Promise<number> =>
      limit(async () => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 5));
        running--;
        return 1;
      });
    expect(await Promise.all([task(), task(), task(), task(), task()])).toEqual([1, 1, 1, 1, 1]);
    expect(peak).toBe(2);
  });
});

describe("note text", () => {
  it("drops embeds and collapses whitespace", () => {
    const body = "Intro\n\n![[clip.mp4]]\n![alt](https://x/y.jpg)\n<video src='z.mp4'></video>\nMore   text";
    expect(bodyExcerpt(body)).toBe("Intro More text");
  });

  it("cuts to the limit", () => {
    expect(bodyExcerpt("a".repeat(2000), 1500)).toHaveLength(1500);
  });
});

describe("vocabulary", () => {
  it("lists the wall's categories, most used first", () => {
    const vocab = wallVocabulary([
      record("a.md", { categories: ["ios", "design"] }),
      record("b.md", { categories: ["design"] }),
    ]);
    expect(vocab).toEqual(["design", "ios"]);
  });

  it("kebab-cases terms", () => {
    expect(kebab("  Golf Swing_Tips ")).toBe("golf-swing-tips");
  });

  it("matches case and plural variants to the wall's spelling", () => {
    expect(matchVocabulary("iOS", ["ios"])).toBe("ios");
    expect(matchVocabulary("game", ["games"])).toBe("games");
    expect(matchVocabulary("sketches", ["sketch"])).toBe("sketch");
    expect(matchVocabulary("food", ["ios"])).toBeNull();
    expect(matchVocabulary("", ["s"])).toBeNull();
    expect(matchVocabulary("news", ["new"])).toBeNull();
    expect(matchVocabulary("ios", ["io"])).toBeNull();
    expect(matchVocabulary("icons", ["icon"])).toBe("icon");
  });
});

describe("validate", () => {
  it("maps variants to the wall's spelling and drops unknown categories", () => {
    const d = validate(raw({ categories: ["iOS", "made-up", "Design"] }), "a.md", ["ios", "design"]);
    expect(d.categories).toEqual(["ios", "design"]);
  });

  it("turns a proposal that is only a variant into that category", () => {
    const d = validate(raw({ proposals: [{ term: "Games", definition: "x" }] }), "a.md", ["game"]);
    expect(d.categories).toEqual(["game"]);
    expect(d.proposals).toEqual([]);
  });

  it("keeps a new proposal, kebab-cased, once", () => {
    const d = validate(
      raw({
        proposals: [
          { term: "Golf Swing", definition: "Golf technique." },
          { term: "golf-swing", definition: "Again." },
        ],
      }),
      "a.md",
      ["design"]
    );
    expect(d.proposals).toEqual([{ term: "golf-swing", definition: "Golf technique." }]);
  });

  it("caps categories at four and trims long text", () => {
    const vocab = ["a", "b", "c", "d", "e"];
    const d = validate(
      raw({ categories: vocab, caption: "x".repeat(400), media_text: "line one\n\nline two" }),
      "a.md",
      vocab
    );
    expect(d.categories).toHaveLength(4);
    expect(d.caption.length).toBeLessThanOrEqual(300);
    expect(d.mediaText).toBe("line one / line two");
  });

  it("keeps the fallback only when it is on the wall", () => {
    expect(validate(raw({ fallback: "Media" }), "a.md", ["media"]).fallback).toBe("media");
    expect(validate(raw({ fallback: "nope" }), "a.md", ["media"]).fallback).toBeNull();
  });
});

describe("matchResults", () => {
  it("pairs answers with jobs by id and sends the rest back for a retry", () => {
    const jobs = [{ id: 0 }, { id: 1 }, { id: 2 }, { id: 3 }];
    const { matched, missing } = matchResults(jobs, [
      raw({ id: 0 }),
      raw({ id: 0, caption: "Duplicate." }),
      raw({ id: 2, caption: "  " }),
      raw({ id: 3 }),
      raw({ id: 9 }),
    ]);
    expect(matched.map(([job]) => job.id)).toEqual([0, 3]);
    expect(matched[0][1].caption).toBe("A caption.");
    expect(missing.map((job) => job.id)).toEqual([1, 2]);
  });
});

describe("writes", () => {
  it("writes categories only to a clipping that has none", () => {
    const d = described({ categories: ["design"], mediaText: "Hello" });
    expect(describedValues([], d)).toEqual({
      caption: "A caption.",
      media_text: "Hello",
      categories: ["design"],
    });
    expect(describedValues(["ios"], d)).toEqual({ caption: "A caption.", media_text: "Hello" });
  });

  it("snapshots what a write will replace, in the same shapes", () => {
    const r = record("a.md", { properties: { categories: ["ios"], caption: ["Old."] } });
    expect(snapshot(r, { categories: ["design"], caption: "New.", media_text: "x" })).toEqual({
      categories: ["ios"],
      caption: "Old.",
      media_text: "",
    });
  });
});

describe("suggestions", () => {
  it("collects each suggested term with the clippings it was suggested for", () => {
    let store = addPending(
      EMPTY_PENDING,
      described({ path: "a.md", fallback: "media", proposals: [{ term: "food", definition: "Dishes." }] })
    );
    store = addPending(
      store,
      described({ path: "b.md", proposals: [{ term: "food", definition: "Other wording." }] })
    );
    expect(store.terms).toEqual([{ term: "food", definition: "Dishes.", paths: ["a.md", "b.md"] }]);
    expect(store.fallbacks).toEqual({ "a.md": "media" });
    expect(EMPTY_PENDING.terms).toEqual([]);
  });

  it("keeps suggestions only for a clipping that had no categories", () => {
    const d = described({ proposals: [{ term: "food", definition: "" }], fallback: "media" });
    expect(suggestionsFor([], d)).toBe(d);
    expect(suggestionsFor(["coffee"], d)).toEqual({ ...d, proposals: [], fallback: null });
  });

  it("keeps only the given clippings' suggestions for the next review", () => {
    const store = {
      terms: [
        { term: "food", definition: "D", paths: ["a.md", "b.md"] },
        { term: "golf", definition: "G", paths: ["c.md"] },
      ],
      fallbacks: { "a.md": "media", "b.md": "media", "c.md": "reference" },
    };
    expect(retainPending(store, ["b.md"])).toEqual({
      terms: [{ term: "food", definition: "D", paths: ["b.md"] }],
      fallbacks: { "b.md": "media" },
    });
  });

  it("ignores a clipping with no suggestions", () => {
    expect(addPending(EMPTY_PENDING, described({ fallback: "media" }))).toBe(EMPTY_PENDING);
  });

  it("reads a saved store defensively", () => {
    expect(parsePending(null)).toEqual(EMPTY_PENDING);
    expect(
      parsePending({
        terms: [{ term: "food", definition: "D", paths: ["a.md", 3] }, { bad: true }],
        fallbacks: { "a.md": "media", "b.md": 1 },
      })
    ).toEqual({ terms: [{ term: "food", definition: "D", paths: ["a.md"] }], fallbacks: { "a.md": "media" } });
  });
});

describe("resolveReview", () => {
  const store = {
    terms: [
      { term: "food", definition: "", paths: ["a.md", "b.md"] },
      { term: "golf", definition: "", paths: ["c.md"] },
    ],
    fallbacks: { "a.md": "media", "c.md": "reference" },
  };
  const now: Record<string, string[]> = { "a.md": [], "b.md": ["coffee"], "c.md": [] };

  it("adds accepted terms and gives rejected-only clippings their fallback", () => {
    const writes = resolveReview(store, new Set(["food"]), (p) => now[p] ?? null);
    expect(writes).toEqual([
      { path: "a.md", categories: ["food"] },
      { path: "b.md", categories: ["coffee", "food"] },
      { path: "c.md", categories: ["reference"] },
    ]);
  });

  it("skips a clipping that is gone", () => {
    const writes = resolveReview(store, new Set(["food"]), (p) => (p === "a.md" ? null : (now[p] ?? null)));
    expect(writes.map((w) => w.path)).toEqual(["b.md", "c.md"]);
  });

  it("writes nothing without accepted terms or fallbacks", () => {
    const bare = { terms: [{ term: "food", definition: "", paths: ["a.md"] }], fallbacks: {} };
    expect(resolveReview(bare, new Set(), () => [])).toEqual([]);
  });
});

describe("media sizes", () => {
  it("fits within the long edge without enlarging", () => {
    expect(fitWithin(2048, 1024)).toEqual({ width: 1024, height: 512 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it("fits each video frame inside half the grid's width, both ways", () => {
    expect(gridCell(1920, 1080)).toEqual({ width: 512, height: 288 });
    // A portrait video keeps its shape inside the box; it once made a 1024 x 1820 grid.
    expect(gridCell(1080, 1920)).toEqual({ width: 288, height: 512 });
    expect(gridCell(1000, 1000)).toEqual({ width: 512, height: 512 });
  });
});

describe("depth", () => {
  it("caps categories by depth", () => {
    const vocab = ["a", "b", "c", "d", "e", "f", "g"];
    expect(validate(raw({ categories: vocab }), "a.md", vocab, "broad").categories).toHaveLength(2);
    expect(validate(raw({ categories: vocab }), "a.md", vocab, "specific").categories).toHaveLength(6);
    expect(validate(raw({ categories: vocab }), "a.md", vocab).categories).toHaveLength(4);
  });

  it("adds to a selected clipping's labels without removing any", () => {
    const d = described({ categories: ["gear", "projector"] });
    expect(describedValues(["gear", "shopping"], d, { add: true, cap: 6 })).toEqual({
      caption: "A caption.",
      media_text: "",
      categories: ["gear", "shopping", "projector"],
    });
  });

  it("adds nothing past the cap, and never drops what is there", () => {
    const d = described({ categories: ["projector"] });
    expect(describedValues(["a", "b"], d, { add: true, cap: 2 })).toEqual({ caption: "A caption.", media_text: "" });
  });

  it("offers suggestions for a selected clipping that has room", () => {
    const d = described({ proposals: [{ term: "projector", definition: "" }], fallback: "gear" });
    expect(suggestionsFor(["gear", "shopping"], d, { selected: true, cap: 6 }).proposals).toHaveLength(1);
    expect(suggestionsFor(["a", "b"], d, { selected: true, cap: 2 }).proposals).toEqual([]);
    expect(suggestionsFor(["gear"], d).proposals).toEqual([]);
  });
});

describe("subjectSummary", () => {
  const records = new Map([
    ["reel.md", record("reel.md", { title: "AWOL Vision LuxVision", categories: ["gear", "shopping"] })],
    ["new.md", record("new.md")],
  ]);
  const find = (path: string): ClippingRecord | undefined => records.get(path);

  it("names a single clipping and its labels", () => {
    expect(subjectSummary(["reel.md"], find)).toEqual({
      count: 1,
      labelled: 1,
      title: "AWOL Vision LuxVision",
      labels: ["gear", "shopping"],
    });
  });

  it("counts how many of several already have labels", () => {
    expect(subjectSummary(["reel.md", "new.md", "gone.md"], find)).toEqual({ count: 2, labelled: 1 });
  });
});
