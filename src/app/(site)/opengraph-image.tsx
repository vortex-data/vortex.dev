import { siteName } from "@/lib/constants";
import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from "@/lib/og";

export const alt = "Vortex, the frontier file format.";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

// What Vortex is, over the homepage's standfirst, in the homepage's mono
// voice. The card does not repeat the homepage's headline.
export default function OgImage() {
  return renderOgCard({
    seed: "home",
    eyebrow: siteName,
    title: ["The frontier", "file format"],
    face: "mono",
    foot: "An open-source columnar file format for fast scans, random access, and compression."
  });
}
