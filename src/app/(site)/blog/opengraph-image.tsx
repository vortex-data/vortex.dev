import { siteName } from "@/lib/constants";
import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from "@/lib/og";

export const alt = "Vortex blog";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function OgImage() {
  return renderOgCard({
    seed: "blog",
    eyebrow: siteName,
    title: ["Blog"],
    face: "display",
    foot: "Updates and insights from the Vortex team."
  });
}
