import type { Swatch } from "./swatches";

/**
 * Each picture's palette, as this device worked it out. Kept in colors.json
 * beside cache.json and, like it, rebuildable and never authoritative:
 * deleting the file costs one quiet pass over the pictures again.
 *
 * Per device rather than in the notes, because a palette is a reading of a
 * file every device already has, and writing it into hundreds of notes would
 * be hundreds of edits to sync for something any device can see for itself.
 */

/**
 * Bumped whenever the palette itself would come out differently (the
 * sample size, the binning, how shares are counted), which makes every
 * stored reading due again. The words a palette answers to are worked out
 * at search time, so tuning those needs no bump.
 */
const VERSION = 1;

/** A share to three places is a tenth of a percent, finer than any threshold. */
const SHARE_PLACES = 1000;

interface Entry {
  /** The file's mtime when it was read, so a replaced file is read again. */
  mtime: number;
  palette: Swatch[];
}

interface StoredEntry {
  m: number;
  p: Array<[string, number]>;
}

interface Stored {
  version: number;
  entries: Record<string, StoredEntry>;
}

export class ColorStore {
  private entries = new Map<string, Entry>();

  /** The picture's palette, empty when it could not be read, undefined when never tried. */
  get(path: string): Swatch[] | undefined {
    return this.entries.get(path)?.palette;
  }

  isDue(path: string, mtime: number): boolean {
    const entry = this.entries.get(path);
    return !entry || entry.mtime !== mtime;
  }

  /** An empty palette records a picture that could not be read, so the next pass leaves it alone. */
  set(path: string, mtime: number, palette: Swatch[]): void {
    this.entries.set(path, { mtime, palette });
  }

  /** Drops every picture not in `keep`. True when anything went. */
  prune(keep: ReadonlySet<string>): boolean {
    let dropped = false;
    for (const path of [...this.entries.keys()]) {
      if (keep.has(path)) continue;
      this.entries.delete(path);
      dropped = true;
    }
    return dropped;
  }

  toJSON(): Stored {
    const entries: Record<string, StoredEntry> = {};
    for (const [path, entry] of this.entries) {
      entries[path] = {
        m: entry.mtime,
        p: entry.palette.map((swatch) => [
          swatch.hex,
          Math.round(swatch.share * SHARE_PLACES) / SHARE_PLACES,
        ]),
      };
    }
    return { version: VERSION, entries };
  }

  static fromJSON(raw: unknown): ColorStore {
    const store = new ColorStore();
    if (!raw || typeof raw !== "object") return store;
    const stored = raw as Partial<Stored>;
    if (stored.version !== VERSION || !stored.entries || typeof stored.entries !== "object") {
      return store;
    }

    for (const [path, entry] of Object.entries(stored.entries)) {
      if (!entry || typeof entry.m !== "number" || !Array.isArray(entry.p)) continue;
      const palette = entry.p
        .filter(
          (pair): pair is [string, number] =>
            Array.isArray(pair) && typeof pair[0] === "string" && typeof pair[1] === "number"
        )
        .map(([hex, share]) => ({ hex, share }));
      store.entries.set(path, { mtime: entry.m, palette });
    }
    return store;
  }
}
