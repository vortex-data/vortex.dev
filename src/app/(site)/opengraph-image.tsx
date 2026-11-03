import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "@/lib/og";

export const alt = "Vortex — an extensible, SOTA columnar file format";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function OgImage() {
  return renderOgImage({
    title: "An extensible, SOTA columnar file format",
    description:
      "Tools for working with compressed Apache Arrow arrays in-memory, on-disk, and over-the-wire."
  });
}
