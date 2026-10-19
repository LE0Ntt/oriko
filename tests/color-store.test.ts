import { describe, expect, it } from "vitest";
import { ColorStore } from "../src/core/color-store";

const maroon = [{ hex: "#800000", share: 0.75 }, { hex: "#EEEEEE", share: 0.25 }];

describe("ColorStore", () => {
  it("wants a picture it has never read", () => {
    expect(new ColorStore().isDue("a.jpg", 10)).toBe(true);
  });

  it("keeps a palette until the file changes", () => {
    const store = new ColorStore();
    store.set("a.jpg", 10, maroon);
    expect(store.get("a.jpg")).toEqual(maroon);
    expect(store.isDue("a.jpg", 10)).toBe(false);
    expect(store.isDue("a.jpg", 11)).toBe(true);
  });

  it("remembers a picture it could not read, so it is not tried on every pass", () => {
    const store = new ColorStore();
    store.set("broken.jpg", 10, []);
    expect(store.isDue("broken.jpg", 10)).toBe(false);
    expect(store.get("broken.jpg")).toEqual([]);
  });

  it("survives a round trip through its file, shares rounded", () => {
    const store = new ColorStore();
    store.set("a.jpg", 10, [{ hex: "#800000", share: 0.123456 }]);
    const back = ColorStore.fromJSON(JSON.parse(JSON.stringify(store.toJSON())));
    expect(back.get("a.jpg")).toEqual([{ hex: "#800000", share: 0.123 }]);
    expect(back.isDue("a.jpg", 10)).toBe(false);
  });

  it("starts over from a file written by an older way of reading colour", () => {
    const store = ColorStore.fromJSON({
      version: 0,
      entries: { "a.jpg": { m: 10, p: [["#800000", 1]] } },
    });
    expect(store.isDue("a.jpg", 10)).toBe(true);
  });

  it("starts over from a file it cannot make sense of", () => {
    expect(ColorStore.fromJSON("nonsense").isDue("a.jpg", 10)).toBe(true);
    expect(ColorStore.fromJSON(null).isDue("a.jpg", 10)).toBe(true);
  });

  it("forgets pictures no clipping shows any more, and says whether it did", () => {
    const store = new ColorStore();
    store.set("kept.jpg", 1, maroon);
    store.set("gone.jpg", 1, maroon);
    expect(store.prune(new Set(["kept.jpg"]))).toBe(true);
    expect(store.get("gone.jpg")).toBeUndefined();
    expect(store.get("kept.jpg")).toEqual(maroon);
    expect(store.prune(new Set(["kept.jpg"]))).toBe(false);
  });

  it("lists the pictures it holds", () => {
    const store = new ColorStore();
    store.set("a.jpg", 1, maroon);
    store.set("b.jpg", 1, []);
    expect(store.paths()).toEqual(["a.jpg", "b.jpg"]);
  });
});
