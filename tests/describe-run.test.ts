import { describe, expect, it } from "vitest";
import { DescribeRunner, HALTS } from "../src/core/describe-run";
import type { DescribeEngine, DescribeWriter } from "../src/core/describe-run";
import type { DescribeJob, RawResult, RunOutcome } from "../src/core/claude-engine";
import type { PendingStore } from "../src/core/describe";
import type { FrontmatterWrite } from "../src/core/editable";
import type { HistoryEntry } from "../src/core/history";
import type { ClippingRecord } from "../src/core/scan";

const rec = (path: string, categories: string[] = []): ClippingRecord => ({
  path,
  title: path,
  source: "",
  description: "",
  categories,
  status: "unread",
  created: "",
  cover: "",
  grid: "",
  folder: "",
  media: [],
  haystack: "",
  properties: categories.length ? { categories } : {},
});

const answer = (id: number, over: Partial<RawResult> = {}): RawResult => ({
  id,
  categories: ["design"],
  proposals: [],
  fallback: "design",
  caption: `Caption ${id}.`,
  media_text: "",
  ...over,
});

const allGood = async (jobs: DescribeJob[]): Promise<RunOutcome> => ({
  ok: true,
  results: jobs.map((job) => answer(job.id)),
});

interface Harness {
  runner: DescribeRunner;
  writer: DescribeWriter;
  events: string[];
  notices: string[];
  written: Array<[string, FrontmatterWrite]>;
  entries: HistoryEntry[];
}

function harness(
  options: {
    paths?: string[];
    filed?: ClippingRecord[];
    run?: DescribeEngine["run"];
    prepare?: (path: string, id: number) => Promise<DescribeJob | null>;
    write?: (path: string, values: FrontmatterWrite) => Promise<boolean>;
    cancelAll?: () => void;
  } = {}
): Harness {
  const events: string[] = [];
  const notices: string[] = [];
  const written: Array<[string, FrontmatterWrite]> = [];
  const entries: HistoryEntry[] = [];
  const records = new Map<string, ClippingRecord>();
  // One filed clipping gives the wall its vocabulary.
  for (const r of options.filed ?? [rec("filed.md", ["design", "media"])]) records.set(r.path, r);
  for (const path of options.paths ?? []) records.set(path, rec(path));
  const run = options.run ?? allGood;

  const runner = new DescribeRunner(
    {
      engine: {
        run: (jobs, vocabulary, timeoutMs) => {
          events.push(`run:${jobs.map((job) => job.path).join(",")}`);
          return run(jobs, vocabulary, timeoutMs);
        },
        cancelAll: () => {
          events.push("cancel");
          options.cancelAll?.();
        },
      },
      prepare:
        options.prepare ??
        (async (path, id) =>
          records.has(path)
            ? { id, path, image: null, title: path, description: "", domain: "", body: "" }
            : null),
      record: (path) => records.get(path),
      records: () => [...records.values()],
      save: async () => {
        events.push("save");
      },
      wait: async () => {
        events.push("wait");
      },
      progress: () => undefined,
      notify: (text) => notices.push(text),
    },
    { batchSize: 1, concurrency: 1, rateLimitWaitMs: 0, batchTimeoutMs: 1000, singleTimeoutMs: 1000 }
  );
  const writer: DescribeWriter = {
    write:
      options.write ??
      (async (path, values) => {
        written.push([path, values]);
        return true;
      }),
    record: (entry) => entries.push(entry),
  };
  return { runner, writer, events, notices, written, entries };
}

const pending = (store: PendingStore): PendingStore => store;

describe("DescribeRunner", () => {
  it("writes each answer and records the run as one undo step", async () => {
    const h = harness({ paths: ["a.md", "b.md"] });
    await h.runner.describe(["a.md", "b.md"], h.writer);
    expect(h.written.map(([path]) => path)).toEqual(["a.md", "b.md"]);
    expect(h.written[0][1]).toEqual({ caption: "Caption 0.", media_text: "", categories: ["design"] });
    expect(h.entries.map((e) => e.label)).toEqual(["Describe 2 clippings"]);
    expect(h.notices.at(-1)).toBe("Oriko: 2 described");
  });

  it("keeps undo and fails only the rest when a batch throws", async () => {
    const h = harness({
      paths: ["a.md", "b.md", "c.md"],
      prepare: async (path, id) => {
        if (path === "b.md") throw new Error("read failed");
        return { id, path, image: null, title: path, description: "", domain: "", body: "" };
      },
    });
    await h.runner.describe(["a.md", "b.md", "c.md"], h.writer);
    expect(h.written.map(([path]) => path)).toEqual(["a.md", "c.md"]);
    expect(h.entries).toHaveLength(1);
    expect(h.runner.context(0).failed).toBe(1);
    expect(h.notices.at(-1)).toBe("Oriko: 2 described, 1 failed");
  });

  it("halts after a rate limit that outlasts one wait", async () => {
    const h = harness({
      paths: ["a.md", "b.md"],
      run: async () => ({ ok: false, failure: "rate-limit", message: "429" }),
    });
    await h.runner.describe(["a.md", "b.md"], h.writer);
    expect(h.events.filter((e) => e.startsWith("run:"))).toHaveLength(2);
    expect(h.events).toContain("wait");
    expect(h.notices.at(-1)).toBe(HALTS["rate-limit"]);
  });

  it("halts at once when Claude Code is missing", async () => {
    const h = harness({
      paths: ["a.md", "b.md"],
      run: async () => ({ ok: false, failure: "not-found", message: "Claude Code was not found" }),
    });
    await h.runner.describe(["a.md", "b.md"], h.writer);
    expect(h.events.filter((e) => e.startsWith("run:"))).toHaveLength(1);
    expect(h.notices.at(-1)).toBe(HALTS["not-found"]);
  });

  it("saves suggestions as each batch finishes", async () => {
    const h = harness({
      paths: ["a.md", "b.md"],
      run: async (jobs) => ({
        ok: true,
        results: jobs.map((job) => answer(job.id, { categories: [], proposals: [{ term: "food", definition: "D" }] })),
      }),
    });
    await h.runner.describe(["a.md", "b.md"], h.writer);
    expect(h.events.indexOf("save")).toBeGreaterThan(-1);
    expect(h.events.indexOf("save")).toBeLessThan(h.events.indexOf("run:b.md"));
  });

  it("counts only this run's suggestions in its summary", async () => {
    const h = harness({
      paths: ["a.md"],
      run: async (jobs) => ({
        ok: true,
        results: jobs.map((job) => answer(job.id, { categories: [], proposals: [{ term: "food", definition: "D" }] })),
      }),
    });
    h.runner.setPending(pending({ terms: [{ term: "old", definition: "", paths: ["x.md"] }], fallbacks: {} }));
    await h.runner.describe(["a.md"], h.writer);
    expect(h.notices.at(-1)).toBe("Oriko: 1 described, 1 category to review");
    expect(h.runner.context(0).pending.map((p) => p.term)).toEqual(["old", "food"]);
  });

  it("leaves a filed clipping out of the suggestions", async () => {
    const h = harness({
      filed: [rec("filed.md", ["design"])],
      run: async (jobs) => ({
        ok: true,
        results: jobs.map((job) => answer(job.id, { proposals: [{ term: "food", definition: "D" }] })),
      }),
    });
    await h.runner.describe(["filed.md"], h.writer);
    expect(h.runner.context(0).pending).toEqual([]);
    expect(h.written[0][1]).toEqual({ caption: "Caption 0.", media_text: "" });
  });

  it("refuses to apply a review while a run is going", async () => {
    let release: (outcome: RunOutcome) => void = () => undefined;
    const h = harness({
      paths: ["a.md", "b.md"],
      run: (jobs) =>
        jobs[0].path === "a.md"
          ? new Promise<RunOutcome>((resolve) => (release = resolve))
          : allGood(jobs),
    });
    h.runner.setPending(pending({ terms: [{ term: "food", definition: "", paths: ["b.md"] }], fallbacks: {} }));
    h.runner.toggle("food");
    const running = h.runner.describe(["a.md"], h.writer);
    await new Promise((r) => setTimeout(r, 0));
    await h.runner.apply(h.writer);
    expect(h.written).toEqual([]);
    expect(h.notices.at(-1)).toBe("Oriko: wait for describing to finish, then apply the review");
    release({ ok: true, results: [answer(0)] });
    await running;
  });

  it("reports skipped clippings and keeps failed writes for the next review", async () => {
    const h = harness({
      paths: ["b.md", "c.md"],
      write: async (path, values) => {
        if (path === "b.md") return false;
        return Boolean(values);
      },
    });
    h.runner.setPending(
      pending({ terms: [{ term: "food", definition: "D", paths: ["a.md", "b.md", "c.md"] }], fallbacks: {} })
    );
    h.runner.toggle("food");
    await h.runner.apply(h.writer);
    expect(h.notices.at(-1)).toBe(
      "Oriko: categories updated on 1 clipping, 1 skipped (renamed or deleted), 1 failed (kept for the next review)"
    );
    expect(h.runner.context(0).pending).toEqual([{ term: "food", definition: "D", count: 1 }]);
    expect(h.runner.context(0).accepted.has("food")).toBe(true);
  });

  it("stops when asked and keeps what it wrote", async () => {
    let release: (outcome: RunOutcome) => void = () => undefined;
    const h = harness({
      paths: ["a.md", "b.md"],
      run: (jobs) =>
        jobs[0].path === "b.md" ? new Promise<RunOutcome>((resolve) => (release = resolve)) : allGood(jobs),
      cancelAll: () => release({ ok: false, failure: "error", message: "killed" }),
    });
    const running = h.runner.describe(["a.md", "b.md"], h.writer);
    while (!h.events.includes("run:b.md")) await new Promise((r) => setTimeout(r, 0));
    h.runner.stop();
    await running;
    expect(h.written.map(([path]) => path)).toEqual(["a.md"]);
    expect(h.entries).toHaveLength(1);
    expect(h.notices.at(-1)).toBe("Oriko: 1 described (stopped)");
  });
});
