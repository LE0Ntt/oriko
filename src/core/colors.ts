import { STRUCTURE_PENALTY, isStructural } from "./swatches";
import type { Swatch } from "./swatches";

/**
 * Finding clippings by colour: the words people type for colours, and how
 * well a picture's palette answers to each one.
 *
 * Pure, no DOM and no Obsidian. The palettes come from swatches.ts, worked
 * out on each device from the pictures it already has (color-service.ts).
 *
 * A colour word names a region, not a point. Swatches are averages of nearby
 * pixels, so a search for maroon has to take in burgundy, wine and oxblood
 * too, and a broad word like red has to take in maroon. Each word is
 * therefore a set of boxes in OKLCH (lightness, chroma, hue), the space where
 * equal steps look like equal steps and hue sits on its own axis, so "the
 * same hue, darker" is a box rather than a sphere that leaks into orange.
 */

/** Ranges in OKLCH. Hue is in degrees, and runs through 0 when `from` > `to`. */
interface Box {
  h?: [number, number];
  l?: [number, number];
  c?: [number, number];
}

export interface ColorName {
  /** The value a filter stores, and what the row shows. */
  name: string;
  /** Other words for it, which find it but are never shown. */
  aliases: string[];
  /** A family (red) rather than a shade inside one (maroon). Families list first. */
  broad: boolean;
  /** The row's dot. Always inside the name's own boxes. */
  hex: string;
  boxes: Box[];
  /** The share of the picture it needs, where the default would claim too much. */
  min?: number;
}

/**
 * How much of the picture a colour must cover before the picture counts as
 * that colour. Low, because a picture with a little maroon in it should still
 * turn up for maroon, just further down; ranking by score is what separates
 * mostly from a touch.
 */
const MIN_SHARE = 0.04;

/**
 * Higher for black, grey and white, which are in nearly every picture as
 * shadow, paper and background. At the chromatic figure a search for grey
 * returned most of the wall, which narrows nothing.
 */
const MIN_NEUTRAL_SHARE = 0.25;

/** OKLab distance at which a hex code stops matching a swatch at all. */
const HEX_REACH = 0.12;

const NEUTRAL = 0.035;

/**
 * Spectrum order, families first and then shades, which is the order every
 * list of these values is shown in. Set against real clippings and the CSS
 * and paint-chip references for each word; see tests/colors.test.ts for the
 * neighbours each one has to keep in or out.
 */
export const COLOR_NAMES: readonly ColorName[] = [
  { name: "red", aliases: [], broad: true, hex: "#D01818", boxes: [{ h: [10, 40], l: [0.22, 0.72], c: [0.09, 1] }] },
  {
    name: "orange",
    aliases: [],
    broad: true,
    hex: "#FF8C00",
    boxes: [
      { h: [38, 78], l: [0.6, 1], c: [0.1, 1] },
      // Pastel oranges: peach and apricot are orange to anyone asked.
      { h: [42, 78], l: [0.8, 1], c: [0.05, 0.1] },
    ],
  },
  { name: "yellow", aliases: [], broad: true, hex: "#FFD700", boxes: [{ h: [80, 118], l: [0.72, 1], c: [0.09, 1] }] },
  {
    name: "green",
    aliases: [],
    broad: true,
    hex: "#228B22",
    boxes: [
      { h: [118, 172], l: [0.25, 1], c: [0.045, 1] },
      // Olive sits on yellow's hue but is too dark to read as yellow.
      { h: [100, 118], l: [0.25, 0.72], c: [0.05, 1] },
    ],
  },
  { name: "teal", aliases: [], broad: true, hex: "#008080", boxes: [{ h: [172, 215], l: [0.25, 1], c: [0.04, 1] }] },
  { name: "blue", aliases: [], broad: true, hex: "#4169E1", boxes: [{ h: [215, 285], l: [0.15, 1], c: [0.04, 1] }] },
  { name: "purple", aliases: ["violet"], broad: true, hex: "#800080", boxes: [{ h: [285, 340], l: [0.2, 1], c: [0.05, 1] }] },
  {
    name: "pink",
    aliases: ["rose"],
    broad: true,
    hex: "#FF69B4",
    boxes: [
      { h: [340, 42], l: [0.72, 1], c: [0.04, 1] },
      // Hot pinks are darker than pastels but far more saturated than any red.
      { h: [340, 10], l: [0.5, 0.72], c: [0.14, 1] },
    ],
  },
  {
    name: "brown",
    aliases: [],
    broad: true,
    hex: "#8B4513",
    // Warm shadow and dim indoor light read as brown at a few percent, which
    // put a third of the wall under it.
    min: 0.1,
    boxes: [
      { h: [30, 90], l: [0.2, 0.62], c: [0.04, 0.15] },
    ],
  },
  { name: "black", aliases: [], broad: true, hex: "#111111", boxes: [{ l: [0, 0.24], c: [0, 0.08] }] },
  { name: "grey", aliases: ["gray"], broad: true, hex: "#808080", boxes: [{ l: [0.24, 0.9], c: [0, NEUTRAL] }] },
  { name: "white", aliases: [], broad: true, hex: "#F4F4F4", boxes: [{ l: [0.9, 1], c: [0, 0.04] }] },

  {
    name: "maroon",
    aliases: ["burgundy", "wine", "oxblood", "merlot"],
    broad: false,
    hex: "#800000",
    boxes: [{ h: [0, 36], l: [0.2, 0.46], c: [0.08, 1] }],
  },
  { name: "crimson", aliases: ["scarlet", "cherry"], broad: false, hex: "#DC143C", boxes: [{ h: [10, 32], l: [0.45, 0.68], c: [0.16, 1] }] },
  { name: "coral", aliases: ["salmon"], broad: false, hex: "#FF7F50", boxes: [{ h: [22, 50], l: [0.65, 0.82], c: [0.11, 1] }] },
  {
    name: "rust",
    aliases: ["terracotta", "copper", "burnt orange"],
    broad: false,
    hex: "#B7410E",
    boxes: [{ h: [34, 58], l: [0.38, 0.62], c: [0.11, 1] }],
  },
  { name: "peach", aliases: ["apricot"], broad: false, hex: "#FFCBA4", boxes: [{ h: [42, 78], l: [0.8, 0.94], c: [0.04, 0.12] }] },
  { name: "tan", aliases: ["khaki", "camel", "sand"], broad: false, hex: "#D2B48C", min: 0.1, boxes: [{ h: [55, 92], l: [0.65, 0.84], c: [0.03, 0.1] }] },
  { name: "beige", aliases: ["oatmeal"], broad: false, hex: "#E8D8B8", boxes: [{ h: [65, 112], l: [0.84, 0.95], c: [0.02, 0.07] }] },
  { name: "cream", aliases: ["ivory"], broad: false, hex: "#FFF8D6", boxes: [{ h: [80, 115], l: [0.93, 0.995], c: [0.02, 0.09] }] },
  { name: "mustard", aliases: ["ochre"], broad: false, hex: "#E1AD01", boxes: [{ h: [72, 96], l: [0.6, 0.82], c: [0.1, 1] }] },
  { name: "gold", aliases: ["golden"], broad: false, hex: "#FFD700", boxes: [{ h: [82, 102], l: [0.76, 0.93], c: [0.12, 1] }] },
  { name: "olive", aliases: [], broad: false, hex: "#808000", boxes: [{ h: [95, 125], l: [0.35, 0.66], c: [0.05, 1] }] },
  { name: "lime", aliases: ["chartreuse", "neon green"], broad: false, hex: "#32CD32", boxes: [{ h: [118, 146], l: [0.72, 1], c: [0.15, 1] }] },
  {
    name: "forest green",
    aliases: ["dark green", "hunter green", "bottle green"],
    broad: false,
    hex: "#1E5A2E",
    boxes: [{ h: [132, 170], l: [0.22, 0.55], c: [0.06, 1] }],
  },
  { name: "mint", aliases: ["seafoam"], broad: false, hex: "#A8F0C8", boxes: [{ h: [140, 180], l: [0.8, 1], c: [0.05, 0.18] }] },
  { name: "sage", aliases: [], broad: false, hex: "#9CAF88", boxes: [{ h: [105, 155], l: [0.52, 0.82], c: [0.03, 0.08] }] },
  { name: "turquoise", aliases: ["aqua", "cyan"], broad: false, hex: "#40E0D0", boxes: [{ h: [170, 205], l: [0.68, 1], c: [0.08, 1] }] },
  {
    name: "sky blue",
    aliases: ["light blue", "baby blue"],
    broad: false,
    hex: "#87CEEB",
    boxes: [{ h: [210, 248], l: [0.72, 1], c: [0.05, 1] }],
  },
  { name: "navy", aliases: ["dark blue", "midnight blue"], broad: false, hex: "#000080", boxes: [{ h: [235, 285], l: [0.12, 0.4], c: [0.05, 1] }] },
  {
    name: "cobalt",
    aliases: ["royal blue", "ultramarine", "electric blue"],
    broad: false,
    hex: "#0047AB",
    boxes: [{ h: [250, 278], l: [0.38, 0.62], c: [0.14, 1] }],
  },
  { name: "lavender", aliases: ["lilac", "mauve"], broad: false, hex: "#B57EDC", boxes: [{ h: [280, 335], l: [0.68, 1], c: [0.04, 0.17] }] },
  { name: "magenta", aliases: ["fuchsia"], broad: false, hex: "#FF00FF", boxes: [{ h: [315, 352], l: [0.5, 0.82], c: [0.17, 1] }] },
  { name: "plum", aliases: ["aubergine", "eggplant"], broad: false, hex: "#8E4585", boxes: [{ h: [318, 360], l: [0.22, 0.55], c: [0.06, 0.2] }] },
  {
    name: "charcoal",
    aliases: ["dark grey", "dark gray", "graphite"],
    broad: false,
    hex: "#3A3D40",
    boxes: [{ l: [0.2, 0.42], c: [0, 0.04] }],
  },
  { name: "silver", aliases: ["light grey", "light gray"], broad: false, hex: "#C0C0C0", boxes: [{ l: [0.7, 0.88], c: [0, 0.03] }] },
];

const BY_NAME = new Map(COLOR_NAMES.map((color) => [color.name, color]));

/** Neutral words want more of the picture before they claim it; see MIN_NEUTRAL_SHARE. */
function minShare(color: ColorName): number {
  if (color.min !== undefined) return color.min;
  return color.boxes.every((box) => box.c && box.c[1] <= 0.08 && !box.h)
    ? MIN_NEUTRAL_SHARE
    : MIN_SHARE;
}

interface Oklch {
  l: number;
  c: number;
  h: number;
  a: number;
  b: number;
}

function toLinear(channel: number): number {
  const v = channel / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function channels(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** sRGB to OKLab (Björn Ottosson's matrices), with its polar form alongside. */
function toOklch(hex: string): Oklch {
  const [r8, g8, b8] = channels(hex);
  const r = toLinear(r8);
  const g = toLinear(g8);
  const b = toLinear(b8);

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;

  const h = (Math.atan2(B, A) * 180) / Math.PI;
  return { l: L, c: Math.hypot(A, B), h: h < 0 ? h + 360 : h, a: A, b: B };
}

function within(value: number, range: [number, number] | undefined): boolean {
  return !range || (value >= range[0] && value <= range[1]);
}

function withinHue(hue: number, range: [number, number] | undefined): boolean {
  if (!range) return true;
  const [from, to] = range;
  return from <= to ? hue >= from && hue <= to : hue >= from || hue <= to;
}

function inBoxes(color: Oklch, boxes: Box[]): boolean {
  return boxes.some(
    (box) => within(color.l, box.l) && within(color.c, box.c) && withinHue(color.h, box.h)
  );
}

/** A frame colour counts for less, as it does when the palette is chosen. */
function weightOf(hex: string): number {
  const [r, g, b] = channels(hex);
  return isStructural(r, g, b) ? STRUCTURE_PENALTY : 1;
}

/** Whether a stored filter value is a hex code rather than a colour word. */
export function isHexColor(value: string): boolean {
  return /^#[0-9A-F]{6}$/.test(value);
}

/**
 * A typed hex code in the form a filter stores it, or null for anything
 * else. The three-digit form needs its #, so a word like "add" or "bad" in
 * the palette is never mistaken for a colour.
 */
export function hexQuery(text: string): string | null {
  const typed = text.trim();
  const long = /^#?([0-9a-f]{6})$/i.exec(typed);
  if (long) return `#${long[1].toUpperCase()}`;
  const short = /^#([0-9a-f]{3})$/i.exec(typed);
  if (!short) return null;
  return `#${[...short[1].toUpperCase()].map((digit) => digit + digit).join("")}`;
}

/**
 * How well a palette answers to a colour word or hex code: the share of the
 * picture in that colour, so 0 for none and 1 for all of it. A hex code
 * counts each swatch by how close it is as well, since a code names a point.
 */
export function colorScore(palette: readonly Swatch[], value: string): number {
  if (isHexColor(value)) {
    const target = toOklch(value);
    let score = 0;
    for (const swatch of palette) {
      const color = toOklch(swatch.hex);
      const d = Math.hypot(color.l - target.l, color.a - target.a, color.b - target.b);
      if (d < HEX_REACH) score += swatch.share * weightOf(swatch.hex) * (1 - d / HEX_REACH);
    }
    return score;
  }

  const named = BY_NAME.get(value);
  if (!named) return 0;
  let score = 0;
  for (const swatch of palette) {
    if (inBoxes(toOklch(swatch.hex), named.boxes)) score += swatch.share * weightOf(swatch.hex);
  }
  return score;
}

/** Whether a palette covers enough of a colour for the picture to count as it. */
export function hasColor(palette: readonly Swatch[], value: string): boolean {
  const named = BY_NAME.get(value);
  const floor = named ? minShare(named) : MIN_SHARE;
  return colorScore(palette, value) >= floor;
}

/** Every colour word the palette counts as, families first, in spectrum order. */
export function colorsIn(palette: readonly Swatch[]): string[] {
  if (palette.length === 0) return [];
  return COLOR_NAMES.filter((color) => hasColor(palette, color.name)).map((color) => color.name);
}

/** The dot a row is painted with: the word's own colour, a hex as itself, or "" for neither. */
export function colorDot(value: string): string {
  if (isHexColor(value)) return value;
  return BY_NAME.get(value)?.hex ?? "";
}

/** The word's other names, for a search to find it by; empty for a hex code. */
export function colorAliases(value: string): string[] {
  return BY_NAME.get(value)?.aliases ?? [];
}

/** Where a value sorts in a list of colours: the vocabulary's order, hex codes after. */
export function colorOrder(value: string): number {
  const at = COLOR_NAMES.findIndex((color) => color.name === value);
  return at === -1 ? COLOR_NAMES.length : at;
}

/** Whether a value is a family rather than a shade, for grouping a list. */
export function isBroadColor(value: string): boolean {
  return BY_NAME.get(value)?.broad ?? false;
}
