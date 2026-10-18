import { isHttpUrl } from "./resolve";
import type { MediaRef } from "./scan";

/**
 * Describe for new clippings, as the last step of how each one is made.
 *
 * A clip captured on this device is handed over by capture itself once it is
 * done: capture saves the media before it writes the note, so there is
 * nothing left to wait for. A clip that arrives any other way (synced from a
 * phone, where Describe can't run, or written by the Web Clipper) waits until
 * it is complete here: every file its note embeds has arrived, and Oriko's
 * download of its media has finished. Nothing runs on a timer; each of those
 * events asks again.
 */

export interface AutoDescribeDeps {
  /** The setting is on and Describe is ready on this device. */
  enabled: () => boolean;
  /** The clip is complete on this device. */
  complete: (path: string) => boolean;
  /** Still on the wall with no categories and no caption, which another device may have written meanwhile. */
  needs: (path: string) => boolean;
  /** A Describe run is going. */
  busy: () => boolean;
  run: (paths: string[]) => Promise<void>;
}

/**
 * Whether a clip's note and media are all here: every file it embeds from the
 * vault has arrived, and no download is waiting to fetch the rest.
 */
export function clipComplete(media: readonly MediaRef[], here: (path: string) => boolean, downloading: boolean): boolean {
  if (downloading) return false;
  return media.every((ref) => isHttpUrl(ref.url) || here(ref.url));
}

export class AutoDescribe {
  /** Arrived by sync or the Web Clipper and not complete yet. */
  private waiting = new Set<string>();
  /** Complete, for the next run. */
  private queued = new Set<string>();
  /** Being made by capture here, which hands them over itself. */
  private claimed = new Set<string>();
  private running = false;

  constructor(private deps: AutoDescribeDeps) {}

  /** Capture on this device is about to write this clip and will hand it over when done. */
  claim(path: string): void {
    this.claimed.add(path);
  }

  /** Capture's last step: the clip is done, so it goes now, or right after the run already going. */
  captured(path: string): void {
    if (!this.deps.enabled()) return;
    this.queued.add(path);
    void this.pump();
  }

  /** A clip that was not on the wall a moment ago. */
  arrived(path: string): void {
    if (!this.deps.enabled() || this.claimed.has(path)) return;
    this.waiting.add(path);
    this.check();
  }

  /** A waiting clip that moves keeps its place under the new name. */
  renamed(oldPath: string, path: string): void {
    for (const set of [this.waiting, this.queued, this.claimed]) {
      if (set.delete(oldPath)) set.add(path);
    }
  }

  /** Something a waiting clip may need has happened: a file arrived, a download or a run ended. */
  check(): void {
    if (!this.deps.enabled()) {
      // Switched off while clips waited: they stay for Describe uncategorized.
      this.waiting.clear();
      this.queued.clear();
      return;
    }
    for (const path of this.waiting) {
      if (!this.deps.complete(path)) continue;
      this.waiting.delete(path);
      this.queued.add(path);
    }
    void this.pump();
  }

  /** Forgets every clip, as on unload. */
  clear(): void {
    this.waiting.clear();
    this.queued.clear();
    this.claimed.clear();
  }

  private async pump(): Promise<void> {
    // The run going now ends with a check, which picks these up.
    if (this.running || this.deps.busy()) return;
    const paths = [...this.queued].filter((path) => this.deps.needs(path));
    this.queued.clear();
    if (paths.length === 0) return;
    this.running = true;
    try {
      await this.deps.run(paths);
    } finally {
      this.running = false;
    }
    this.check();
  }
}
