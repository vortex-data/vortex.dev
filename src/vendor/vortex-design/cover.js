// The Cover card's generator. DOM-free and pure: a seed (a post's slug) gives one arrangement of
// blocks on a 24px grid and one ASCII texture cut out of the Blue slab, the same every time. A site
// calls it at build time and inlines the SVG, so a cover costs no JavaScript in the browser.
//
// - coverLayout(seed, opts) returns the parts: the blocks, the characters and the traits a reader
//   sees first (where the slab stands, how it meets the edges, its texture and the edge block's
//   side). A renderer that cannot draw SVG text, such as an Open Graph image, draws from it.
// - coverFor(seed, opts) returns the SVG markup. Its colours and font come from bundle.css
//   (`vx-cover-*`), so it follows the theme. The seed never reaches the markup.
//
// The limits: one Blue slab 6 to 10 columns wide and at least 60% of the height, one edge block,
// and up to two small ink-muted blocks. The texture is the ASCII ramp, one character a cell.

/** The ASCII mark's luminance ramp, from empty to full. */
export const COVER_RAMP = " .:-=+*#%@";

const PITCH = 24;
// Chosen so the seven posts the blog had when the generator shipped get seven distinct covers.
const SALT = "vx-cover-143:";
const BLEED = 8;
const PLACES = ["left", "centre-left", "centre-right", "right"];
const REACHES = ["full", "hang", "stand"];
const PATTERNS = ["fall", "rise", "sweep", "diagonal", "ripple", "wave", "terrace"];

// FNV-1a with a finaliser, then mulberry32: a small, stable generator from a string.
function hash(s) {
  let h = 0x811c9dc5;
  for (const c of String(s)) {
    h ^= c.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  // murmur3's finaliser, so seeds that differ in one letter land far apart.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}
function generator(seed) {
  let a = hash(`${SALT}${seed}`);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The texture's value from 0 (empty) to 1 (full) at cell (i, j) of an n × m slab.
function patternValue(pattern, i, j, n, m, k) {
  const u = n > 1 ? i / (n - 1) : 0;
  const v = m > 1 ? j / (m - 1) : 0;
  switch (pattern) {
    case "fall":
      return v;
    case "rise":
      return 1 - v;
    case "sweep":
      return k.flip ? 1 - u : u;
    case "diagonal":
      return ((k.flip ? 1 - u : u) + v) / 2;
    case "ripple":
      return 0.5 + 0.5 * Math.cos(Math.hypot(i - k.ci, j - k.cj) * 0.95);
    case "terrace":
      return ((Math.floor(i / 2) + Math.floor(j / 2)) % 2) * 0.6 + v * 0.4;
    default:
      return 0.5 + 0.5 * Math.sin(j * 0.75 + 1.8 * Math.sin(i * 0.6 + k.phase));
  }
}

const overlaps = (a, b, gap) => a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

/**
 * @param {string} seed
 * @param {{ width?: number, height?: number, clear?: number }} [opts] The cover's size in px (a
 *   multiple of 24), and `clear`: the px from the left kept empty for text.
 */
export function coverLayout(seed, { width = 960, height = 240, clear = 0 } = {}) {
  const r = generator(seed);
  const int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
  const pick = (list) => list[Math.floor(r() * list.length)];
  const cols = Math.floor(width / PITCH);
  const rows = Math.floor(height / PITCH);
  const first = Math.ceil(clear / PITCH);
  const avail = cols - first;

  // The slab: where it stands, how wide, and how it meets the top and bottom edges.
  const slabPlace = pick(PLACES);
  const slabReach = pick(REACHES);
  const sw = int(6, 10);
  const margin = clear ? 1 : Math.round(avail * 0.18);
  const lo = first + margin;
  const hi = Math.max(lo, cols - margin - sw);
  const at = { left: 0, "centre-left": 0.36, "centre-right": 0.64, right: 1 }[slabPlace];
  const sx = Math.min(hi, Math.max(lo, Math.round(lo + at * (hi - lo)) + int(-1, 1)));
  const cut = int(Math.ceil(rows * 0.25), Math.floor(rows * 0.35));
  const top = slabReach === "stand" ? cut : 0;
  const bottom = slabReach === "hang" ? rows - cut : rows;
  const slab = {
    role: "slab",
    x: sx * PITCH,
    y: top === 0 ? -BLEED : top * PITCH,
    w: sw * PITCH,
    h: (bottom - top) * PITCH + (top === 0 ? BLEED : 0) + (bottom === rows ? BLEED : 0),
  };

  // The edge block: beside the slab, bleeding off the top or the bottom, and off the side when it
  // reaches it.
  const roomRight = cols - (sx + sw) - 1;
  const roomLeft = sx - 1 - first;
  // The edge block takes the wider side, and either side when the slab stands in the middle.
  let edgeSide = slabPlace === "left" ? "right" : slabPlace === "right" ? "left" : r() < 0.5 ? "left" : "right";
  if ((edgeSide === "right" ? roomRight : roomLeft) < 4) edgeSide = edgeSide === "right" ? "left" : "right";
  const room = edgeSide === "right" ? roomRight : roomLeft;
  const ew = Math.min(room, int(8, 14));
  const eh = int(Math.ceil(rows * 0.4), Math.floor(rows * 0.7));
  const fromTop = slabReach === "stand" ? true : slabReach === "hang" ? false : r() < 0.5;
  const ex = edgeSide === "right" ? sx + sw + 1 : sx - 1 - ew;
  const bleedSide = edgeSide === "right" ? ex + ew >= cols - 2 : ex <= first + 2 && clear === 0;
  const edge = { role: "edge", x: ex * PITCH, y: fromTop ? -BLEED : (rows - eh) * PITCH, w: ew * PITCH, h: eh * PITCH + BLEED };
  if (bleedSide && edgeSide === "right") edge.w = width - edge.x + BLEED;
  if (bleedSide && edgeSide === "left") {
    edge.w += edge.x + BLEED;
    edge.x = -BLEED;
  }
  const blocks = [edge];

  // Up to two small ink-muted blocks, clear of the others by a cell.
  const count = int(0, 2);
  for (let n = 0, tries = 0; n < count && tries < 40; tries++) {
    const w = int(2, 6);
    const h = int(1, 3);
    const x = int(first, cols - w);
    const y = r() < 0.5 ? rows - h : int(1, rows - h - 1);
    const b = { role: "muted", x: x * PITCH, y: y * PITCH, w: w * PITCH, h: y + h === rows ? h * PITCH + BLEED : h * PITCH };
    if ([slab, ...blocks].some((o) => overlaps(b, o, PITCH))) continue;
    blocks.push(b);
    n++;
  }

  // The texture: one ramp character a cell, inside the slab and the cover.
  const pattern = pick(PATTERNS);
  const k = { flip: r() < 0.5, ci: int(0, sw - 1), cj: int(0, bottom - top - 1), phase: r() * Math.PI * 2 };
  const low = int(1, 2);
  const high = int(7, 9);
  const chars = [];
  const m = bottom - top;
  for (let j = 0; j < m; j++) {
    for (let i = 0; i < sw; i++) {
      const v = patternValue(pattern, i, j, sw, m, k);
      const jitter = r() < 0.25 ? (r() < 0.5 ? -1 : 1) : 0;
      const level = Math.min(9, Math.max(0, Math.round(low + v * (high - low)) + jitter));
      const ch = COVER_RAMP[level];
      if (ch !== " ") chars.push({ x: (sx + i) * PITCH + PITCH / 2, y: (top + j) * PITCH + PITCH / 2, ch });
    }
  }

  return { width, height, pitch: PITCH, blocks: [...blocks, slab], chars, pattern, slabPlace, slabReach, edgeSide };
}

const ROLE = { slab: "vx-cover-slab", edge: "vx-cover-edge", muted: "vx-cover-muted" };

/**
 * The cover as SVG markup: blocks under the slab, then its characters, one `text` a row.
 * @param {string} seed
 * @param {{ width?: number, height?: number, clear?: number }} [opts]
 */
export function coverFor(seed, opts = {}) {
  const L = coverLayout(seed, opts);
  const rects = L.blocks.map((b) => `<rect class="${ROLE[b.role]}" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="6"/>`);
  const byRow = new Map();
  for (const c of L.chars) byRow.set(c.y, [...(byRow.get(c.y) ?? []), c]);
  const texts = [...byRow].map(([y, cs]) => `<text class="vx-cover-ch" x="${cs.map((c) => c.x).join(" ")}" y="${y}">${cs.map((c) => c.ch).join("")}</text>`);
  return `<svg class="vx-cover-art" viewBox="0 0 ${L.width} ${L.height}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">${rects.join("")}${texts.join("")}</svg>`;
}
