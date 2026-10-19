import { describe, expect, it } from "vitest";
import { DESCRIBE_DEPTHS, buildCommands, facetValueCommands, offersDescribe } from "../src/core/commands";
import type { DescribeContext, PaletteContext, ReviewView, RevisitContext, RevisitView } from "../src/core/commands";
import { emptyFilter, facetDefs } from "../src/core/filter";
import { searchPalette } from "../src/core/palette-results";

const DEFS = facetDefs(["categories", "status"]);

const noop = (): void => {};

const actions = {
  openNote: noop,
  exportSelection: noop,
  reveal: noop,
  move: noop,
  remove: noop,
  switchGrid: noop,
  newGrid: noop,
  moveToFolder: noop,
  newFolder: noop,
  openFolder: noop,
  undo: noop,
  redo: noop,
  editGrid: noop,
  deleteGrid: noop,
  manageGrids: noop,
  toggleFacet: noop,
  clearFilters: noop,
  clip: noop,
  archiveAll: noop,
  selectAll: noop,
  resetZoom: noop,
  describeUncategorized: noop,
  describeSelected: noop,
  stopDescribing: noop,
  retryDescribeFailed: noop,
  toggleSuggestion: noop,
  applySuggestions: noop,
  stepReview: noop,
  reviewShown: noop,
  discardClip: noop,
  discardAll: noop,
  showHint: noop,
  startRevisit: noop,
  decideRevisit: noop,
  stepRevisit: noop,
  revisitShown: noop,
  finishRevisit: noop,
};

function context(over: Partial<PaletteContext> = {}): PaletteContext {
  return {
    selection: [],
    grids: [
      { name: "Clippings", icon: "layout-grid" },
      { name: "Demo", icon: "star" },
    ],
    activeGrid: "Clippings",
    homeGrid: "Clippings",
    folders: [],
    canFile: true,
    undoLabel: null,
    redoLabel: null,
    facetDefs: DEFS,
    facets: { categories: [], status: [], kind: [], domain: [] },
    filter: emptyFilter(),
    hasSystem: true,
    canExport: true,
    describe: null,
    actions,
    ...over,
  };
}

const ids = (ctx: PaletteContext): string[] => buildCommands(ctx).map((c) => c.id);

const find = (ctx: PaletteContext, id: string) =>
  buildCommands(ctx).find((c) => c.id === id);

describe("buildCommands", () => {
  it("offers no selection actions while nothing is selected", () => {
    expect(ids(context())).not.toContain("selection:delete");
  });

  it("offers the selection actions once something is selected", () => {
    const list = ids(context({ selection: ["a.md"] }));
    expect(list).toContain("selection:open-note");
    expect(list).toContain("selection:export");
    expect(list).toContain("selection:reveal");
    expect(list).toContain("selection:delete");
  });

  it("says how many clippings an action will act on", () => {
    expect(find(context({ selection: ["a.md", "b.md", "c.md"] }), "selection:delete")?.detail).toBe(
      "3 selected"
    );
  });

  it("drops Reveal in Finder for a multiple selection, which reveals one file", () => {
    expect(ids(context({ selection: ["a.md", "b.md"] }))).not.toContain("selection:reveal");
  });

  it("drops Export where there is nowhere at all to put a copy", () => {
    const list = ids(context({ selection: ["a.md"], hasSystem: false, canExport: false }));
    expect(list).not.toContain("selection:export");
  });

  it("keeps saving a copy on a phone, which has a share sheet but no Downloads", () => {
    const ctx = context({ selection: ["a.md"], hasSystem: false, canExport: true });
    expect(ids(ctx)).toContain("selection:export");
    expect(find(ctx, "selection:export")?.label).toBe("Save to device");
  });

  it("offers a tab in place of Finder where there is no file manager", () => {
    const ctx = context({ selection: ["a.md"], hasSystem: false, canExport: true });
    expect(ids(ctx)).toContain("selection:reveal");
    expect(find(ctx, "selection:reveal")?.label).toBe("Open file");
  });

  it("marks deletion destructive", () => {
    expect(find(context({ selection: ["a.md"] }), "selection:delete")?.destructive).toBe(true);
  });

  it("offers every grid but the one you are in as a move target", () => {
    const move = find(context({ selection: ["a.md"] }), "selection:move");
    expect(move?.stage?.items().map((item) => item.label)).toEqual(["Demo"]);
  });

  it("drops the move action when there is nowhere else to move to", () => {
    const only = context({ selection: ["a.md"], grids: [{ name: "Clippings", icon: "layout-grid" }] });
    expect(ids(only)).not.toContain("selection:move");
  });

  it("offers every grid but the one you are in as a switch target", () => {
    expect(ids(context())).toContain("grid:switch:Demo");
    expect(ids(context())).not.toContain("grid:switch:Clippings");
  });

  it("hints the grid's own hotkey, counting from the home grid", () => {
    expect(find(context(), "grid:switch:Demo")?.detail).toBe("⌘2");
  });

  it("will not offer to delete the home grid, which everything falls back to", () => {
    expect(ids(context())).not.toContain("grid:delete");
  });

  it("offers to delete a grid that is not home", () => {
    expect(ids(context({ activeGrid: "Demo" }))).toContain("grid:delete");
  });

  it("offers a filter command only for facets that have values", () => {
    const ctx = context({
      facets: {
        categories: [{ value: "design", count: 2 }],
        status: [],
        kind: [],
        domain: [],
      },
    });
    const list = ids(ctx);
    expect(list).toContain("filter:categories");
    expect(list).not.toContain("filter:status");
  });

  it("lists a facet's values with their counts, and keeps the palette open", () => {
    const ctx = context({
      facets: {
        categories: [
          { value: "design", count: 2 },
          { value: "ios", count: 1 },
        ],
        status: [],
        kind: [],
        domain: [],
      },
    });
    const values = find(ctx, "filter:categories")?.stage?.items() ?? [];
    expect(values.map((v) => [v.label, v.detail])).toEqual([
      ["design", "2"],
      ["ios", "1"],
    ]);
    expect(values.every((v) => v.keepOpen)).toBe(true);
  });

  it("reads an empty value as Is empty in the facet stage, as the menu does", () => {
    const ctx = context({
      facets: {
        categories: [
          { value: "design", count: 2 },
          { value: "", count: 13 },
        ],
        status: [],
        kind: [],
        domain: [],
      },
    });
    const values = find(ctx, "filter:categories")?.stage?.items() ?? [];
    expect(values.map((v) => v.label)).toEqual(["design", "Is empty"]);
    expect(values.map((v) => v.divider ?? false)).toEqual([false, true]);
  });

  it("marks the facet values already filtering the wall, in the count's slot", () => {
    const ctx = context({
      facets: {
        categories: [
          { value: "design", count: 2 },
          { value: "ios", count: 1 },
        ],
        status: [],
        kind: [],
        domain: [],
      },
      filter: { ...emptyFilter(), categories: ["ios"] },
    });
    const values = find(ctx, "filter:categories")?.stage?.items() ?? [];
    expect(values.map((v) => v.detailIcon)).toEqual([undefined, "check"]);
  });

  it("leaves every facet value without a left icon, so the gutter goes", () => {
    const ctx = context({
      facets: {
        categories: [
          { value: "design", count: 2 },
          { value: "ios", count: 1 },
        ],
        status: [],
        kind: [],
        domain: [],
      },
      filter: { ...emptyFilter(), categories: ["ios"] },
    });
    const values = find(ctx, "filter:categories")?.stage?.items() ?? [];
    expect(values.map((v) => v.icon)).toEqual(["", ""]);
  });

  it("keeps the count on a value that is not chosen", () => {
    const ctx = context({
      facets: {
        categories: [{ value: "design", count: 2 }],
        status: [],
        kind: [],
        domain: [],
      },
    });
    const values = find(ctx, "filter:categories")?.stage?.items() ?? [];
    expect(values[0]).toMatchObject({ detail: "2", detailIcon: undefined });
  });

  it("offers to clear filters only while something is filtered", () => {
    expect(ids(context())).not.toContain("filter:clear");
    expect(
      ids(context({ filter: { ...emptyFilter(), categories: ["design"] } }))
    ).toContain("filter:clear");
  });

  it("always offers the capture commands", () => {
    const list = ids(context());
    expect(list).toContain("capture:clip");
    expect(list).toContain("capture:archive-all");
    expect(find(context(), "capture:archive-all")?.label).toBe("Archive media");
  });

  it("files each row under the section it belongs to", () => {
    const ctx = context({
      selection: ["a.md"],
      undoLabel: "Move",
      redoLabel: "Move",
      describe: describing({ uncategorized: ["b.md"], failed: 1 }),
    });
    const sections = new Map(buildCommands(ctx).map((c) => [c.id, c.section]));
    expect(sections.get("selection:open-note")).toBe("Selection");
    expect(sections.get("selection:delete")).toBe("Selection");
    expect(sections.get("describe:selected")).toBe("Selection");
    expect(sections.get("describe:uncategorized")).toBe("Describe");
    expect(sections.get("describe:retry")).toBe("Describe");
    expect(sections.get("grid:new")).toBe("Grids");
    expect(sections.get("history:undo")).toBe("Edit");
    expect(sections.get("history:redo")).toBe("Edit");
    expect(sections.get("view:select-all")).toBe("Edit");
    expect(sections.get("view:reset-zoom")).toBe("Edit");
    expect(sections.get("capture:clip")).toBe("Capture");
    expect(sections.get("capture:archive-all")).toBe("Capture");
  });

  it("offers Describe among the selection's actions, ahead of Delete", () => {
    const list = ids(context({ selection: ["a.md"], describe: describing() }));
    expect(list.indexOf("describe:selected")).toBeGreaterThan(list.indexOf("selection:folder"));
    expect(list.indexOf("describe:selected")).toBeLessThan(list.indexOf("selection:delete"));
  });

  it("gives every command a unique id", () => {
    const list = ids(context({ selection: ["a.md"] }));
    expect(new Set(list).size).toBe(list.length);
  });

  it("runs the action it was built with", () => {
    let moved: [string[], string] | null = null;
    const ctx = context({
      selection: ["a.md"],
      actions: { ...actions, move: (paths: string[], grid: string) => (moved = [paths, grid]) },
    });
    find(ctx, "selection:move")?.stage?.items()[0].run?.();
    expect(moved).toEqual([["a.md"], "Demo"]);
  });
});

describe("folder commands", () => {
  const KITCHEN = { name: "Kitchen", icon: "folder", grid: "Clippings", width: 1 as const };

  it("offers the active grid's folders as places to move a selection", () => {
    const ctx = context({ selection: ["a.md"], folders: [KITCHEN] });
    const stage = find(ctx, "selection:folder")?.stage?.items() ?? [];
    expect(stage.map((c) => c.id)).toEqual(["selection:folder:Kitchen", "selection:folder:new"]);
  });

  it("still offers New folder when the grid has none yet", () => {
    const ctx = context({ selection: ["a.md"] });
    const stage = find(ctx, "selection:folder")?.stage?.items() ?? [];
    expect(stage.map((c) => c.id)).toEqual(["selection:folder:new"]);
  });

  it("moves the selection into the chosen folder", () => {
    let moved: [string[], string] | null = null;
    const ctx = context({
      selection: ["a.md"],
      folders: [KITCHEN],
      actions: { ...actions, moveToFolder: (paths, folder) => (moved = [paths, folder]) },
    });
    find(ctx, "selection:folder")?.stage?.items()[0].run?.();
    expect(moved).toEqual([["a.md"], "Kitchen"]);
  });

  it("hands the selection to New folder so it lands inside on save", () => {
    let seeded: string[] | null = null;
    const ctx = context({
      selection: ["a.md"],
      actions: { ...actions, newFolder: (paths) => (seeded = paths) },
    });
    find(ctx, "selection:folder")?.stage?.items()[0].run?.();
    expect(seeded).toEqual(["a.md"]);
  });

  it("offers New folder beside New grid and opens each folder", () => {
    const list = ids(context({ folders: [KITCHEN] }));
    expect(list).toContain("folder:new");
    expect(list).toContain("folder:open:Kitchen");
  });

  it("offers nothing folder-shaped on a grid that cannot be filed into", () => {
    const list = ids(context({ selection: ["a.md"], canFile: false }));
    expect(list).not.toContain("selection:folder");
    expect(list).not.toContain("folder:new");
  });
});

describe("history commands", () => {
  it("offers nothing while there is nothing to undo or redo", () => {
    const list = ids(context());
    expect(list).not.toContain("history:undo");
    expect(list).not.toContain("history:redo");
  });

  it("names the action it would undo", () => {
    const ctx = context({ undoLabel: "Move to Kitchen" });
    expect(find(ctx, "history:undo")?.label).toBe("Undo Move to Kitchen");
    expect(find(ctx, "history:undo")?.detail).toBe("⌘Z");
  });

  it("names the action it would redo", () => {
    const ctx = context({ redoLabel: "Edit status" });
    expect(find(ctx, "history:redo")?.label).toBe("Redo Edit status");
    expect(find(ctx, "history:redo")?.detail).toBe("⌘⇧Z");
  });

  it("runs undo and redo", () => {
    const ran: string[] = [];
    const ctx = context({
      undoLabel: "A",
      redoLabel: "B",
      actions: { ...actions, undo: () => ran.push("undo"), redo: () => ran.push("redo") },
    });
    find(ctx, "history:undo")?.run?.();
    find(ctx, "history:redo")?.run?.();
    expect(ran).toEqual(["undo", "redo"]);
  });
});

describe("filters over user-defined properties", () => {
  it("offers a user-defined property as a filter", () => {
    const ctx = context({
      facetDefs: facetDefs(["medium"]),
      facets: { medium: [{ value: "photo", count: 3 }], kind: [], domain: [] },
    });
    expect(buildCommands(ctx).map((c) => c.id)).toContain("filter:medium");
  });

  it("labels a property facet from its key", () => {
    const ctx = context({
      facetDefs: facetDefs(["publish_date"]),
      facets: { publish_date: [{ value: "2026", count: 2 }], kind: [], domain: [] },
    });
    expect(find(ctx, "filter:publish_date")?.label).toBe("Filter by publish date");
  });
});

describe("facetValueCommands", () => {
  const populated = (over: Partial<PaletteContext> = {}): PaletteContext =>
    context({
      facets: {
        categories: [
          { value: "ios", count: 12 },
          { value: "design", count: 31 },
        ],
        status: [{ value: "unread", count: 4 }],
        kind: [],
        domain: [],
      },
      ...over,
    });

  const values = (ctx: PaletteContext) => facetValueCommands(ctx);

  it("offers one row per value, named by the facet it belongs to", () => {
    expect(values(populated()).map((c) => c.label)).toEqual([
      "Categories: ios",
      "Categories: design",
      "Status: unread",
    ]);
  });

  it("searches on the value alone, so the facet name cannot match every row", () => {
    expect(values(populated()).map((c) => c.matchOn)).toEqual(["ios", "design", "unread"]);
  });

  it("carries the same id as the row inside the stage, being the same action", () => {
    const ctx = populated();
    const staged = buildCommands(ctx).find((c) => c.id === "filter:categories")?.stage?.items();
    expect(values(ctx)[0].id).toBe(staged?.[0].id);
  });

  it("counts a value that is not chosen", () => {
    expect(values(populated())[0]).toMatchObject({ detail: "12", detailIcon: undefined });
  });

  it("ticks a value that is already filtered", () => {
    const ctx = populated({ filter: { ...emptyFilter(), categories: ["ios"] } });
    expect(values(ctx)[0].detailIcon).toBe("check");
  });

  it("stays open after a pick, so several values can be toggled", () => {
    expect(values(populated())[0].keepOpen).toBe(true);
  });

  it("toggles the facet it was built from", () => {
    let toggled: [string, string] | null = null;
    const ctx = populated({
      actions: { ...actions, toggleFacet: (id: string, value: string) => (toggled = [id, value]) },
    });
    values(ctx)[0].run?.();
    expect(toggled).toEqual(["categories", "ios"]);
  });

  it("reads a date bucket back as words, in the label and in what it matches", () => {
    const ctx = context({
      facetDefs: [
        { id: "created", label: "Created", icon: "calendar", keywords: "", source: "property", key: "created", shape: "date", now: 0 },
      ],
      facets: { created: [{ value: "empty", count: 3 }] },
    });
    expect(values(ctx)[0]).toMatchObject({ label: "Created: Is empty", matchOn: "Is empty" });
  });

  it("offers nothing for a facet the wall carries no values for", () => {
    expect(values(context())).toEqual([]);
  });
});

describe("colour rows", () => {
  const colored = (over: Partial<PaletteContext> = {}): PaletteContext =>
    context({
      facetDefs: facetDefs([]),
      facets: {
        color: [
          { value: "red", count: 5 },
          { value: "maroon", count: 3 },
        ],
        kind: [],
        domain: [],
      },
      countColor: (value) => (value === "#800000" ? 4 : 0),
      ...over,
    });
  const options = { limit: 0, activeGrid: "Clippings", homeGrid: "Clippings", registered: new Set<string>() };
  const stage = (ctx: PaletteContext) => buildCommands(ctx).find((c) => c.id === "filter:color")?.stage;

  it("paints each colour value with a dot of its colour", () => {
    const row = facetValueCommands(colored()).find((c) => c.label === "Color: maroon");
    expect(row?.swatch).toBe("#800000");
  });

  it("finds a colour by its other names", () => {
    const groups = searchPalette("burgundy", [], facetValueCommands(colored()), [], options);
    expect(groups.flatMap((g) => g.rows).map((r) => r.label)).toContain("Color: maroon");
  });

  it("carries the dot through to the palette's row", () => {
    const groups = searchPalette("maroon", [], facetValueCommands(colored()), [], options);
    expect(groups[0].rows[0].swatch).toBe("#800000");
  });

  it("offers a typed hex code as a colour to filter by", () => {
    let toggled: [string, string] | null = null;
    const ctx = colored({
      actions: { ...actions, toggleFacet: (id: string, value: string) => (toggled = [id, value]) },
    });
    const row = facetValueCommands(ctx, "800000").find((c) => c.label === "Color: #800000");
    expect(row).toMatchObject({ swatch: "#800000", detail: "4" });
    row?.run?.();
    expect(toggled).toEqual(["color", "#800000"]);
  });

  it("finds the hex row when the code is typed without its #", () => {
    const groups = searchPalette("800000", [], facetValueCommands(colored(), "800000"), [], options);
    expect(groups.flatMap((g) => g.rows).map((r) => r.label)).toContain("Color: #800000");
  });

  it("offers no hex row for a query that is not a hex code", () => {
    expect(facetValueCommands(colored(), "maroon").some((c) => c.label.includes("#"))).toBe(false);
  });

  it("paints the stage's rows with dots, and offers a typed hex code there too", () => {
    const items = stage(colored())?.items("#800000") ?? [];
    expect(items.find((c) => c.label === "maroon")?.swatch).toBe("#800000");
    expect(items.some((c) => c.label === "#800000")).toBe(true);
  });

  it("keeps a chosen hex code in the stage, so it can be switched off", () => {
    const items = stage(colored({ filter: { color: ["#123456"] } }))?.items("") ?? [];
    expect(items.find((c) => c.label === "#123456")?.detailIcon).toBe("check");
  });
});

const paths = (n: number): string[] => Array.from({ length: n }, (_, i) => `c${i}.md`);

const describing = (over: Partial<DescribeContext> = {}): DescribeContext => ({
  running: false,
  done: 0,
  total: 0,
  uncategorized: [],
  failed: 0,
  review: null,
  ...over,
});

describe("describe commands", () => {
  it("offers nothing when Describe is unavailable", () => {
    expect(buildCommands(context()).some((c) => c.id.startsWith("describe:"))).toBe(false);
  });

  it("offers the uncategorized run with its count, and hides it at zero", () => {
    const row = find(context({ describe: describing({ uncategorized: paths(180) }) }), "describe:uncategorized");
    expect(row?.label).toBe("Describe uncategorized");
    expect(row?.detail).toBe("180");
    expect(find(context({ describe: describing() }), "describe:uncategorized")).toBeUndefined();
  });

  it("asks for a depth before describing a selection, showing what will be described", () => {
    let ran: [string[], string] | null = null;
    const ctx = context({
      selection: ["a.md", "b.md"],
      describe: describing(),
      actions: { ...actions, describeSelected: (ids: string[], depth: string) => (ran = [ids, depth]) },
    });
    const row = find(ctx, "describe:selected");
    expect(row?.label).toBe("Describe");
    expect(row?.section).toBe("Selection");
    expect(row?.detail).toBe("2 selected");
    expect(row?.stage?.subject).toEqual(["a.md", "b.md"]);
    const rows = row?.stage?.items() ?? [];
    expect(rows.map((r) => r.id)).toEqual([
      "describe:depth:broad",
      "describe:depth:standard",
      "describe:depth:specific",
    ]);
    expect(rows.map((r) => r.label)).toEqual(["Broad", "Standard", "Specific"]);
    expect(rows.map((r) => r.detail)).toEqual(["1–2 general labels", "up to 4 labels", "up to 6 labels"]);
    rows[2].run?.();
    expect(ran).toEqual([["a.md", "b.md"], "specific"]);
  });

  it("shows the uncategorized clippings as the subject of the bulk run", () => {
    let depth = "";
    const ctx = context({
      describe: describing({ uncategorized: ["x.md", "y.md"] }),
      actions: { ...actions, describeUncategorized: (d: string) => (depth = d) },
    });
    const stage = find(ctx, "describe:uncategorized")?.stage;
    expect(stage?.subject).toEqual(["x.md", "y.md"]);
    stage?.items()[0].run?.();
    expect(depth).toBe("broad");
  });

  it("shows only Stop while a run is going", () => {
    const ctx = context({
      selection: ["a.md"],
      describe: describing({ running: true, done: 23, total: 180, uncategorized: paths(157) }),
    });
    expect(find(ctx, "describe:stop")?.detail).toBe("23 of 180");
    expect(find(ctx, "describe:uncategorized")).toBeUndefined();
    expect(find(ctx, "describe:selected")).toBeUndefined();
  });

  it("says what Describe is missing, in place of its rows, when it is on but can't run", () => {
    let hint = "";
    const ctx = context({
      selection: ["a.md"],
      describe: null,
      describeBlocked: { label: "Describe needs a license key", hint: "Paste it under Settings." },
      actions: { ...actions, showHint: (text: string) => (hint = text) },
    });
    const row = find(ctx, "describe:blocked");
    expect(row?.label).toBe("Describe needs a license key");
    expect(row?.section).toBe("Describe");
    expect(find(ctx, "describe:selected")).toBeUndefined();
    row?.run?.();
    expect(hint).toBe("Paste it under Settings.");
  });

  it("shows no Describe rows at all while Describe is off", () => {
    const ctx = context({ selection: ["a.md"], describe: null, describeBlocked: null });
    expect(buildCommands(ctx).filter((c) => c.id.startsWith("describe:"))).toEqual([]);
  });

  it("offers Describe on a selection only while Describe is ready and idle", () => {
    expect(offersDescribe(null)).toBe(false);
    expect(offersDescribe(describing())).toBe(true);
    expect(offersDescribe(describing({ running: true }))).toBe(false);
  });

  it("gives the selection bar and the right-click menu the palette's three depths", () => {
    expect(DESCRIBE_DEPTHS.map((d) => [d.depth, d.label, d.icon, d.detail])).toEqual([
      ["broad", "Broad", "signal-low", "1–2 general labels"],
      ["standard", "Standard", "signal-medium", "up to 4 labels"],
      ["specific", "Specific", "signal-high", "up to 6 labels"],
    ]);
  });

  const reviewing = (over: Partial<ReviewView> = {}): ReviewView => ({
    position: 1,
    total: 12,
    path: "reel.md",
    terms: [
      { term: "projector", definition: "Projectors.", ticked: true },
      { term: "sponsored-ad", definition: "Paid promotions.", ticked: false },
    ],
    counts: { labels: 1, clips: 1 },
    ...over,
  });

  it("reviews clip by clip, with the clip as the stage's subject", () => {
    let toggled: string[] = [];
    let stepped = 0;
    let seen = false;
    const ctx = context({
      describe: describing({ review: reviewing() }),
      actions: {
        ...actions,
        toggleSuggestion: (path: string, term: string) => (toggled = [path, term]),
        stepReview: (delta: 1 | -1) => (stepped = delta),
        reviewShown: () => (seen = true),
      },
    });
    const review = find(ctx, "describe:review");
    expect(review?.label).toBe("Review suggestions");
    expect(review?.detail).toBe("12 clips");
    const stage = review?.stage;
    expect(stage?.title).toBe("Review · clip 1 of 12");
    expect(stage?.subject).toEqual(["reel.md"]);
    expect(stage?.adding).toEqual(["projector"]);
    expect(stage?.position).toBe("1 of 12");
    stage?.step?.(1);
    expect(stepped).toBe(1);
    stage?.onShow?.();
    expect(seen).toBe(true);
    const rows = stage?.items() ?? [];
    expect(rows.map((r) => r.id)).toEqual([
      "describe:term:projector",
      "describe:term:sponsored-ad",
      "describe:next",
      "describe:apply",
      "describe:discard-clip",
      "describe:discard-all",
    ]);
    expect(rows[0].detailIcon).toBe("check");
    expect(rows[0].keepOpen).toBe(true);
    rows[1].run?.();
    expect(toggled).toEqual(["reel.md", "sponsored-ad"]);
    expect(rows[3].label).toBe("Apply");
    expect(rows[3].detail).toBe("1 label · 1 clip");
  });

  it("lets a clip's suggestions, or all of them, be discarded", () => {
    let discarded = "";
    const ctx = context({
      describe: describing({ review: reviewing() }),
      actions: {
        ...actions,
        discardClip: () => (discarded = "clip"),
        discardAll: () => (discarded = "all"),
      },
    });
    const stage = find(ctx, "describe:review")?.stage;
    const rows = stage?.items() ?? [];
    const clip = rows.find((r) => r.id === "describe:discard-clip");
    const all = rows.find((r) => r.id === "describe:discard-all");
    expect(clip?.label).toBe("Discard");
    expect(clip?.detail).toBe("⇧⌫");
    expect(clip?.destructive).toBe(true);
    expect(clip?.keepOpen).toBe(true);
    expect(all?.label).toBe("Discard all");
    expect(all?.detail).toBe("12 clips");
    expect(all?.destructive).toBe(true);
    all?.run?.();
    expect(discarded).toBe("all");
    stage?.discard?.();
    expect(discarded).toBe("clip");
  });

  it("offers the previous clip after the first, and no next on the last", () => {
    const ctx = context({
      describe: describing({ review: reviewing({ position: 12, counts: { labels: 5, clips: 12 } }) }),
    });
    const rows = find(ctx, "describe:review")?.stage?.items() ?? [];
    expect(rows.map((r) => r.id)).toEqual([
      "describe:term:projector",
      "describe:term:sponsored-ad",
      "describe:previous",
      "describe:apply",
      "describe:discard-clip",
      "describe:discard-all",
    ]);
    expect(rows[3].detail).toBe("5 labels · 12 clips");
  });

  it("still finds the Describe rows by their old, longer names", () => {
    const ctx = context({
      selection: ["a.md"],
      describe: describing({ uncategorized: ["b.md"], review: reviewing() }),
    });
    const top = (query: string) =>
      searchPalette(query, buildCommands(ctx), [], [], {
        limit: 0,
        activeGrid: "Clippings",
        homeGrid: "Clippings",
        registered: new Set(),
      })[0]?.rows[0]?.key;
    expect(top("describe selected")).toBe("describe:selected");
    expect(top("review suggested categories")).toBe("describe:review");
    expect(top("describe uncategorized clippings")).toBe("describe:uncategorized");
  });

  it("hides the review while a run is going", () => {
    const ctx = context({ describe: describing({ running: true, review: reviewing() }) });
    expect(find(ctx, "describe:review")).toBeUndefined();
  });

  it("offers a retry for failed clippings", () => {
    const retry = find(context({ describe: describing({ failed: 4 }) }), "describe:retry");
    expect(retry?.label).toBe("Retry failed");
    expect(retry?.detail).toBe("4");
  });

});

describe("revisit commands", () => {
  const pass = (over: Partial<RevisitView> = {}): RevisitView => ({
    position: 1,
    total: 20,
    path: "a.md",
    mark: null,
    counts: { kept: 0, forgotten: 0 },
    finished: false,
    ...over,
  });
  const revisit = (over: Partial<RevisitContext> = {}): RevisitContext => ({
    available: 140,
    session: null,
    forget: "trash",
    ...over,
  });
  const rows = (ctx: PaletteContext): string[] =>
    find(ctx, "revisit")?.stage?.items().map((row) => row.id) ?? [];

  it("is offered on a wall with clips, and not where there is no room for it", () => {
    expect(ids(context({ revisit: revisit() }))).toContain("revisit");
    expect(ids(context({ revisit: revisit({ available: 0 }) }))).not.toContain("revisit");
    expect(ids(context({ revisit: null }))).not.toContain("revisit");
  });

  it("says how many clips a pass will show, or where the pass under way is", () => {
    expect(find(context({ revisit: revisit() }), "revisit")?.detail).toBe("20 clips");
    expect(find(context({ revisit: revisit({ available: 6 }) }), "revisit")?.detail).toBe("6 clips");
    expect(find(context({ revisit: revisit({ session: pass({ position: 3 }) }) }), "revisit")?.detail).toBe(
      "3 of 20"
    );
  });

  it("starts a pass when its stage opens", () => {
    let started = 0;
    const ctx = context({ revisit: revisit(), actions: { ...actions, startRevisit: () => started++ } });
    find(ctx, "revisit")?.stage?.onShow?.();
    expect(started).toBe(1);
  });

  it("shows the clip with keep, forget and finish", () => {
    const ctx = context({ revisit: revisit({ session: pass() }) });
    const stage = find(ctx, "revisit")?.stage;
    expect(stage?.subject).toEqual(["a.md"]);
    expect(stage?.position).toBe("1 of 20");
    expect(rows(ctx)).toEqual(["revisit:keep", "revisit:forget", "revisit:finish"]);
  });

  it("offers the previous clip after the first", () => {
    expect(rows(context({ revisit: revisit({ session: pass({ position: 2 }) }) }))).toContain("revisit:previous");
  });

  it("puts finish first once every clip is decided", () => {
    expect(rows(context({ revisit: revisit({ session: pass({ finished: true }) }) }))[0]).toBe("revisit:finish");
  });

  it("marks the clip's decision and says what finishing will do", () => {
    const ctx = context({
      revisit: revisit({ session: pass({ mark: "forget", counts: { kept: 2, forgotten: 3 } }), forget: "archive" }),
    });
    const stage = find(ctx, "revisit")?.stage;
    const items = stage?.items() ?? [];
    expect(stage?.position).toBe("1 of 20 · forgetting");
    expect(items.find((row) => row.id === "revisit:forget")?.detailIcon).toBe("check");
    expect(items.find((row) => row.id === "revisit:forget")?.icon).toBe("archive");
    expect(items.find((row) => row.id === "revisit:finish")?.detail).toBe("archive 3 clips");
  });

  it("answers the arrows with forget and keep", () => {
    const marks: string[] = [];
    const ctx = context({
      revisit: revisit({ session: pass() }),
      actions: { ...actions, decideRevisit: (mark) => marks.push(mark) },
    });
    const arrows = find(ctx, "revisit")?.stage?.arrows;
    arrows?.left();
    arrows?.right();
    expect(marks).toEqual(["forget", "keep"]);
  });
});
