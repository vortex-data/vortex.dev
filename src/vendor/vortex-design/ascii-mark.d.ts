// Types for ascii-mark.js, shipped beside it.

export type AsciiMarkOptions = {
  /** The character grid's font, as for CanvasRenderingContext2D.font. */
  font?: string;
  size?: number;
  lineHeight?: number;
  /** Brush reach in px. */
  patch?: number;
  /** Follow the pointer. */
  lean?: boolean;
  /** The symbol image for the static mode. */
  fallbackSrc?: string | null;
  /** "static" draws the still symbol whatever the browser can do. */
  mode?: "auto" | "static";
  /** A three.js module the site bundles. */
  three?: unknown;
  threeUrl?: string;
  exposure?: number;
  /** Draw the dot field around the mark (true). Pass false over a DotField, so the dots do not double. */
  field?: boolean;
};

export type AsciiMark = { mode: "live" | "reduced" | "static"; destroy(): void };

export function mountAsciiMark(host: HTMLElement, opts?: AsciiMarkOptions): Promise<AsciiMark>;
