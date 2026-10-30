// Prints a still of the homepage's ASCII mark as text, for src/components/blog/mark-frame.ts.
// It loads the page with reduced motion, records each character the mark's canvas draws,
// and lays them back on their grid, without the dot field behind the mark.
// Usage: bun scripts/mark-frame.mjs [site url]
import { chromium } from "@playwright/test";

const url = process.argv[2] ?? "http://localhost:3000/";
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1512, height: 860 },
  reducedMotion: "reduce"
});
await page.addInitScript(() => {
  window.__chars = [];
  const fill = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (text, x, y, ...rest) {
    window.__chars.push([text, x, y]);
    return fill.call(this, text, x, y, ...rest);
  };
});
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForFunction(() => document.querySelector("[data-mark-mode]"));
const frame = await page.evaluate(() => {
  const chars = window.__chars;
  const step = (values) => {
    const sorted = [...new Set(values)].sort((a, b) => a - b);
    return Math.min(
      ...sorted
        .slice(1)
        .map((v, i) => v - sorted[i])
        .filter((d) => d > 0.5)
    );
  };
  const xs = chars.map((c) => c[1]);
  const ys = chars.map((c) => c[2]);
  const [x0, y0, dx, dy] = [
    Math.min(...xs),
    Math.min(...ys),
    step(xs),
    step(ys)
  ];
  const grid = new Map(
    chars.map(([t, x, y]) => [
      `${Math.round((y - y0) / dy)},${Math.round((x - x0) / dx)}`,
      t
    ])
  );
  const keys = [...grid.keys()].map((k) => k.split(",").map(Number));
  const rows = Math.max(...keys.map(([r]) => r)) + 1;
  const cols = Math.max(...keys.map(([, c]) => c)) + 1;
  // The mark's own characters only: the dots of the field behind it go.
  const lines = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => grid.get(`${r},${c}`) ?? " ")
      .join("")
      .replaceAll(".", " ")
      .trimEnd()
  );
  while (lines.length && !lines[0]) lines.shift();
  while (lines.length && !lines.at(-1)) lines.pop();
  const indent = Math.min(
    ...lines.filter(Boolean).map((l) => l.length - l.trimStart().length)
  );
  return lines.map((l) => l.slice(indent)).join("\n");
});
console.log(frame);
await browser.close();
