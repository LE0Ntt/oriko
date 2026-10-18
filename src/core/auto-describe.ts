/**
 * Describe for clippings that arrive while Oriko is open, from a clip or the
 * Web Clipper. The backlog is never touched: only what lands after the wall
 * has loaded comes through here, so switching this on starts nothing.
 *
 * A clip is described once it is done. One Oriko made is done on arrival,
 * since Oriko saves the media before it writes the note. One from the Web
 * Clipper is done when the clipper has stopped writing the note, which it
 * does in passes, and Oriko has downloaded its picture or video. So the run
 * waits for a short quiet spell, restarted by every arrival and by every write
 * to a waiting clip, and then for any download queued or going. The quiet
 * spell also gathers a burst of clips into one run.
 */

export interface AutoDescribeDeps {
  /** The setting is on and Describe is ready on this device. */
  enabled: () => boolean;
  /** A Describe run or a media download is going or queued, so the clips wait their turn. */
  busy: () => boolean;
  /** Still on the wall with no categories and no caption, which another device may have written meanwhile. */
  needs: (path: string) => boolean;
  run: (paths: string[]) => void;
  setTimer: (fn: () => void, ms: number) => number;
  clearTimer: (id: number) => void;
}

/** How long the waiting clips go unwritten before they count as done. */
export const AUTO_QUIET_MS = 2_000;
/** How often to look again while a run or a download is going. */
export const AUTO_RETRY_MS = 1_000;

export class AutoDescribe {
  private waiting = new Set<string>();
  private timer: number | null = null;

  constructor(private deps: AutoDescribeDeps) {}

  arrived(path: string): void {
    if (!this.deps.enabled()) return;
    this.waiting.add(path);
    this.schedule(AUTO_QUIET_MS);
  }

  /** A waiting clip was written to: it isn't done yet. */
  touched(path: string): void {
    if (this.waiting.has(path)) this.schedule(AUTO_QUIET_MS);
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
