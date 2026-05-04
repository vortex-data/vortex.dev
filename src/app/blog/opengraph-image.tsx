import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "@/lib/og";

export const alt = "Vortex Blog";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function OgImage() {
  return renderOgImage({
    title: "Blog",
    description: "Updates and insights from the Vortex team."
  });
}
