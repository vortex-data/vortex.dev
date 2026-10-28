// Types for the design system's ascii-mark.js, from its JSDoc.

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
  /** A three.js module the site bundles. */
  three?: unknown;
  threeUrl?: string;
  exposure?: number;
};

export type AsciiMark = {
  mode: "live" | "reduced" | "static";
  destroy(): void;
};

export function mountAsciiMark(
  host: HTMLElement,
  opts?: AsciiMarkOptions
): Promise<AsciiMark>;
