/**
 * Describe for clippings that arrive while Oriko is open, from a clip or the
 * Web Clipper. The backlog is never touched: only what lands after the wall
 * has loaded comes through here, so switching this on starts nothing.
 *
 * Arrivals settle first. The Web Clipper writes a note in stages and a reel's
 * video downloads after its note exists, so a clip described the moment it
 * lands would go without its picture. Each arrival restarts the wait, which
 * also gathers a burst of clips into one run.
 */

export interface AutoDescribeDeps {
  /** The setting is on and Describe is ready on this device. */
  enabled: () => boolean;
  /** A Describe run or a media download is going, so the clips wait their turn. */
  busy: () => boolean;
  /** Still on the wall with no categories and no caption, which another device may have written meanwhile. */
  needs: (path: string) => boolean;
  run: (paths: string[]) => void;
  setTimer: (fn: () => void, ms: number) => number;
  clearTimer: (id: number) => void;
}

/** How long the last arrival has to sit before the run starts. */
export const AUTO_SETTLE_MS = 15_000;
/** How long to wait again while something else is running. */
export const AUTO_RETRY_MS = 5_000;

export class AutoDescribe {
  private waiting = new Set<string>();
  private timer: number | null = null;

  constructor(private deps: AutoDescribeDeps) {}

  arrived(path: string): void {
    if (!this.deps.enabled()) return;
    this.waiting.add(path);
    this.schedule(AUTO_SETTLE_MS);
  }

  /** A waiting clip that moves keeps its place under the new name. */
  renamed(oldPath: string, path: string): void {
    if (this.waiting.delete(oldPath)) this.waiting.add(path);
  }

  /** Stops waiting and forgets every clip, as on unload. */
  clear(): void {
    if (this.timer !== null) this.deps.clearTimer(this.timer);
    this.timer = null;
    this.waiting.clear();
  }

  private schedule(ms: number): void {
    if (this.timer !== null) this.deps.clearTimer(this.timer);
    this.timer = this.deps.setTimer(() => this.flush(), ms);
  }

  private flush(): void {
    this.timer = null;
    // Switched off while the clips waited: they stay for Describe uncategorized.
    if (!this.deps.enabled()) {
      this.waiting.clear();
      return;
    }
    if (this.deps.busy()) {
      this.schedule(AUTO_RETRY_MS);
      return;
    }
    const paths = [...this.waiting].filter((path) => this.deps.needs(path));
    this.waiting.clear();
    if (paths.length > 0) this.deps.run(paths);
  }
}
