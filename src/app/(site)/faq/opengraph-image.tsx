import { siteName } from "@/lib/constants";
import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from "@/lib/og";

export const alt = "Vortex FAQ";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function OgImage() {
  return renderOgCard({
    seed: "faq",
    eyebrow: siteName,
    title: ["FAQ"],
    face: "display",
    foot: "Common questions about Vortex, the open-source columnar file format."
  });
}
