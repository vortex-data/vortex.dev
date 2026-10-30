import { coverFor } from "@/vendor/vortex-design/cover.js";

/**
 * The design system's Cover for a post, drawn from its slug at build time:
 * inline SVG coloured by the system's CSS, so it follows the theme and needs
 * no JavaScript. `coverFor` never writes the seed into the markup.
 */
export function PostCover({
  slug,
  className
}: {
  slug: string;
  className?: string;
}) {
  return (
    <div
      className={className ? `vx-cover ${className}` : "vx-cover"}
      // coverFor's SVG is built from fixed parts and numbers only.
      dangerouslySetInnerHTML={{ __html: coverFor(slug) }}
    />
  );
}
