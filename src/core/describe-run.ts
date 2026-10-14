import type { DescribeJob, RawResult, RunOutcome } from "./claude-engine";
import type { DescribeContext } from "./commands";
import {
  BATCH_SIZE,
  BATCH_TIMEOUT_MS,
  CONCURRENCY,
  EMPTY_PENDING,
  SINGLE_TIMEOUT_MS,
  addPending,
  batches,
  describedValues,
  inPool,
  matchResults,
  resolveReview,
  retainPending,
  snapshot,
  suggestionsFor,
  validate,
  wallVocabulary,
} from "./describe";
import type { PendingStore } from "./describe";
import type { FrontmatterWrite } from "./editable";
import type { HistoryEntry } from "./history";
import type { ClippingRecord } from "./scan";

/**
 * A Describe run and the review that follows it: batching, retries, halts,
 * writes, undo, and the waiting suggestions. Pure, so every path through it
 * is tested with a fake engine; src/describe-service.ts supplies the real
 * engine, the media, the notices and the file the suggestions are kept in.
 */

export interface DescribeEngine {
  run(jobs: DescribeJob[], vocabulary: string[], timeoutMs: number): Promise<RunOutcome>;
  /** Ends every running call. Their runs resolve as errors. */
  cancelAll(): void;
}

export interface DescribeWriter {
  write(path: string, values: FrontmatterWrite): Promise<boolean>;
  record(entry: HistoryEntry): void;
}

export interface RunnerDeps {
  engine: DescribeEngine;
  /** A clipping's job (media and note text), or null when it is gone. */
  prepare(path: string, id: number): Promise<DescribeJob | null>;
  record(path: string): ClippingRecord | undefined;
  records(): readonly ClippingRecord[];
  save(store: PendingStore): Promise<void>;
  wait(ms: number): Promise<void>;
  /** The in-place progress line, or null to take it down. */
  progress(text: string | null): void;
  notify(text: string): void;
}

export interface RunnerOptions {
  batchSize: number;
  concurrency: number;
  rateLimitWaitMs: number;
  batchTimeoutMs: number;
  singleTimeoutMs: number;
}

export const RUNNER_DEFAULTS: RunnerOptions = {
  batchSize: BATCH_SIZE,
  concurrency: CONCURRENCY,
  rateLimitWaitMs: 20000,
  batchTimeoutMs: BATCH_TIMEOUT_MS,
  singleTimeoutMs: SINGLE_TIMEOUT_MS,
};

type Halt = "not-logged-in" | "usage-limit" | "rate-limit" | "not-found";

export const HALTS: Record<Halt, string> = {
  "not-logged-in":
    "Oriko: Claude Code is not logged in. Run claude in a terminal, sign in with /login, then describe again.",
  "usage-limit": "Oriko: your Claude usage limit is reached. Describing stopped; what was described is kept.",
  "rate-limit":
    "Oriko: Claude is limiting requests right now. Describing stopped; what was described is kept. Try again in a few minutes.",
  "not-found": "Oriko: Claude Code was not found. Check Settings → Oriko → Claude Code path.",
};

interface Written {
  path: string;
  before: FrontmatterWrite;
  after: FrontmatterWrite;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function entry(label: string, written: Written[], writer: DescribeWriter): HistoryEntry {
  return {
    label,
    undo: async () => {
      for (const w of written) await writer.write(w.path, w.before);
    },
    redo: async () => {
      for (const w of written) await writer.write(w.path, w.after);
    },
  };
}

export class DescribeRunner {
  private running = false;
  private stopped = false;
  private halted: string | null = null;
  private done = 0;
  private total = 0;
  private failed: string[] = [];
  /** Paths this run has counted, done or failed, so a lane that throws fails only the rest. */
  private handled = new Set<string>();
  /** Terms this run suggested, for its summary. */
  private suggested = new Set<string>();
  private pending: PendingStore = EMPTY_PENDING;
  private accepted = new Set<string>();

  constructor(
    private deps: RunnerDeps,
    private options: RunnerOptions = RUNNER_DEFAULTS
  ) {}

  setPending(store: PendingStore): void {
    this.pending = store;
  }

  context(uncategorized: number): DescribeContext {
    return {
      running: this.running,
      done: this.done,
      total: this.total,
      uncategorized,
      failed: this.failed.length,
      pending: this.pending.terms.map((t) => ({
        term: t.term,
        definition: t.definition,
        count: t.paths.length,
      })),
      accepted: this.accepted,
    };
  }

  async describe(paths: string[], writer: DescribeWriter): Promise<void> {
    if (this.running || paths.length === 0) return;
    this.running = true;
    this.stopped = false;
    this.halted = null;
    this.done = 0;
    this.total = paths.length;
    this.failed = [];
    this.handled = new Set();
    this.suggested = new Set();
    const vocabulary = wallVocabulary(this.deps.records());
    const written: Written[] = [];
    this.deps.progress(this.progress());

    try {
      await inPool(
        batches(paths, this.options.batchSize),
        this.options.concurrency,
        (group) => this.runGroup(group, vocabulary, writer, written),
        // A lane that throws fails only what it had not counted yet; the
        // other lanes carry on, and the run still ends with its undo entry.
        (group) => {
          for (const path of group) if (!this.handled.has(path)) this.fail(path);
        }
      );
    } finally {
      this.deps.engine.cancelAll();
      this.running = false;
      this.deps.progress(null);
      if (written.length > 0) {
        writer.record(entry(`Describe ${plural(written.length, "clipping", "clippings")}`, written, writer));
      }
      await this.deps.save(this.pending);
      this.deps.notify(this.halted ?? this.summary(written.length));
    }
  }

  retryFailed(writer: DescribeWriter): Promise<void> {
    return this.describe([...this.failed], writer);
  }

  stop(): void {
    if (!this.running) return;
    this.stopped = true;
    this.deps.engine.cancelAll();
  }

  toggle(term: string): void {
    if (this.accepted.has(term)) this.accepted.delete(term);
    else this.accepted.add(term);
  }

  async apply(writer: DescribeWriter): Promise<void> {
    if (this.running) {
      this.deps.notify("Oriko: wait for describing to finish, then apply the review");
      return;
    }
    const paths = [...new Set(this.pending.terms.flatMap((t) => t.paths))];
    const skipped = paths.filter((path) => !this.deps.record(path)).length;
    const writes = resolveReview(
      this.pending,
      this.accepted,
      (path) => this.deps.record(path)?.categories ?? null
    );
    const kept = this.pending.terms.filter((t) => this.accepted.has(t.term)).length;
    const written: Written[] = [];
    const failed: string[] = [];
    for (const write of writes) {
      const record = this.deps.record(write.path);
      if (!record) continue;
      const after: FrontmatterWrite = { categories: write.categories };
      const before = snapshot(record, after);
      if (await writer.write(write.path, after)) written.push({ path: write.path, before, after });
      else failed.push(write.path);
    }

    // A write that failed keeps its suggestions, and their ticks, for the next review.
    this.pending = retainPending(this.pending, failed);
    const left = new Set(this.pending.terms.map((t) => t.term));
    this.accepted = new Set([...this.accepted].filter((term) => left.has(term)));
    await this.deps.save(this.pending);
    if (written.length > 0) {
      writer.record(entry(`Apply ${plural(kept, "suggested category", "suggested categories")}`, written, writer));
    }

    const parts = [`categories updated on ${plural(written.length, "clipping", "clippings")}`];
    if (skipped > 0) parts.push(`${skipped} skipped (renamed or deleted)`);
    if (failed.length > 0) parts.push(`${failed.length} failed (kept for the next review)`);
    this.deps.notify(`Oriko: ${parts.join(", ")}`);
  }

  private progress(): string {
    return `Oriko: describing ${this.done} of ${this.total}…`;
  }

  private summary(described: number): string {
    const parts = [`${described} described`];
    if (this.failed.length > 0) parts.push(`${this.failed.length} failed`);
    if (this.suggested.size > 0) {
      parts.push(`${plural(this.suggested.size, "category", "categories")} to review`);
    }
    return `Oriko: ${parts.join(", ")}${this.stopped && !this.halted ? " (stopped)" : ""}`;
  }

  private tick(path: string): void {
    this.handled.add(path);
    this.done++;
    this.deps.progress(this.progress());
  }

  private fail(path: string): void {
    this.failed.push(path);
    this.tick(path);
  }

  private halt(reason: Halt): void {
    this.halted ??= HALTS[reason];
    this.stopped = true;
    this.deps.engine.cancelAll();
  }

  private async jobsFor(paths: string[]): Promise<DescribeJob[]> {
    const jobs = await Promise.all(paths.map((path, id) => this.deps.prepare(path, id)));
    return jobs.filter((job): job is DescribeJob => job !== null);
  }

  /**
   * One engine call. A rate limit is waited out once; one that outlasts the
   * wait halts the run, as do a missing login, the usage limit, and a missing
   * Claude Code. Each of those would fail every clipping that follows.
   */
  private async runJobs(jobs: DescribeJob[], vocabulary: string[], timeoutMs: number): Promise<RunOutcome> {
    let outcome = await this.deps.engine.run(jobs, vocabulary, timeoutMs);
    if (!outcome.ok && outcome.failure === "rate-limit" && !this.stopped) {
      await this.deps.wait(this.options.rateLimitWaitMs);
      if (this.stopped) return outcome;
      outcome = await this.deps.engine.run(jobs, vocabulary, timeoutMs);
      if (!outcome.ok && outcome.failure === "rate-limit") this.halt("rate-limit");
    }
    if (
      !outcome.ok &&
      (outcome.failure === "not-logged-in" || outcome.failure === "usage-limit" || outcome.failure === "not-found")
    ) {
      this.halt(outcome.failure);
    }
    return outcome;
  }

  private async runGroup(
    paths: string[],
    vocabulary: string[],
    writer: DescribeWriter,
    written: Written[]
  ): Promise<void> {
    if (this.stopped) return;
    const before = this.pending;
    try {
      await this.describeGroup(paths, vocabulary, writer, written);
    } finally {
      // Saved as each batch finishes, so a force-quit mid-run cannot strand a
      // captioned clipping with no categories and no suggestion on record.
      if (this.pending !== before) await this.deps.save(this.pending);
    }
  }

  private async describeGroup(
    paths: string[],
    vocabulary: string[],
    writer: DescribeWriter,
    written: Written[]
  ): Promise<void> {
    const jobs = await this.jobsFor(paths);
    // A clipping deleted since the run began has nothing to describe.
    const found = new Set(jobs.map((job) => job.path));
    for (const path of paths) if (!found.has(path)) this.tick(path);
    if (jobs.length === 0 || this.stopped) return;

    const timeout = jobs.length > 1 ? this.options.batchTimeoutMs : this.options.singleTimeoutMs;
    const outcome = await this.runJobs(jobs, vocabulary, timeout);
    if (this.stopped) return;
    if (!outcome.ok) {
      await this.runSingly(jobs, vocabulary, writer, written);
      return;
    }
    const { matched, missing } = matchResults(jobs, outcome.results);
    for (const [job, raw] of matched) await this.accept(job.path, raw, vocabulary, writer, written);
    await this.runSingly(missing, vocabulary, writer, written);
  }

  /** Retries jobs one per call, so one bad clipping cannot fail its batch. */
  private async runSingly(
    jobs: DescribeJob[],
    vocabulary: string[],
    writer: DescribeWriter,
    written: Written[]
  ): Promise<void> {
    for (const job of jobs) {
      if (this.stopped) return;
      const outcome = await this.runJobs([{ ...job, id: 0 }], vocabulary, this.options.singleTimeoutMs);
      if (this.stopped) return;
      const raw = outcome.ok ? outcome.results.find((r) => r.caption.trim()) : undefined;
      if (raw) await this.accept(job.path, raw, vocabulary, writer, written);
      else this.fail(job.path);
    }
  }

  private async accept(
    path: string,
    raw: RawResult,
    vocabulary: string[],
    writer: DescribeWriter,
    written: Written[]
  ): Promise<void> {
    const record = this.deps.record(path);
    if (!record) {
      this.tick(path);
      return;
    }
    const described = validate(raw, path, vocabulary);
    const after = describedValues(record.categories, described);
    const before = snapshot(record, after);
    if (await writer.write(path, after)) {
      written.push({ path, before, after });
      const offered = suggestionsFor(record.categories, described);
      for (const proposal of offered.proposals) this.suggested.add(proposal.term);
      this.pending = addPending(this.pending, offered);
      this.tick(path);
    } else {
      this.fail(path);
    }
  }
}
