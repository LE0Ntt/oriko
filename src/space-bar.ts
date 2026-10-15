import { setIcon } from "obsidian";
import type { GridSpace } from "./core/spaces";
import { attachTip } from "./core/tip";

/** Space left between a control and the menu it launches. */
const LAUNCH_GAP = 10;
/** How long a finished run's line stays before the pill goes. */
const FINISH_HOLD_MS = 3200;
/** Its fade, matching the transition in styles.css. */
const LEAVE_MS = 260;
/** The progress ring's radius, in the 20 by 20 box it is drawn in. */
const RING_R = 8;
const RING_LENGTH = 2 * Math.PI * RING_R;
/** The least of the ring drawn, so it shows the run has started before anything lands. */
const RING_MIN = 0.1;

export interface SpaceBarHandlers {
  /** Open the grid list, anchored at the given point. */
  onSwitcher: (x: number, y: number) => void;
  /** Open the create menu, anchored at the given point. */
  onCreate: (x: number, y: number) => void;
  /** Open the settings menu for the grid on screen, anchored at a point. */
  onSettings: (x: number, y: number) => void;
  /** Open the filter menu, anchored at a point. */
  onFilter: (x: number, y: number) => void;
  /** Leave the open folder and show the grid whole again. */
  onBack: () => void;
  /** The Describe pill was clicked: open the palette, where Stop and Review are. */
  onDescribe: () => void;
}

/**
 * The floating controls that sit over the wall: a gear bottom left for
 * managing grids, and bottom right the grid switcher and the create button.
 *
 * Kept separate from the selection action bar even though both float at the
 * bottom. That one appears only while something is selected and speaks about
 * the selection; these are always present and speak about the grid itself.
 */
export class SpaceBar {
  private root: HTMLElement;
  private manage: HTMLElement;
  private filter: HTMLElement;
  private filterCount: HTMLElement;
  private shownCount = -1;
  private switcher: HTMLElement;
  /** Where a menu about grids opens from when nothing was clicked. */
  switcherAnchor: () => { x: number; y: number } = () => ({ x: 0, y: 0 });
  private icon: HTMLElement;
  private label: HTMLElement;
  private back: HTMLElement;
  private grid: GridSpace | null = null;
  private folder: string | null = null;
  private describe: HTMLElement;
  private describeRing: SVGCircleElement;
  private describeIcon: HTMLElement;
  private describeText: HTMLElement;
  private describeTimer = 0;

  constructor(container: HTMLElement, handlers: SpaceBarHandlers) {
    this.root = container.createDiv({ cls: "pg-spacebar" });

    // Left cluster: what you are looking at. Right cluster: which wall it is,
    // and adding to it.
    const left = this.root.createDiv({ cls: "pg-space-left" });

    this.filter = left.createEl("button", { cls: "pg-space-filter" });
    setIcon(this.filter, "list-filter");
    attachTip(this.filter, "Filter");
    this.filterCount = this.filter.createDiv({ cls: "pg-space-count" });
    this.filter.onclick = (event: MouseEvent) => {
      event.stopPropagation();
      const rect = this.filter.getBoundingClientRect();
      handlers.onFilter(rect.left, rect.top - LAUNCH_GAP);
    };

    this.manage = left.createEl("button", { cls: "pg-space-manage" });
    setIcon(this.manage, "sliders-horizontal");
    attachTip(this.manage, "Grid settings");
    this.manage.onclick = (event: MouseEvent) => {
      event.stopPropagation();
      // Left edge, so the flip in placeMenu leaves it opening rightward and
      // upward out of the button, mirroring the two on the other side.
      const rect = this.manage.getBoundingClientRect();
      handlers.onSettings(rect.left, rect.top - LAUNCH_GAP);
    };

    // The way out of a folder: the detail view's back button, in the same
    // corner, so leaving a folder feels like leaving a clipping. On the
    // container rather than in the bar, since the bar sits at the bottom.
    this.back = container.createEl("button", { cls: "pg-detail-back pg-folder-back" });
    setIcon(this.back, "arrow-left");
    attachTip(this.back, "Back", "\u238b");
    this.back.onclick = (event: MouseEvent) => {
      event.stopPropagation();
      handlers.onBack();
    };

    const right = this.root.createDiv({ cls: "pg-space-right" });

    // A Describe run, while there is one: a ring filling as clips land and
    // the count beside it, then the run's closing line with a check.
    this.describe = right.createEl("button", { cls: "pg-space-describe is-hidden" });
    attachTip(this.describe, "Describe");
    const ring = this.describe.createSvg("svg", {
      cls: "pg-describe-ring",
      attr: { viewBox: "0 0 20 20", width: "20", height: "20" },
    });
    ring.createSvg("circle", { cls: "pg-describe-track", attr: { cx: "10", cy: "10", r: String(RING_R) } });
    this.describeRing = ring.createSvg("circle", {
      cls: "pg-describe-fill",
      attr: {
        cx: "10",
        cy: "10",
        r: String(RING_R),
        "stroke-dasharray": String(RING_LENGTH),
        "stroke-dashoffset": String(RING_LENGTH),
      },
    });
    this.describeIcon = this.describe.createSpan({ cls: "pg-describe-done" });
    this.describeText = this.describe.createSpan({ cls: "pg-describe-count" });
    this.describe.onclick = (event: MouseEvent) => {
      event.stopPropagation();
      handlers.onDescribe();
    };

    this.switcher = right.createEl("button", { cls: "pg-space-switch" });
    attachTip(this.switcher, "Switch grid");
    this.icon = this.switcher.createDiv({ cls: "pg-space-icon" });
    this.label = this.switcher.createDiv({ cls: "pg-space-label" });
    const chevron = this.switcher.createDiv({ cls: "pg-space-chevron" });
    setIcon(chevron, "chevron-up");
    this.switcher.onclick = (event: MouseEvent) => {
      event.stopPropagation();
      // Anchored to the button, not the pointer, so the menu lands in the same
      // place however the button was reached. The right edge is passed rather
      // than the left: placeMenu flips a menu that would overflow, and against
      // the right of the pane that flip is what lines the menu's right edge up
      // with the button's, so it opens leftward and upward out of it.
      const rect = this.switcher.getBoundingClientRect();
      handlers.onSwitcher(rect.right, rect.top - LAUNCH_GAP);
    };

    this.switcherAnchor = () => {
      const rect = this.switcher.getBoundingClientRect();
      return { x: rect.right, y: rect.top - LAUNCH_GAP };
    };

    const create = right.createEl("button", { cls: "pg-space-create" });
    setIcon(create, "plus");
    attachTip(create, "New");
    create.onclick = (event: MouseEvent) => {
      event.stopPropagation();
      const rect = create.getBoundingClientRect();
      handlers.onCreate(rect.right, rect.top - LAUNCH_GAP);
    };
  }

  /** Reflects whichever grid is on screen. */
  /**
   * Stands the bar down while a selection is up.
   *
   * Only ever asked for on a phone. The selection bar is centred and this
   * one runs the full width beneath it, which on a desktop pane leaves room
   * either side of centre and at 390px does not: the selection bar lands on
   * the grid switcher. One bar at a time is also how Photos and Files put
   * it, and it suits a mode that a long press enters and a tap on empty
   * space leaves.
   */
  setHidden(hidden: boolean): void {
    this.root.toggleClass("is-hidden", hidden);
  }

  setActive(grid: GridSpace): void {
    this.grid = grid;
    this.paintLabel();
  }

  /** The folder open on the wall, or null for the grid whole. */
  setFolder(name: string | null): void {
    this.folder = name;
    this.back.toggleClass("is-open", name !== null);
    this.root.toggleClass("is-in-folder", name !== null);
    this.paintLabel();
  }

  /** The switcher reads as a path while a folder is open: grid, then folder. */
  private paintLabel(): void {
    if (!this.grid) return;
    setIcon(this.icon, this.grid.icon);
    this.label.setText(this.folder ? `${this.grid.name} \u203a ${this.folder}` : this.grid.name);
  }

  /**
   * A filter hides things, so it has to say so from the outside. Without a
   * count on the button, a filtered wall is indistinguishable from an empty
   * grid, and the only clue is a menu you have to open to read.
   */
  setFilterCount(count: number): void {
    // Guarded: this runs on every repaint, including each one the archiver
    // triggers, and almost none of them change the number.
    if (count === this.shownCount) return;
    this.shownCount = count;
    this.filterCount.setText(count > 0 ? String(count) : "");
    this.filter.toggleClass("is-active", count > 0);
  }

  /** A run's progress, or null once it is over. */
  setDescribeProgress(state: { done: number; total: number } | null): void {
    window.clearTimeout(this.describeTimer);
    if (!state) {
      this.describe.addClass("is-hidden");
      return;
    }
    const fraction = Math.max(RING_MIN, state.total > 0 ? state.done / state.total : 0);
    this.describeRing.setAttribute("stroke-dashoffset", String(RING_LENGTH * (1 - fraction)));
    this.describeText.setText(`Describing ${state.done} of ${state.total}`);
    this.describe.removeClass("is-hidden", "is-finished", "is-leaving");
  }

  /** The run's closing line, with a check that draws itself, held a moment and then gone. */
  finishDescribe(text: string): void {
    window.clearTimeout(this.describeTimer);
    this.describeIcon.empty();
    setIcon(this.describeIcon, "check");
    this.describeText.setText(text);
    this.describe.removeClass("is-hidden", "is-leaving");
    this.describe.addClass("is-finished");
    this.describeTimer = window.setTimeout(() => {
      this.describe.addClass("is-leaving");
      this.describeTimer = window.setTimeout(() => {
        this.describe.addClass("is-hidden");
        this.describe.removeClass("is-leaving", "is-finished");
      }, LEAVE_MS);
    }, FINISH_HOLD_MS);
  }

  destroy(): void {
    window.clearTimeout(this.describeTimer);
    this.back.remove();
    this.root.remove();
  }
}
