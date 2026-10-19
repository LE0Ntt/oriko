import { App, normalizePath } from "obsidian";
import { RevisitSession, RevisitStore, pickRevisit } from "./core/revisit";
import type { RevisitMark } from "./core/revisit";
import type { RevisitView } from "./core/commands";

const STORE_FILE = "revisit.json";

/**
 * The Obsidian half of Revisit: the pass under way, held here so it survives
 * closing and reopening the palette, and revisit.json on this device, which
 * says when each clip was last shown so the next pass leads with others.
 * What a pass is and how it picks is core/revisit.ts.
 */
export class RevisitService {
  private store = new RevisitStore();
  private session: RevisitSession | null = null;

  constructor(
    private app: App,
    private cacheDir: string
  ) {}

  private path(): string {
    return normalizePath(`${this.cacheDir}/${STORE_FILE}`);
  }

  async load(): Promise<void> {
    const adapter = this.app.vault.adapter;
    const path = this.path();
    if (!(await adapter.exists(path))) return;
    try {
      this.store = RevisitStore.fromJSON(JSON.parse(await adapter.read(path)));
    } catch {
      // A damaged file only means every clip looks rested again.
      this.store = new RevisitStore();
    }
  }

  /** Starts a pass over these clips, unless one is already under way. */
  start(paths: readonly string[]): void {
    if (this.session) return;
    const clips = pickRevisit(paths, (path) => this.store.lastSeen(path), Date.now());
    if (clips.length === 0) return;
    this.session = new RevisitSession(clips);
    this.session.markShown();
  }

  view(): RevisitView | null {
    const session = this.session;
    const path = session?.current();
    if (!session || !path) return null;
    return {
      position: session.position,
      total: session.total,
      path,
      mark: session.markOf(path),
      counts: session.counts(),
      finished: session.finished,
    };
  }

  decide(mark: RevisitMark): void {
    this.session?.decide(mark);
  }

  step(delta: 1 | -1): void {
    this.session?.step(delta);
  }

  shown(): void {
    this.session?.markShown();
  }

  /** The clips marked to forget in the pass under way. */
  forgotten(): string[] {
    return this.session?.forgotten() ?? [];
  }

  /**
   * Ends the pass, noting what was shown so it rests before coming round
   * again. Resolves to how many clips were shown.
   */
  async end(exists: (path: string) => boolean): Promise<number> {
    const session = this.session;
    if (!session) return 0;
    this.session = null;
    const seen = session.seen();
    this.store.record(seen, Date.now());
    this.store.prune(exists);
    try {
      await this.app.vault.adapter.write(this.path(), JSON.stringify(this.store.toJSON()));
    } catch {
      // Not worth interrupting anyone over: the next pass may repeat a clip.
    }
    return seen.length;
  }
}
