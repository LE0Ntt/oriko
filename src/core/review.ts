import type { Proposal } from "./claude-engine";
import { retainPending } from "./describe";
import type { PendingStore, ReviewWrite } from "./describe";

/**
 * The review, clip by clip: which clip is on show, which of its suggested
 * labels are ticked, and which clips have been seen. Apply writes only clips
 * that have been seen; the rest keep waiting. Pure, so the whole walk is
 * tested; the runner holds one and rebuilds it when a run adds suggestions.
 */

export interface ReviewClip {
  path: string;
  terms: Proposal[];
}

/** Each clip waiting for review once, with its suggestions, in first-suggested order. */
export function reviewClips(store: PendingStore): ReviewClip[] {
  const clips = new Map<string, Proposal[]>();
  for (const t of store.terms) {
    for (const path of t.paths) {
      let terms = clips.get(path);
      if (!terms) {
        terms = [];
        clips.set(path, terms);
      }
      terms.push({ term: t.term, definition: t.definition });
    }
  }
  return [...clips.entries()].map(([path, terms]) => ({ path, terms }));
}

const pair = (path: string, term: string): string => `${path}\u0000${term}`;

export class ReviewSession {
  readonly clips: ReviewClip[];
  private index = 0;
  private ticks = new Set<string>();
  private reviewed = new Set<string>();

  /** Built from the store; `previous` carries its ticks, reviewed marks and place onto clips still waiting. */
  constructor(store: PendingStore, previous?: ReviewSession) {
    this.clips = reviewClips(store);
    if (!previous) return;
    for (const clip of this.clips) {
      if (previous.reviewed.has(clip.path)) this.reviewed.add(clip.path);
      for (const t of clip.terms) {
        if (previous.ticks.has(pair(clip.path, t.term))) this.ticks.add(pair(clip.path, t.term));
      }
    }
    const at = previous.current()?.path;
    const found = at ? this.clips.findIndex((clip) => clip.path === at) : -1;
    this.index = found >= 0 ? found : 0;
  }

  get position(): number {
    return this.clips.length > 0 ? this.index + 1 : 0;
  }

  get total(): number {
    return this.clips.length;
  }

  current(): ReviewClip | null {
    return this.clips[this.index] ?? null;
  }

  /** The clip on show has been seen, so apply may write it. */
  markShown(): void {
    const clip = this.current();
    if (clip) this.reviewed.add(clip.path);
  }

  step(delta: 1 | -1): void {
    if (this.clips.length === 0) return;
    this.index = Math.min(this.clips.length - 1, Math.max(0, this.index + delta));
  }

  toggle(path: string, term: string): void {
    const key = pair(path, term);
    if (this.ticks.has(key)) this.ticks.delete(key);
    else this.ticks.add(key);
  }

  isTicked(path: string, term: string): boolean {
    return this.ticks.has(pair(path, term));
  }

  ticked(path: string): string[] {
    const clip = this.clips.find((c) => c.path === path);
    return clip ? clip.terms.filter((t) => this.isTicked(path, t.term)).map((t) => t.term) : [];
  }

  /** Ticked labels on seen clips, and how many clips have been seen. */
  counts(): { labels: number; clips: number } {
    const seen = this.clips.filter((clip) => this.reviewed.has(clip.path));
    return { labels: seen.reduce((n, clip) => n + this.ticked(clip.path).length, 0), clips: seen.length };
  }

  /**
   * What apply writes: each seen clip's ticked labels added to its
   * categories, and a seen clip with nothing ticked and no categories gets
   * its fallback. `current` answers null for a clip that is gone.
   */
  writes(
    store: PendingStore,
    current: (path: string) => readonly string[] | null
  ): { writes: ReviewWrite[]; skipped: number } {
    const writes: ReviewWrite[] = [];
    let skipped = 0;
    for (const clip of this.clips) {
      if (!this.reviewed.has(clip.path)) continue;
      const now = current(clip.path);
      if (now === null) {
        skipped++;
        continue;
      }
      const next = [...now];
      for (const term of this.ticked(clip.path)) if (!next.includes(term)) next.push(term);
      const fallback = store.fallbacks[clip.path];
      if (next.length === 0 && fallback) next.push(fallback);
      if (next.length !== now.length) writes.push({ path: clip.path, categories: next });
    }
    return { writes, skipped };
  }

  /** The store left after apply: clips never seen, and seen ones whose write failed. */
  remaining(store: PendingStore, failed: readonly string[]): PendingStore {
    const waiting = this.clips.filter((clip) => !this.reviewed.has(clip.path)).map((clip) => clip.path);
    return retainPending(store, [...waiting, ...failed]);
  }
}
