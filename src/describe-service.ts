import { App, Notice, TFile, normalizePath } from "obsidian";
import type { MediaCache } from "./core/cache";
import type { DescribeJob } from "./core/claude-engine";
import type { DescribeContext } from "./core/commands";
import { bodyExcerpt, limiter, parsePending } from "./core/describe";
import type { PendingStore } from "./core/describe";
import { DescribeRunner } from "./core/describe-run";
import type { DescribeEngine, DescribeWriter, RunRequest } from "./core/describe-run";
import { describeLook, summaryText } from "./core/describing";
import type { ClipStatus, RunSummary } from "./core/describing";
import { domainOf, splitFrontmatter } from "./core/scan";
import type { ClippingRecord } from "./core/scan";
import { mediaFor } from "./describe-media";

export type { DescribeWriter } from "./core/describe-run";

/**
 * Describe's Obsidian half: the media and note text for each job, the walls
 * watching a run, and describe.json, where waiting suggestions are kept.
 * Every decision about a run is in core/describe-run.ts.
 */

/** An open wall, which shows a run on its tiles and in its bottom bar. */
export interface DescribeWatcher {
  status(path: string, status: ClipStatus): void;
  progress(state: { done: number; total: number } | null): void;
  finished(summary: RunSummary): void;
}

const STORE_FILE = "describe.json";
/** Media prepared at once across a whole run: a video is read whole into memory. */
const MEDIA_LANES = 3;

export class DescribeService {
  private runner: DescribeRunner;
  /** The fallback for a run with no wall open to show it. */
  private notice: Notice | null = null;
  private prepareMedia = limiter(MEDIA_LANES);
  private watchers = new Set<DescribeWatcher>();
  /** Clips mid-step and the count, so a wall opened during a run catches up. */
  private live = new Map<string, ClipStatus>();
  private state: { done: number; total: number } | null = null;

  constructor(
    private app: App,
    engine: DescribeEngine,
    private cacheDir: string,
    records: () => ClippingRecord[],
    private record: (path: string) => ClippingRecord | undefined,
    private cache: () => MediaCache
  ) {
    this.runner = new DescribeRunner({
      engine,
      prepare: (path, id) => this.jobFor(path, id),
      record,
      records,
      save: (store) => this.save(store),
      wait: (ms) => new Promise((resolve) => window.setTimeout(resolve, ms)),
      progress: (state) => this.progress(state),
      status: (path, status) => this.status(path, status),
      finished: (summary) => this.finished(summary),
      notify: (text) => new Notice(text),
    });
  }

  private storePath(): string {
    return normalizePath(`${this.cacheDir}/${STORE_FILE}`);
  }

  async load(): Promise<void> {
    const path = this.storePath();
    if (!(await this.app.vault.adapter.exists(path))) return;
    try {
      this.runner.setPending(parsePending(JSON.parse(await this.app.vault.adapter.read(path))));
    } catch {
      // A damaged file is a review lost, never a plugin that will not load.
    }
  }

  private async save(store: PendingStore): Promise<void> {
    await this.app.vault.adapter.write(this.storePath(), JSON.stringify(store));
  }

  /** Shows a run on a wall until it is closed; returns the way to stop watching. */
  watch(watcher: DescribeWatcher): () => void {
    this.watchers.add(watcher);
    this.notice?.hide();
    this.notice = null;
    if (this.state) watcher.progress(this.state);
    for (const [path, status] of this.live) watcher.status(path, status);
    return () => {
      this.watchers.delete(watcher);
    };
  }

  private progress(state: { done: number; total: number } | null): void {
    this.state = state;
    for (const watcher of this.watchers) watcher.progress(state);
    const text = state && this.watchers.size === 0 ? `Oriko: describing ${state.done} of ${state.total}…` : null;
    if (text === null) {
      this.notice?.hide();
      this.notice = null;
    } else if (this.notice) {
      this.notice.setMessage(text);
    } else {
      this.notice = new Notice(text, 0);
    }
  }

  private status(path: string, status: ClipStatus): void {
    if (describeLook(status, "image")?.busy) this.live.set(path, status);
    else this.live.delete(path);
    for (const watcher of this.watchers) watcher.status(path, status);
  }

  private finished(summary: RunSummary): void {
    if (this.watchers.size === 0) new Notice(`Oriko: ${summaryText(summary)}`);
    for (const watcher of this.watchers) watcher.finished(summary);
  }

  private async jobFor(path: string, id: number): Promise<DescribeJob | null> {
    const record = this.record(path);
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (!record || !(file instanceof TFile)) return null;
    const [image, text] = await Promise.all([
      // Marked when its turn comes, not when it joins the queue for one.
      this.prepareMedia(() => {
        this.status(path, { step: "preparing" });
        return mediaFor(this.app, record, this.cache());
      }).catch(() => null),
      this.app.vault.cachedRead(file).catch(() => ""),
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

  context(uncategorized: string[]): DescribeContext {
    return this.runner.context(uncategorized);
  }

  /** A run is going. */
  get busy(): boolean {
    return this.runner.busy;
  }

  /** Told whenever a run ends, whoever started it. */
  onIdle: (() => void) | null = null;

  describe(paths: string[], writer: DescribeWriter, request: RunRequest = {}): Promise<void> {
    return this.runner.describe(paths, writer, request).finally(() => this.onIdle?.());
  }

  retryFailed(writer: DescribeWriter): Promise<void> {
    return this.runner.retryFailed(writer).finally(() => this.onIdle?.());
  }

  stop(): void {
    this.runner.stop();
  }

  toggle(path: string, term: string): void {
    this.runner.toggle(path, term);
  }

  step(delta: 1 | -1): void {
    this.runner.step(delta);
  }

  shown(): void {
    this.runner.shown();
  }

  discardClip(writer: DescribeWriter): Promise<void> {
    return this.runner.discardClip(writer);
  }

  discardAll(writer: DescribeWriter): Promise<void> {
    return this.runner.discardAll(writer);
  }

  apply(writer: DescribeWriter): Promise<void> {
    return this.runner.apply(writer);
  }
}
