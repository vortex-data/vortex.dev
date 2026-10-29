// Types for callout.js, shipped beside it.

export interface CalloutMatch {
  /** The icon: `info` for a note, `warning` for something that can go wrong. */
  kind: "info" | "warning";
  /** The alert's title, or null for an emoji-led aside. */
  title: string | null;
  /** The text after the marker. */
  rest: string;
}

export function calloutOf(text: string): CalloutMatch | null;
