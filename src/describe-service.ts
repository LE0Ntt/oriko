import { App, Notice, TFile, normalizePath } from "obsidian";
import type { MediaCache } from "./core/cache";
import type { DescribeJob } from "./core/claude-engine";
import type { DescribeContext } from "./core/commands";
import { bodyExcerpt, limiter, parsePending } from "./core/describe";
import type { PendingStore } from "./core/describe";
import { DescribeRunner } from "./core/describe-run";
import type { DescribeEngine, DescribeWriter, RunRequest } from "./core/describe-run";
import { domainOf, splitFrontmatter } from "./core/scan";
import type { ClippingRecord } from "./core/scan";
import { mediaFor } from "./describe-media";

export type { DescribeWriter } from "./core/describe-run";

/**
 * Describe's Obsidian half: the media and note text for each job, the
 * progress notice, and describe.json, where waiting suggestions are kept.
 * Every decision about a run is in core/describe-run.ts.
 */

const STORE_FILE = "describe.json";
/** Media prepared at once across a whole run: a video is read whole into memory. */
const MEDIA_LANES = 3;

export class DescribeService {
  private runner: DescribeRunner;
  private notice: Notice | null = null;
  private prepareMedia = limiter(MEDIA_LANES);

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
      progress: (text) => this.progress(text),
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

  private progress(text: string | null): void {
    if (text === null) {
      this.notice?.hide();
      this.notice = null;
    } else if (this.notice) {
      this.notice.setMessage(text);
    } else {
      this.notice = new Notice(text, 0);
    }
  }

  private async jobFor(path: string, id: number): Promise<DescribeJob | null> {
    const record = this.record(path);
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (!record || !(file instanceof TFile)) return null;
    const [image, text] = await Promise.all([
      this.prepareMedia(() => mediaFor(this.app, record, this.cache())).catch(() => null),
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

  describe(paths: string[], writer: DescribeWriter, request: RunRequest = {}): Promise<void> {
    return this.runner.describe(paths, writer, request);
  }

  retryFailed(writer: DescribeWriter): Promise<void> {
    return this.runner.retryFailed(writer);
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

  apply(writer: DescribeWriter): Promise<void> {
    return this.runner.apply(writer);
  }
}
