/**
 * Revisit: a short pass over clips picked at random from the wall, one at a
 * time, keeping or forgetting each. mymind calls theirs Serendipity. Nothing
 * is forgotten until the pass is finished, so a clip marked by mistake can be
 * stepped back to and kept. Pure, so the picking and the walk are tested.
 */

/** About two minutes of clips. A pass with no end would feel like work. */
export const REVISIT_SIZE = 20;

/** A clip shown within this long waits before it comes round again. */
export const REVISIT_REST_MS = 30 * 24 * 60 * 60 * 1000;

export type RevisitMark = "keep" | "forget";

/** What Forget does once the pass is finished. */
export type RevisitForget = "trash" | "archive";

export function isRevisitForget(value: unknown): value is RevisitForget {
  return value === "trash" || value === "archive";
}

/** When each clip was last shown in a Revisit, on this device. */
export class RevisitStore {
  private seen = new Map<string, number>();

  static fromJSON(raw: unknown): RevisitStore {
    const store = new RevisitStore();
    const seen = (raw as { seen?: unknown } | null)?.seen;
    if (seen && typeof seen === "object") {
      for (const [path, at] of Object.entries(seen as Record<string, unknown>)) {
        if (typeof at === "number" && Number.isFinite(at)) store.seen.set(path, at);
      }
    }
    return store;
  }

  toJSON(): { seen: Record<string, number> } {
    return { seen: Object.fromEntries(this.seen) };
  }

  lastSeen(path: string): number | undefined {
    return this.seen.get(path);
  }

  record(paths: readonly string[], at: number): void {
    for (const path of paths) this.seen.set(path, at);
  }

  /** Forgets clips that no longer exist, so the file does not grow with every deletion. */
  prune(exists: (path: string) => boolean): void {
    for (const path of [...this.seen.keys()]) if (!exists(path)) this.seen.delete(path);
  }
}

/**
 * The clips for one pass: at random from those not shown in the last month,
 * topped up with the ones shown longest ago when there are too few of them.
 */
export function pickRevisit(
  paths: readonly string[],
  lastSeen: (path: string) => number | undefined,
  now: number,
  random: () => number = Math.random,
  size = REVISIT_SIZE
): string[] {
  const shuffled = [...new Set(paths)];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const rested = (path: string): boolean => {
    const at = lastSeen(path);
    return at === undefined || now - at >= REVISIT_REST_MS;
  };
  const fresh = shuffled.filter(rested);
  if (fresh.length >= size) return fresh.slice(0, size);
  const recent = shuffled
    .filter((path) => !rested(path))
    .sort((a, b) => (lastSeen(a) ?? 0) - (lastSeen(b) ?? 0));
  return [...fresh, ...recent].slice(0, size);
}

export class RevisitSession {
  readonly clips: string[];
  private index = 0;
  private marks = new Map<string, RevisitMark>();
  private shown = new Set<string>();

  constructor(clips: readonly string[]) {
    this.clips = [...clips];
  }

  get position(): number {
    return this.clips.length > 0 ? this.index + 1 : 0;
  }

  get total(): number {
    return this.clips.length;
  }

  current(): string | null {
    return this.clips[this.index] ?? null;
  }

  /** The clip on show has been seen, so it rests before coming round again. */
  markShown(): void {
    const path = this.current();
    if (path) this.shown.add(path);
  }

  /** Every clip that has been on show. */
  seen(): string[] {
    return this.clips.filter((path) => this.shown.has(path));
  }

  step(delta: 1 | -1): void {
    if (this.clips.length === 0) return;
    this.index = Math.min(this.clips.length - 1, Math.max(0, this.index + delta));
    this.markShown();
  }

  /** Marks the clip on show and moves on. The last clip stays on show, so its mark can be seen. */
  decide(mark: RevisitMark): void {
    const path = this.current();
    if (!path) return;
    this.marks.set(path, mark);
    this.markShown();
    this.step(1);
  }

  markOf(path: string): RevisitMark | null {
    return this.marks.get(path) ?? null;
  }

  /** Every clip has been kept or forgotten. */
  get finished(): boolean {
    return this.clips.length > 0 && this.clips.every((path) => this.marks.has(path));
  }

  /** Clips marked to forget, in the order they were shown. */
  forgotten(): string[] {
    return this.clips.filter((path) => this.marks.get(path) === "forget");
  }

  counts(): { kept: number; forgotten: number } {
    let kept = 0;
    let forgotten = 0;
    for (const mark of this.marks.values()) {
      if (mark === "keep") kept++;
      else forgotten++;
    }
    return { kept, forgotten };
  }
}
