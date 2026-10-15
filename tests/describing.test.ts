import { describe, expect, it } from "vitest";
import { addedLabels, describeLook, summaryText } from "../src/core/describing";

describe("describeLook", () => {
  it("says a video's frames are being picked, and a picture is being read", () => {
    expect(describeLook({ step: "preparing" }, "video")).toMatchObject({
      icon: "film",
      label: "Picking frames",
      busy: true,
    });
    expect(describeLook({ step: "preparing" }, "image")).toMatchObject({
      icon: "image",
      label: "Reading picture",
      busy: true,
    });
  });

  it("sweeps the tile while Claude has it", () => {
    expect(describeLook({ step: "describing" }, "image")).toMatchObject({
      icon: "sparkles",
      label: "Describing",
      busy: true,
      sweep: true,
    });
  });

  it("lands with a check and the labels it added", () => {
    const look = describeLook({ step: "labelled", added: ["food", "noodles"], review: 0 }, "image");
    expect(look).toMatchObject({ icon: "check", label: "Labelled", busy: false, labels: ["food", "noodles"] });
    expect(look?.holdMs).toBeGreaterThan(0);
  });

  it("says Described when only the caption changed", () => {
    expect(describeLook({ step: "labelled", added: [], review: 0 }, "image")?.label).toBe("Described");
  });

  it("holds a clip with suggestions waiting a little longer, and says how many", () => {
    const plain = describeLook({ step: "labelled", added: ["food"], review: 0 }, "image");
    const waiting = describeLook({ step: "labelled", added: ["food"], review: 2 }, "image");
    expect(waiting).toMatchObject({ icon: "list-checks", label: "2 to review" });
    expect(waiting?.holdMs).toBeGreaterThan(plain?.holdMs ?? 0);
  });

  it("says when a clip could not be described", () => {
    expect(describeLook({ step: "failed" }, "video")).toMatchObject({
      icon: "alert-triangle",
      label: "Couldn't describe",
      busy: false,
    });
  });

  it("shows nothing once cleared", () => {
    expect(describeLook({ step: "cleared" }, "image")).toBeNull();
  });
});

describe("addedLabels", () => {
  it("lists the categories a write adds, in its order", () => {
    expect(addedLabels(["food"], { categories: ["food", "noodles", "toronto"] })).toEqual(["noodles", "toronto"]);
  });

  it("is empty when the write leaves the categories alone", () => {
    expect(addedLabels(["food"], { caption: "A bowl." })).toEqual([]);
  });
});

describe("summaryText", () => {
  it("counts what was described", () => {
    expect(summaryText({ described: 20, failed: 0, suggested: 0, stopped: false })).toBe("20 described");
  });

  it("adds failures, suggestions and a stop", () => {
    expect(summaryText({ described: 1, failed: 2, suggested: 1, stopped: true })).toBe(
      "1 described, 2 failed, 1 category to review (stopped)"
    );
  });
});
