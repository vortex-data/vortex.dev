import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { coverLayout } from "@/vendor/vortex-design/cover.js";

export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_CONTENT_TYPE = "image/png";

/**
 * The design system's Dark values for the Open Graph cards. Satori reads
 * no CSS custom properties, so the Cover's tokens are copied here;
 * `tests/unit/og.test.ts` checks them against `vortex-tokens.css`.
 */
export const OG_COVER_COLOURS = {
  ground: "#0f0f0e", // --ground-dark
  ink: "#ffffff", // --ink in Dark (white)
  muted: "#9c9c99", // --ink-muted in Dark (grey-450)
  edge: "#3c3c3a", // --edge in Dark (grey-600)
  accent: "#2f63ff" // --accent in Dark (blue-bright)
} as const;

// The faces as Google Fonts ships them, except that the Geist Mono file has
// no GSUB table: satori's parser cannot read its contextual alternates. The
// paths are literal, so the build traces only these two files.
let ogFonts: Promise<{ display: Buffer; mono: Buffer }> | undefined;
function loadOgFonts() {
  ogFonts ??= Promise.all([
    readFile(join(process.cwd(), "src/lib/og-assets/FunnelDisplay-Medium.ttf")),
    readFile(join(process.cwd(), "src/lib/og-assets/GeistMono-Regular.ttf"))
  ]).then(([display, mono]) => ({ display, mono }));
  return ogFonts;
}

// The text column on the left, and the cover's art to its right. The cover
// is laid out at 792 × 408 with its left 384px clear, then drawn 1.5 times
// as large, so its cells read at a link preview's size.
const OG_PAD = 72;
const OG_TEXT_WIDTH = 480;
const OG_SCALE = 1.5;
const OG_COVER = { width: 792, height: 408, clear: 384 } as const;

/**
 * An Open Graph card in the design system's parts: a Cover, drawn from
 * `seed`, on the right, and on the left an eyebrow in Geist Mono over a title
 * and a foot line. A post's card sets its title in Funnel Display, the
 * blog's editorial voice. The homepage's card sets it in Geist Mono, the
 * voice of the homepage's headline. Each entry in `title` starts a new line.
 */
export async function renderOgCard(props: {
  seed: string;
  eyebrow: string;
  title: readonly string[];
  face: "display" | "mono";
  foot: string;
}) {
  const { display, mono } = await loadOgFonts();
  const cover = coverLayout(props.seed, OG_COVER);
  const k = OG_SCALE;
  // A block that bleeds off the bottom runs to the image's bottom edge.
  const bottom = (b: { y: number; h: number }) =>
    b.y + b.h >= cover.height ? OG_SIZE.height - b.y * k : b.h * k;
  const c = OG_COVER_COLOURS;
  const titleLength = props.title.join(" ").length;
  const fill = { slab: c.accent, edge: c.edge, muted: c.muted } as const;
  return new ImageResponse(
    <div
      style={{
        position: "relative",
        display: "flex",
        width: "100%",
        height: "100%",
        backgroundColor: c.ground
      }}
    >
      {cover.blocks.map((b) => (
        <div
          key={`${b.role}-${b.x}-${b.y}`}
          style={{
            position: "absolute",
            left: b.x * k,
            top: b.y * k,
            width: b.w * k,
            height: bottom(b),
            borderRadius: 6,
            backgroundColor: fill[b.role]
          }}
        />
      ))}
      {cover.chars.map((ch) => (
        <div
          key={`${ch.x}-${ch.y}`}
          style={{
            position: "absolute",
            left: (ch.x - cover.pitch / 2) * k,
            top: (ch.y - cover.pitch / 2) * k,
            width: cover.pitch * k,
            height: cover.pitch * k,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "Geist Mono",
            fontSize: 16 * k,
            color: c.ground
          }}
        >
          {ch.ch}
        </div>
      ))}
      <div
        style={{
          position: "absolute",
          left: OG_PAD,
          top: OG_PAD,
          bottom: OG_PAD,
          width: OG_TEXT_WIDTH,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between"
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            fontFamily: "Geist Mono",
            fontSize: 22,

            color: c.muted
          }}
        >
          <div style={{ width: 10, height: 10, backgroundColor: c.accent }} />
          <span>{props.eyebrow}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              ...(props.face === "display"
                ? {
                    fontFamily: "Funnel Display",
                    fontSize: titleLength > 32 ? 60 : 68,
                    fontWeight: 500,
                    lineHeight: 1.04,
                    letterSpacing: "-0.02em"
                  }
                : {
                    fontFamily: "Geist Mono",
                    fontSize: 44,
                    lineHeight: 1.15
                  }),
              color: c.ink
            }}
          >
            {props.title.map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>
          <div
            style={{
              fontFamily: "Geist Mono",
              fontSize: 20,

              color: c.muted
            }}
          >
            {props.foot}
          </div>
        </div>
      </div>
    </div>,
    {
      ...OG_SIZE,
      fonts: [
        { name: "Funnel Display", data: display, weight: 500, style: "normal" },
        { name: "Geist Mono", data: mono, weight: 400, style: "normal" }
      ]
    }
  );
}
