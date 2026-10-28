// Material Symbols Sharp, outline, weight 400 (Apache-2.0): the Vortex design
// system's icon set. Each path is copied from google/material-design-icons at
// commit bd8cb85, `symbols/web/<name>/materialsymbolssharp/<name>_24px.svg`.
// Add an icon from the same path; never redraw one, and never use a text glyph.

function icon(d: string) {
  // `className` is for the system's CSS that picks an icon by class, as
  // `.vx-copy` swaps `is-copy` for `is-check`.
  return function Icon({ className }: { className?: string }) {
    return (
      <svg className={className} viewBox="0 -960 960 960" aria-hidden="true">
        <path d={d} />
      </svg>
    );
  };
}

/** `star`: the repository's star count. */
export const StarIcon = icon(
  "m354-287 126-76 126 77-33-144 111-96-146-13-58-136-58 135-146 13 111 97-33 143ZM233-120l65-281L80-590l288-25 112-265 112 265 288 25-218 189 65 281-247-149-247 149Zm247-350Z"
);

/** `content_copy`: a copy button at rest. */
export const ContentCopyIcon = icon(
  "M280-240v-640h520v640H280Zm80-80h360v-480H360v480ZM120-80v-640h80v560h440v80H120Zm240-240v-480 480Z"
);

/** `check`: a copy button for 1.5s after a successful copy. */
export const CheckIcon = icon(
  "M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z"
);
