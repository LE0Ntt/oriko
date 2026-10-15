import type { FrontmatterWrite } from "./editable";

/**
 * How a clip being described looks on the wall, decided away from the DOM.
 *
 * The tile keeps its own picture and wears the clip-in-progress card's pill:
 * the step's icon and its words, which shimmer while work goes on. Each step
 * is one the run really reaches, so the pill never cycles through steps on a
 * timer to look busy. A clip lands with the check that draws itself, and the
 * labels it gained pop on beside it before the pill fades.
 */

export type ClipStatus =
  | { step: "preparing" }
  | { step: "describing" }
  | { step: "labelled"; added: string[]; review: number }
  | { step: "failed" }
  | { step: "cleared" };

export interface DescribeLook {
  icon: string;
  label: string;
  /** Work still going: the words shimmer. */
  busy: boolean;
  /** A light sweeps across the tile, while Claude has it. */
  sweep: boolean;
  /** Labels popped on beside the pill as it lands. */
  labels: string[];
  /** How long a landed pill stays before it fades, or 0 while work goes on. */
  holdMs: number;
}

const LANDED_MS = 1800;
/** A clip with suggestions waiting, or one that failed, is worth a longer look. */
const NOTICE_MS = 3200;

export function describeLook(status: ClipStatus, kind: string): DescribeLook | null {
  const look = (icon: string, label: string, over: Partial<DescribeLook> = {}): DescribeLook => ({
    icon,
    label,
    busy: false,
    sweep: false,
    labels: [],
    holdMs: 0,
    ...over,
  });
  switch (status.step) {
    case "preparing":
      return kind === "video"
        ? look("film", "Picking frames", { busy: true })
        : look("image", "Reading picture", { busy: true });
    case "describing":
      return look("sparkles", "Describing", { busy: true, sweep: true });
    case "labelled":
      if (status.review > 0) {
        return look("list-checks", `${status.review} to review`, { labels: status.added, holdMs: NOTICE_MS });
      }
      return look("check", status.added.length > 0 ? "Labelled" : "Described", {
        labels: status.added,
        holdMs: LANDED_MS,
      });
    case "failed":
      return look("alert-triangle", "Couldn't describe", { holdMs: NOTICE_MS });
    case "cleared":
      return null;
  }
}

/** The categories a write adds to the ones a clipping had, in the write's order. */
export function addedLabels(before: readonly string[], write: FrontmatterWrite): string[] {
  const after = write.categories;
  if (!Array.isArray(after)) return [];
  const had = new Set(before);
  return after.filter((term) => !had.has(term));
}

export interface RunSummary {
  described: number;
  failed: number;
  /** Distinct new terms the run suggested. */
  suggested: number;
  stopped: boolean;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The run's closing line, as the wall's progress pill and a notice both say it. */
export function summaryText(summary: RunSummary): string {
  const parts = [`${summary.described} described`];
  if (summary.failed > 0) parts.push(`${summary.failed} failed`);
  if (summary.suggested > 0) parts.push(`${plural(summary.suggested, "category", "categories")} to review`);
  return `${parts.join(", ")}${summary.stopped ? " (stopped)" : ""}`;
}
