import { App, Notice, TFile, normalizePath } from "obsidian";
import type { MediaCache } from "./core/cache";
import type { DescribeJob, RawResult, RunOutcome } from "./core/claude-engine";
import type { DescribeContext } from "./core/commands";
import {
  BATCH_TIMEOUT_MS,
  CONCURRENCY,
  EMPTY_PENDING,
  SINGLE_TIMEOUT_MS,
  addPending,
  batches,
  bodyExcerpt,
  describedValues,
  inPool,
  matchResults,
  parsePending,
  resolveReview,
  snapshot,
  validate,
  wallVocabulary,
} from "./core/describe";
import type { PendingStore } from "./core/describe";
import type { FrontmatterWrite } from "./core/editable";
import type { HistoryEntry } from "./core/history";
import { domainOf, splitFrontmatter } from "./core/scan";
import type { ClippingRecord } from "./core/scan";
import type { Engine } from "./claude-engine";
import { mediaFor } from "./describe-media";

/**
 * Runs Describe: picks up the clippings, prepares their media, sends them in
 * batches, writes each answer as it arrives, and keeps the suggested
 * categories until they are reviewed.
 *
 * One per plugin. The view that starts a run or applies a review hands in its
 * writer, so every write goes through that view's one writer and lands in its
 * undo history.
 */

const STORE_FILE = "describe.json";
const RATE_LIMIT_WAIT_MS = 20000;
/** Media prepared at once inside a batch: a video is read whole into memory. */
const MEDIA_LANES = 3;

export interface DescribeWriter {
  write(path: string, values: FrontmatterWrite): Promise<boolean>;
  record(entry: HistoryEntry): void;
}

interface Written {
  path: string;
  before: FrontmatterWrite;
  after: FrontmatterWrite;
}

const HALTS = {
  "not-logged-in":
    "Oriko: Claude Code is not logged in. Run claude in a terminal, sign in with /login, then describe again.",
  "usage-limit": "Oriko: your Claude usage limit is reached. Describing stopped; what was described is kept.",
} as const;

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export class DescribeService {
  private running = false;
  private stopped = false;
  private halted: string | null = null;
  private done = 0;
  private total = 0;
  private failed: string[] = [];
  private pending: PendingStore = EMPTY_PENDING;
  private accepted = new Set<string>();
  private notice: Notice | null = null;

  constructor(
    private app: App,
    private engine: Engine,
    private cacheDir: string,
    private records: () => ClippingRecord[],
    private record: (path: string) => ClippingRecord | undefined,
    private cache: () => MediaCache
  ) {}

  private storePath(): string {
    return normalizePath(`${this.cacheDir}/${STORE_FILE}`);
  }

  async load(): Promise<void> {
    const path = this.storePath();
    if (!(await this.app.vault.adapter.exists(path))) return;
    try {
      this.pending = parsePending(JSON.parse(await this.app.vault.adapter.read(path)));
    } catch {
      this.pending = EMPTY_PENDING;
    }
  }

  private async save(): Promise<void> {
    await this.app.vault.adapter.write(this.storePath(), JSON.stringify(this.pending));
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
    const vocabulary = wallVocabulary(this.records());
    const written: Written[] = [];
    this.notice = new Notice(this.progress(), 0);

    try {
      await inPool(batches(paths), CONCURRENCY, (group) => this.runGroup(group, vocabulary, writer, written));
    } finally {
      this.engine.cancelAll();
      this.running = false;
      this.notice?.hide();
      this.notice = null;
    }

    if (written.length > 0) {
      writer.record(this.entry(`Describe ${plural(written.length, "clipping", "clippings")}`, written, writer));
    }
    await this.save();
    new Notice(this.halted ?? this.summary(written.length));
  }

  retryFailed(writer: DescribeWriter): Promise<void> {
    return this.describe([...this.failed], writer);
  }

  stop(): void {
    if (!this.running) return;
    this.stopped = true;
    this.engine.cancelAll();
  }

  toggle(term: string): void {
    if (this.accepted.has(term)) this.accepted.delete(term);
    else this.accepted.add(term);
  }

  async apply(writer: DescribeWriter): Promise<void> {
    const writes = resolveReview(this.pending, this.accepted, (path) => this.record(path)?.categories ?? null);
    const kept = this.pending.terms.filter((t) => this.accepted.has(t.term)).length;
    const written: Written[] = [];
    for (const write of writes) {
      const record = this.record(write.path);
      if (!record) continue;
      const after: FrontmatterWrite = { categories: write.categories };
      const before = snapshot(record, after);
      if (await writer.write(write.path, after)) written.push({ path: write.path, before, after });
    }
    this.pending = EMPTY_PENDING;
    this.accepted = new Set();
    await this.save();
    if (written.length > 0) {
      writer.record(
        this.entry(`Apply ${plural(kept, "suggested category", "suggested categories")}`, written, writer)
      );
    }
    new Notice(`Oriko: categories updated on ${plural(written.length, "clipping", "clippings")}`);
  }

  private progress(): string {
    return `Oriko: describing ${this.done} of ${this.total}…`;
  }

  private summary(described: number): string {
    const parts = [`${described} described`];
    if (this.failed.length > 0) parts.push(`${this.failed.length} failed`);
    if (this.pending.terms.length > 0) {
      parts.push(`${plural(this.pending.terms.length, "category", "categories")} to review`);
    }
    return `Oriko: ${parts.join(", ")}${this.stopped && !this.halted ? " (stopped)" : ""}`;
  }

  private entry(label: string, written: Written[], writer: DescribeWriter): HistoryEntry {
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

  private tick(): void {
    this.done++;
    this.notice?.setMessage(this.progress());
  }

  private fail(path: string): void {
    this.failed.push(path);
    this.tick();
  }

  private halt(failure: "not-logged-in" | "usage-limit"): void {
    this.halted = HALTS[failure];
    this.stopped = true;
    this.engine.cancelAll();
  }

  private async jobFor(path: string, id: number): Promise<DescribeJob | null> {
    const record = this.record(path);
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (!record || !(file instanceof TFile)) return null;
    const [image, text] = await Promise.all([
      mediaFor(this.app, record, this.cache()).catch(() => null),
      this.app.vault.cachedRead(file),
    ]);
    return {
      id,
      path,
      image,
      title: record.title,
      description: record.description,
      domain: domainOf(record.source),
      body: bodyExcerpt(splitFrontmatter(text).rest),
    };
  }

  private async jobsFor(paths: string[]): Promise<DescribeJob[]> {
    const jobs = new Array<DescribeJob | null>(paths.length).fill(null);
    await inPool(
      paths.map((path, id) => ({ path, id })),
      MEDIA_LANES,
      async ({ path, id }) => {
        jobs[id] = await this.jobFor(path, id);
      }
    );
    return jobs.filter((job): job is DescribeJob => job !== null);
  }

  /** One engine run, waiting out a rate limit once and halting the whole run on login or usage limits. */
  private async runJobs(jobs: DescribeJob[], vocabulary: string[], timeoutMs: number): Promise<RunOutcome> {
    let outcome = await this.engine.run(jobs, vocabulary, timeoutMs);
    if (!outcome.ok && outcome.failure === "rate-limit" && !this.stopped) {
      await new Promise((resolve) => window.setTimeout(resolve, RATE_LIMIT_WAIT_MS));
      if (!this.stopped) outcome = await this.engine.run(jobs, vocabulary, timeoutMs);
    }
    if (!outcome.ok && (outcome.failure === "not-logged-in" || outcome.failure === "usage-limit")) {
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
    const jobs = await this.jobsFor(paths);
    // A clipping deleted since the run began has nothing to describe.
    for (let i = jobs.length; i < paths.length; i++) this.tick();
    if (jobs.length === 0 || this.stopped) return;

    const outcome = await this.runJobs(jobs, vocabulary, jobs.length > 1 ? BATCH_TIMEOUT_MS : SINGLE_TIMEOUT_MS);
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
      const outcome = await this.runJobs([{ ...job, id: 0 }], vocabulary, SINGLE_TIMEOUT_MS);
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
    const record = this.record(path);
    if (!record) {
      this.tick();
      return;
    }
    const described = validate(raw, path, vocabulary);
    const after = describedValues(record.categories, described);
    const before = snapshot(record, after);
    if (await writer.write(path, after)) {
      written.push({ path, before, after });
      this.pending = addPending(this.pending, described);
      this.tick();
    } else {
      this.fail(path);
    }
  }
}
