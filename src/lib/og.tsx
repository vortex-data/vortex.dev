import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { siteName } from "@/lib/constants";
import { THEME } from "@/lib/theme";
import { coverLayout } from "@/vendor/vortex-design/cover.js";

export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_CONTENT_TYPE = "image/png";

export function renderOgImage(props: {
  title: string;
  description?: string | undefined;
  eyebrow?: string | undefined;
}) {
  return new ImageResponse(
    <OgCard
      title={props.title}
      description={props.description}
      eyebrow={props.eyebrow}
    />,
    OG_SIZE
  );
}

function OgCard({
  title,
  description,
  eyebrow
}: {
  title: string;
  description?: string | undefined;
  eyebrow?: string | undefined;
}) {
  return (
    <div
      style={{
        height: "100%",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "80px",
        backgroundColor: THEME.background,
        color: THEME.foreground,
        fontFamily: "sans-serif"
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "16px",
          fontSize: 28,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "rgba(255,255,255,0.7)",
          fontFamily: "monospace"
        }}
      >
        <span>{siteName}</span>
        {eyebrow ? (
          <>
            <span style={{ color: "rgba(255,255,255,0.3)" }}>/</span>
            <span>{eyebrow}</span>
          </>
        ) : null}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "28px" }}>
        <div
          style={{
            fontSize: 76,
            fontWeight: 300,
            lineHeight: 1.08,
            letterSpacing: "-0.02em",
            color: THEME.foreground
          }}
        >
          {title}
        </div>
        {description ? (
          <div
            style={{
              fontSize: 32,
              lineHeight: 1.35,
              color: "rgba(255,255,255,0.7)"
            }}
          >
            {description}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The design system's Dark values for a post's Open Graph image. Satori reads
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
 * A post's Open Graph image: the post's Cover, drawn from its slug, on the
 * right, and on the left the site and the blog in Geist Mono over its title
 * in Funnel Display.
 */
export async function renderPostOgImage(props: {
  slug: string;
  title: string;
  date: string;
}) {
  const { display, mono } = await loadOgFonts();
  const cover = coverLayout(props.slug, OG_COVER);
  const k = OG_SCALE;
  // A block that bleeds off the bottom runs to the image's bottom edge.
  const bottom = (b: { y: number; h: number }) =>
    b.y + b.h >= cover.height ? OG_SIZE.height - b.y * k : b.h * k;
  const c = OG_COVER_COLOURS;
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
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: c.muted
          }}
        >
          <div style={{ width: 10, height: 10, backgroundColor: c.accent }} />
          <span>{`${siteName} blog`}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div
            style={{
              fontFamily: "Funnel Display",
              fontSize: props.title.length > 32 ? 60 : 68,
              fontWeight: 500,
              lineHeight: 1.04,
              letterSpacing: "-0.02em",
              color: c.ink
            }}
          >
            {props.title}
          </div>
          <div
            style={{
              fontFamily: "Geist Mono",
              fontSize: 20,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: c.muted
            }}
          >
            {props.date}
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
