import type { Depth, Proposal, RawResult } from "./claude-engine";
import type { FrontmatterWrite } from "./editable";
import type { ClippingRecord } from "./scan";

/**
 * Describe's decisions, all of them pure: which clippings to send, in what
 * groups, what to keep from an answer, what to write, and what a review
 * writes. The process, the media and the writes themselves are in
 * src/describe-service.ts and src/describe-media.ts.
 */

export const BATCH_SIZE = 10;
export const CONCURRENCY = 6;
export const BATCH_TIMEOUT_MS = 120000;
export const SINGLE_TIMEOUT_MS = 60000;
export const MAX_CATEGORIES = 4;
/** How many labels a clipping may carry after a run at each depth. */
export const DEPTH_CAPS: Record<Depth, number> = { broad: 2, standard: MAX_CATEGORIES, specific: 6 };
export const CAPTION_LIMIT = 300;
export const MEDIA_TEXT_LIMIT = 1000;
export const BODY_LIMIT = 1500;
export const DEFINITION_LIMIT = 200;
/** The long edge an image is sent at, and the width of a video's frame grid. */
export const MEDIA_EDGE = 1024;
/** Where a video's four frames are taken, as fractions of its length. */
export const FRAME_FRACTIONS = [0.1, 0.38, 0.64, 0.88];

/** A caption is the mark of a described clipping, whether or not its categories wait on a review. */
export function isDescribed(record: ClippingRecord): boolean {
  return (record.properties.caption ?? []).some((value) => value.trim().length > 0);
}

export function needsDescribing(records: readonly ClippingRecord[]): ClippingRecord[] {
  return records.filter((record) => record.categories.length === 0 && !isDescribed(record));
}

export function batches<T>(items: readonly T[], size = BATCH_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Runs work over items with at most `limit` going at once. An item that
 * throws is reported to `onError` and its lane moves on, so one failure never
 * ends the pool while the other lanes are still working.
 */
export async function inPool<T>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<void>,
  onError: (item: T, error: unknown) => void = () => undefined
): Promise<void> {
  let next = 0;
  const lane = async (): Promise<void> => {
    while (next < items.length) {
      const item = items[next++];
      try {
        await work(item);
      } catch (error) {
        onError(item, error);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}

/**
 * A shared cap on concurrent work: every call to the returned function waits
 * for a free slot. One limiter spans a whole run, so separate lanes share it.
 */
export function limiter(limit: number): <T>(work: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: Array<() => void> = [];
  const next = (): void => {
    if (active >= limit) return;
    const start = waiting.shift();
    if (!start) return;
    active++;
    start();
  };
  return <T>(work: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      waiting.push(() => {
        work()
          .then(resolve, reject)
          .finally(() => {
            active--;
            next();
          });
      });
      next();
    });
}

const EMBED = /!\[\[[^\]]*\]\]|!\[[^\]]*\]\([^)]*\)/g;
const HTML_MEDIA = /<\/?(?:img|video|source|iframe)\b[^>]*>/gi;

/** The note body as plain words, embeds removed, cut to length. */
export function bodyExcerpt(body: string, limit = BODY_LIMIT): string {
  const plain = body.replace(EMBED, " ").replace(HTML_MEDIA, " ").replace(/\s+/g, " ").trim();
  return plain.length > limit ? plain.slice(0, limit) : plain;
}

/** Every category on the wall, most used first, which is the order Claude reads them in. */
export function wallVocabulary(records: readonly ClippingRecord[]): string[] {
  const counts = new Map<string, number>();
  for (const record of records) {
    for (const category of record.categories) {
      const term = category.trim();
      if (term) counts.set(term, (counts.get(term) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([term]) => term);
}

export function kebab(term: string): string {
  return term
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^\p{L}\p{N}-]/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Below this length a trailing s is too likely to be its own word: new and news, io and ios. */
const PLURAL_STEM = 4;

function sameTerm(a: string, b: string): boolean {
  const x = kebab(a);
  const y = kebab(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (short.length < PLURAL_STEM) return false;
  return long === `${short}s` || long === `${short}es`;
}

/** The wall's own spelling of a term, ignoring case, a plural ending, and spaces versus hyphens. */
export function matchVocabulary(term: string, vocabulary: readonly string[]): string | null {
  return vocabulary.find((known) => sameTerm(known, term)) ?? null;
}

/** One clipping's answer after Oriko has checked it. */
export interface Described {
  path: string;
  categories: string[];
  proposals: Proposal[];
  fallback: string | null;
  caption: string;
  mediaText: string;
}

function cut(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit - 1).trimEnd()}…` : value;
}

export function validate(
  raw: RawResult,
  path: string,
  vocabulary: readonly string[],
  depth: Depth = "standard"
): Described {
  const cap = DEPTH_CAPS[depth];
  const categories: string[] = [];
  const add = (term: string | null): void => {
    if (term && !categories.includes(term) && categories.length < cap) categories.push(term);
  };
  for (const category of raw.categories) add(matchVocabulary(category, vocabulary));

  const proposals: Proposal[] = [];
  for (const proposal of raw.proposals) {
    const existing = matchVocabulary(proposal.term, vocabulary);
    if (existing) {
      add(existing);
      continue;
    }
    const term = kebab(proposal.term);
    if (term && !proposals.some((p) => p.term === term)) {
      proposals.push({ term, definition: cut(proposal.definition.trim(), DEFINITION_LIMIT) });
    }
  }

  return {
    path,
    categories,
    proposals,
    fallback: matchVocabulary(raw.fallback, vocabulary),
    caption: cut(raw.caption.replace(/\s+/g, " ").trim(), CAPTION_LIMIT),
    mediaText: cut(
      raw.media_text.replace(/\s*\n+\s*/g, " / ").replace(/[ \t]+/g, " ").trim(),
      MEDIA_TEXT_LIMIT
    ),
  };
}

/**
 * Pairs a batch's answers with its jobs. A job whose answer is missing, or
 * whose caption is empty, goes back for a retry on its own: nothing is
 * written without a caption, because a caption is what marks it described.
 */
export function matchResults<T extends { id: number }>(
  jobs: readonly T[],
  results: readonly RawResult[]
): { matched: Array<[T, RawResult]>; missing: T[] } {
  const byId = new Map<number, RawResult>();
  for (const result of results) if (!byId.has(result.id)) byId.set(result.id, result);
  const matched: Array<[T, RawResult]> = [];
  const missing: T[] = [];
  for (const job of jobs) {
    const result = byId.get(job.id);
    if (result && result.caption.trim()) matched.push([job, result]);
    else missing.push(job);
  }
  return { matched, missing };
}

export interface WriteMode {
  /** Add to a clipping's labels, for a selection re-run. Without it, categories go only to a clipping that has none. */
  add?: boolean;
  /** The most labels a clipping may end up with; existing ones are kept even past it. */
  cap?: number;
}

/** What one described clipping gets written. Labels are only ever added, never removed. */
export function describedValues(
  existing: readonly string[],
  described: Described,
  mode: WriteMode = {}
): FrontmatterWrite {
  const values: FrontmatterWrite = { caption: described.caption, media_text: described.mediaText };
  if (!mode.add) {
    if (existing.length === 0 && described.categories.length > 0) values.categories = described.categories;
    return values;
  }
  const cap = mode.cap ?? MAX_CATEGORIES;
  const next = [...existing];
  for (const term of described.categories) {
    if (next.length >= cap) break;
    if (!next.includes(term)) next.push(term);
  }
  if (next.length > existing.length) values.categories = next;
  return values;
}

/** The values a write replaces, shaped like the write, so writing it back undoes it. */
export function snapshot(record: ClippingRecord, write: FrontmatterWrite): FrontmatterWrite {
  const out: FrontmatterWrite = {};
  for (const [key, value] of Object.entries(write)) {
    const held = record.properties[key] ?? [];
    out[key] = Array.isArray(value) ? [...held] : held.join(" ");
  }
  return out;
}

export interface PendingTerm {
  term: string;
  definition: string;
  paths: string[];
}

export interface PendingStore {
  terms: PendingTerm[];
  /** The closest existing category per clipping, used when none of its suggestions is kept. */
  fallbacks: Record<string, string>;
}

export const EMPTY_PENDING: PendingStore = { terms: [], fallbacks: {} };

/**
 * The suggestions a described clipping contributes to the review. A clipping
 * with no categories always gets them. One already filed gets them only when
 * the user selected it for this run, and only while it has room under the
 * run's cap.
 */
export function suggestionsFor(
  existing: readonly string[],
  described: Described,
  options: { selected?: boolean; cap?: number } = {}
): Described {
  const cap = options.cap ?? MAX_CATEGORIES;
  const keep = existing.length === 0 || (options.selected === true && existing.length < cap);
  return keep ? described : { ...described, proposals: [], fallback: null };
}

/** What the palette shows above the depth choice: one clipping by name, or a count. */
export function subjectSummary(
  paths: readonly string[],
  record: (path: string) => ClippingRecord | undefined
): { count: number; labelled: number; title?: string; labels?: string[] } {
  const found = paths.map(record).filter((r): r is ClippingRecord => r !== undefined);
  const labelled = found.filter((r) => r.categories.length > 0).length;
  if (found.length === 1) {
    return { count: 1, labelled, title: found[0].title, labels: [...found[0].categories] };
  }
  return { count: found.length, labelled };
}

export function addPending(store: PendingStore, described: Described): PendingStore {
  if (described.proposals.length === 0) return store;
  const terms = store.terms.map((t) => ({ ...t, paths: [...t.paths] }));
  for (const proposal of described.proposals) {
    const found = terms.find((t) => t.term === proposal.term);
    if (found) {
      if (!found.paths.includes(described.path)) found.paths.push(described.path);
    } else {
      terms.push({ term: proposal.term, definition: proposal.definition, paths: [described.path] });
    }
  }
  const fallbacks = { ...store.fallbacks };
  if (described.fallback) fallbacks[described.path] = described.fallback;
  return { terms, fallbacks };
}

/** Reads describe.json, keeping only what has the right shape. */
export function parsePending(value: unknown): PendingStore {
  if (!value || typeof value !== "object") return EMPTY_PENDING;
  const v = value as { terms?: unknown; fallbacks?: unknown };
  const terms: PendingTerm[] = Array.isArray(v.terms)
    ? v.terms.flatMap((t) => {
        if (!t || typeof t !== "object") return [];
        const x = t as { term?: unknown; definition?: unknown; paths?: unknown };
        if (typeof x.term !== "string" || !x.term) return [];
        const paths = Array.isArray(x.paths)
          ? x.paths.filter((p): p is string => typeof p === "string")
          : [];
        return [{ term: x.term, definition: typeof x.definition === "string" ? x.definition : "", paths }];
      })
    : [];
  const fallbacks: Record<string, string> = {};
  if (v.fallbacks && typeof v.fallbacks === "object") {
    for (const [path, term] of Object.entries(v.fallbacks as Record<string, unknown>)) {
      if (typeof term === "string") fallbacks[path] = term;
    }
  }
  return { terms, fallbacks };
}

/** The store cut down to the given clippings, for writes that failed and should be reviewed again. */
export function retainPending(store: PendingStore, paths: readonly string[]): PendingStore {
  const keep = new Set(paths);
  const terms = store.terms
    .map((t) => ({ ...t, paths: t.paths.filter((p) => keep.has(p)) }))
    .filter((t) => t.paths.length > 0);
  const fallbacks: Record<string, string> = {};
  for (const [path, term] of Object.entries(store.fallbacks)) if (keep.has(path)) fallbacks[path] = term;
  return { terms, fallbacks };
}

/**
 * Discarding never adds a suggested label, but a clip left with no labels at
 * all gets its closest existing one, so nothing ends up blank.
 */
export function fallbackWrites(
  store: PendingStore,
  paths: readonly string[],
  current: (path: string) => readonly string[] | null
): ReviewWrite[] {
  const writes: ReviewWrite[] = [];
  for (const path of paths) {
    const now = current(path);
    const fallback = store.fallbacks[path];
    if (now !== null && now.length === 0 && fallback) writes.push({ path, categories: [fallback] });
  }
  return writes;
}

export interface ReviewWrite {
  path: string;
  categories: string[];
}

/**
 * What applying a review writes. Accepted terms are added to every clipping
 * they were suggested for; a clipping left with no categories gets its
 * fallback. `current` answers null for a clipping that is gone.
 */
export function resolveReview(
  store: PendingStore,
  accepted: ReadonlySet<string>,
  current: (path: string) => readonly string[] | null
): ReviewWrite[] {
  const paths = [...new Set(store.terms.flatMap((t) => t.paths))];
  const writes: ReviewWrite[] = [];
  for (const path of paths) {
    const now = current(path);
    if (now === null) continue;
    const next = [...now];
    for (const t of store.terms) {
      if (accepted.has(t.term) && t.paths.includes(path) && !next.includes(t.term)) next.push(t.term);
    }
    const fallback = store.fallbacks[path];
    if (next.length === 0 && fallback) next.push(fallback);
    if (next.length !== now.length) writes.push({ path, categories: next });
  }
  return writes;
}

export function fitWithin(
  width: number,
  height: number,
  edge = MEDIA_EDGE
): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: edge, height: edge };
  const scale = Math.min(1, edge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * One quadrant of a video's 2x2 frame grid: the video's own shape, fitted
 * inside a square half the grid's width. A portrait video once made a
 * 1024 x 1820 grid, and encoding it held the main thread for over 100 ms.
 */
export function gridCell(videoWidth: number, videoHeight: number): { width: number; height: number } {
  return fitWithin(videoWidth, videoHeight, MEDIA_EDGE / 2);
}
