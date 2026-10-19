import { describe, expect, it } from "vitest";
import {
  COLOR_NAMES,
  colorAliases,
  colorDot,
  colorOrder,
  colorScore,
  colorsIn,
  hasColor,
  hexQuery,
  isBroadColor,
  isHexColor,
} from "../src/core/colors";
import type { Swatch } from "../src/core/swatches";

const palette = (...swatches: Array<[string, number]>): Swatch[] =>
  swatches.map(([hex, share]) => ({ hex, share }));

const solid = (hex: string): Swatch[] => palette([hex, 1]);

describe("colorsIn", () => {
  it("calls a mostly maroon picture maroon, and red as well", () => {
    const names = colorsIn(palette(["#800000", 0.7], ["#D8D8D8", 0.3]));
    expect(names).toContain("maroon");
    expect(names).toContain("red");
  });

  it("finds maroon's neighbours under maroon", () => {
    // Swatches are averages of nearby pixels, so a search has to take in the
    // shades around the word as well as the word itself.
    for (const hex of ["#800020", "#722F37", "#4A0000", "#6B1C23"]) {
      expect(colorsIn(solid(hex))).toContain("maroon");
    }
  });

  it("keeps a bright red out of maroon", () => {
    const names = colorsIn(solid("#FF0000"));
    expect(names).toContain("red");
    expect(names).not.toContain("maroon");
  });

  it("keeps orange out of red", () => {
    const names = colorsIn(solid("#FFA500"));
    expect(names).toContain("orange");
    expect(names).not.toContain("red");
  });

  it("calls a pale pink pink rather than red", () => {
    const names = colorsIn(solid("#FFC0CB"));
    expect(names).toContain("pink");
    expect(names).not.toContain("red");
  });

  it("gives every broad colour a picture of its own", () => {
    const samples: Record<string, string> = {
      red: "#D01818",
      orange: "#FF8C00",
      yellow: "#FFD700",
      green: "#228B22",
      teal: "#008080",
      blue: "#4169E1",
      purple: "#800080",
      pink: "#FF69B4",
      brown: "#8B4513",
      black: "#111111",
      grey: "#808080",
      white: "#F4F4F4",
    };
    for (const [name, hex] of Object.entries(samples)) {
      expect(colorsIn(solid(hex)), `${hex} as ${name}`).toContain(name);
    }
  });

  it("does not count a touch of a colour as the picture being that colour", () => {
    expect(colorsIn(palette(["#808080", 0.98], ["#800000", 0.02]))).not.toContain("maroon");
  });

  it("does not call a picture black for its black bars", () => {
    // Letterboxing and a screenshot's dark chrome are structure, not subject.
    expect(colorsIn(palette(["#000000", 0.25], ["#3366CC", 0.75]))).not.toContain("black");
  });

  it("still calls a picture that is mostly black black", () => {
    expect(colorsIn(palette(["#020202", 0.9], ["#3366CC", 0.1]))).toContain("black");
  });

  it("lists the broad colours ahead of the shades, in the vocabulary's order", () => {
    const names = colorsIn(palette(["#800000", 0.5], ["#000080", 0.5]));
    const order = COLOR_NAMES.map((color) => color.name);
    expect(names).toEqual([...names].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
    expect(names.indexOf("blue")).toBeLessThan(names.indexOf("maroon"));
  });

  it("finds nothing in an empty palette", () => {
    expect(colorsIn([])).toEqual([]);
  });
});

describe("colorScore", () => {
  it("scores a mostly maroon picture above one with a touch of maroon", () => {
    const mostly = colorScore(palette(["#800000", 0.8], ["#EEEEEE", 0.2]), "maroon");
    const touch = colorScore(palette(["#EEEEEE", 0.9], ["#800000", 0.1]), "maroon");
    expect(mostly).toBeGreaterThan(touch);
    expect(touch).toBeGreaterThan(0);
  });

  it("is zero for a colour the picture does not have", () => {
    expect(colorScore(solid("#0000FF"), "maroon")).toBe(0);
  });

  it("matches a hex code by closeness", () => {
    const near = colorScore(solid("#7A0A0A"), "#800000");
    const exact = colorScore(solid("#800000"), "#800000");
    expect(exact).toBeGreaterThan(near);
    expect(near).toBeGreaterThan(0);
    expect(colorScore(solid("#00AA00"), "#800000")).toBe(0);
  });

  it("is zero for a word that is not a colour", () => {
    expect(colorScore(solid("#800000"), "manga")).toBe(0);
  });
});

describe("hexQuery", () => {
  it("reads a typed hex code with or without its #", () => {
    expect(hexQuery("#800000")).toBe("#800000");
    expect(hexQuery("800000")).toBe("#800000");
    expect(hexQuery(" #a0b1c2 ")).toBe("#A0B1C2");
  });

  it("expands the three-digit form", () => {
    expect(hexQuery("#f80")).toBe("#FF8800");
  });

  it("refuses anything that is not a hex code", () => {
    expect(hexQuery("maroon")).toBeNull();
    expect(hexQuery("#12345")).toBeNull();
    expect(hexQuery("bad")).toBeNull();
    expect(hexQuery("")).toBeNull();
  });

  it("needs the # for a three-digit code, so a word like 'add' stays a word", () => {
    expect(hexQuery("add")).toBeNull();
    expect(hexQuery("#add")).toBe("#AADDDD");
  });
});

describe("isHexColor", () => {
  it("tells a stored hex value from a colour name", () => {
    expect(isHexColor("#800000")).toBe(true);
    expect(isHexColor("maroon")).toBe(false);
  });
});

describe("colorDot", () => {
  it("paints a name in its own colour and a hex as itself", () => {
    expect(colorDot("#123456")).toBe("#123456");
    expect(colorDot("maroon")).toMatch(/^#[0-9A-F]{6}$/);
    expect(colorDot("manga")).toBe("");
  });
});

describe("COLOR_NAMES", () => {
  it("never uses a word twice, as a name or as another word for one", () => {
    const words = COLOR_NAMES.flatMap((color) => [color.name, ...color.aliases]);
    expect(new Set(words).size).toBe(words.length);
  });

  it("paints every name's dot in a colour that name matches", () => {
    for (const color of COLOR_NAMES) {
      expect(colorsIn(solid(color.hex)), color.name).toContain(color.name);
    }
  });
});

describe("hasColor", () => {
  it("counts a hex code the picture comes close to", () => {
    expect(hasColor(solid("#7A0A0A"), "#800000")).toBe(true);
    expect(hasColor(solid("#00AA00"), "#800000")).toBe(false);
  });
});

describe("colorAliases", () => {
  it("lists the other words that find a colour", () => {
    expect(colorAliases("maroon")).toContain("burgundy");
    expect(colorAliases("grey")).toContain("gray");
    expect(colorAliases("#800000")).toEqual([]);
  });
});

describe("colorOrder", () => {
  it("sorts families ahead of shades, and hex codes last", () => {
    expect(colorOrder("red")).toBeLessThan(colorOrder("white"));
    expect(colorOrder("white")).toBeLessThan(colorOrder("maroon"));
    expect(colorOrder("silver")).toBeLessThan(colorOrder("#800000"));
  });
});

describe("isBroadColor", () => {
  it("tells a family from a shade", () => {
    expect(isBroadColor("red")).toBe(true);
    expect(isBroadColor("maroon")).toBe(false);
    expect(isBroadColor("#800000")).toBe(false);
  });
});
