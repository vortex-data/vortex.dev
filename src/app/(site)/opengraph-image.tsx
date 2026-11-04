import { siteName } from "@/lib/constants";
import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from "@/lib/og";

export const alt = "Vortex. Fast, small, open: pick three.";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

// The homepage's headline and standfirst, in the homepage's mono voice.
export default function OgImage() {
  return renderOgCard({
    seed: "home",
    eyebrow: siteName,
    title: ["Fast, small, open:", "pick three."],
    face: "mono",
    foot: "An open-source columnar file format for fast scans, random access, and compression."
  });
}
