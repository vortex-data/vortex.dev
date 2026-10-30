// SPDX-FileCopyrightText: Copyright the Vortex contributors
// SPDX-FileCopyrightText: Copyright Google LLC
// SPDX-License-Identifier: Apache-2.0

// Material Symbols Sharp, outline, weight 400 (Apache-2.0): the Vortex design
// system's icon set. Each path is copied from google/material-design-icons at
// commit bd8cb85, `symbols/web/<name>/materialsymbolssharp/<name>_24px.svg`,
// and a filled form from `<name>_fill1_24px.svg`, for a pressed control only.
// Add an icon from the same path; never redraw one, and never use a text glyph.

type IconProps = { className?: string | undefined };

// One symbol: `className` is for the system's CSS that picks an icon by class,
// as `.vx-copy` swaps `is-copy` for `is-check`.
function MaterialSymbol({ d, className }: IconProps & { d: string }) {
  return (
    <svg className={className} viewBox="0 -960 960 960" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

/** `star`: the repository's star count. */
export function StarIcon({ className }: IconProps) {
  return (
    <MaterialSymbol
      className={className}
      d={
        "m354-287 126-76 126 77-33-144 111-96-146-13-58-136-58 135-146 13 111 97-33 143ZM233-120l65-281L80-590l288-25 112-265 112 265 288 25-218 189 65 281-247-149-247 149Zm247-350Z"
      }
    />
  );
}

/** `content_copy`: a copy button at rest. */
export function ContentCopyIcon({ className }: IconProps) {
  return (
    <MaterialSymbol
      className={className}
      d={
        "M280-240v-640h520v640H280Zm80-80h360v-480H360v480ZM120-80v-640h80v560h440v80H120Zm240-240v-480 480Z"
      }
    />
  );
}

/** `check`: a copy button for 1.5s after a successful copy. */
export function CheckIcon({ className }: IconProps) {
  return (
    <MaterialSymbol
      className={className}
      d={"M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z"}
    />
  );
}

/** `open_in_new`: a source line's link to the page a figure was read from. */
export function OpenInNewIcon({ className }: IconProps) {
  return (
    <MaterialSymbol
      className={className}
      d={
        "M120-120v-720h360v80H200v560h560v-280h80v360H120Zm268-212-56-56 372-372H560v-80h280v280h-80v-144L388-332Z"
      }
    />
  );
}

/** `arrow_outward`: a blog index row that links to a post on another site. */
export function ArrowOutwardIcon({ className }: IconProps) {
  return (
    <MaterialSymbol
      className={className}
      d={"m256-240-56-56 384-384H240v-80h480v480h-80v-344L256-240Z"}
    />
  );
}

/** `light_mode`: the ThemeSwitch's Light choice. */
export function LightModeIcon({ className }: IconProps) {
  return (
    <MaterialSymbol
      className={className}
      d={
        "M480-360q50 0 85-35t35-85q0-50-35-85t-85-35q-50 0-85 35t-35 85q0 50 35 85t85 35Zm0 80q-83 0-141.5-58.5T280-480q0-83 58.5-141.5T480-680q83 0 141.5 58.5T680-480q0 83-58.5 141.5T480-280ZM200-440H40v-80h160v80Zm720 0H760v-80h160v80ZM440-760v-160h80v160h-80Zm0 720v-160h80v160h-80ZM256-650l-101-97 57-59 96 100-52 56Zm492 496-97-101 53-55 101 97-57 59Zm-98-550 97-101 59 57-100 96-56-52ZM154-212l101-97 55 53-97 101-59-57Zm326-268Z"
      }
    />
  );
}

/** `dark_mode`: the ThemeSwitch's Dark choice. */
export function DarkModeIcon({ className }: IconProps) {
  return (
    <MaterialSymbol
      className={className}
      d={
        "M480-120q-150 0-255-105T120-480q0-150 105-255t255-105q14 0 27.5 1t26.5 3q-41 29-65.5 75.5T444-660q0 90 63 153t153 63q55 0 101-24.5t75-65.5q2 13 3 26.5t1 27.5q0 150-105 255T480-120Zm0-80q88 0 158-48.5T740-375q-20 5-40 8t-40 3q-123 0-209.5-86.5T364-660q0-20 3-40t8-40q-78 32-126.5 102T200-480q0 116 82 198t198 82Zm-10-270Z"
      }
    />
  );
}

/** `contrast`: the ThemeSwitch's System choice. */
export function ContrastIcon({ className }: IconProps) {
  return (
    <MaterialSymbol
      className={className}
      d={
        "M480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm40-83q119-15 199.5-104.5T800-480q0-123-80.5-212.5T520-797v634Z"
      }
    />
  );
}

/** `info`: a Callout that holds a note, such as a post's aside. */
export function InfoIcon({ className }: IconProps) {
  return (
    <MaterialSymbol
      className={className}
      d={
        "M440-280h80v-240h-80v240Zm40-320q17 0 28.5-11.5T520-640q0-17-11.5-28.5T480-680q-17 0-28.5 11.5T440-640q0 17 11.5 28.5T480-600Zm0 520q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z"
      }
    />
  );
}

/** `warning`: a Callout for something that went wrong. */
export function WarningIcon({ className }: IconProps) {
  return (
    <MaterialSymbol
      className={className}
      d={
        "m40-120 440-760 440 760H40Zm138-80h604L480-720 178-200Zm302-40q17 0 28.5-11.5T520-280q0-17-11.5-28.5T480-320q-17 0-28.5 11.5T440-280q0 17 11.5 28.5T480-240Zm-40-120h80v-200h-80v200Zm40-100Z"
      }
    />
  );
}

/** `arrow_back`: a post's link back to the blog. */
export function ArrowBackIcon({ className }: IconProps) {
  return (
    <MaterialSymbol
      className={className}
      d={"m313-440 224 224-57 56-320-320 320-320 57 56-224 224h487v80H313Z"}
    />
  );
}

/** `pause`: the logo banner's pause control at rest. */
export function PauseIcon({ className }: IconProps) {
  return (
    <MaterialSymbol
      className={className}
      d={
        "M520-200v-560h240v560H520Zm-320 0v-560h240v560H200Zm400-80h80v-400h-80v400Zm-320 0h80v-400h-80v400Zm0-400v400-400Zm320 0v400-400Z"
      }
    />
  );
}

/** `pause`, filled: the logo banner's pause control while pressed. */
export function PauseFillIcon({ className }: IconProps) {
  return (
    <MaterialSymbol
      className={className}
      d={"M560-200v-560h160v560H560Zm-320 0v-560h160v560H240Z"}
    />
  );
}
