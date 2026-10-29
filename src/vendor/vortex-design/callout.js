// Which Markdown blockquotes become a Callout. DOM-free: a renderer passes the text a blockquote
// opens with, and gets back the Callout's kind, its title and the text that is left, or null for a
// plain quote. Only the marker goes, so the rest keeps the space before any inline element after it.
//
// - A GitHub alert ("> [!NOTE]" alone on the first line) takes the alert's title. NOTE, TIP and
//   IMPORTANT are `info`. WARNING and CAUTION are `warning`.
// - A blockquote that opens with an emoji ("> 💡 …") is a Callout with no title. The icon takes the
//   emoji's place: `warning` for ⚠️ and 🚨, else `info`.
// - Any other blockquote stays a quote.
const ALERTS = {
  NOTE: ["info", "Note"],
  TIP: ["info", "Tip"],
  IMPORTANT: ["info", "Important"],
  WARNING: ["warning", "Warning"],
  CAUTION: ["warning", "Caution"],
};
const ALERT = /^\s*\[!(\w+)\][ \t]*(?:\r?\n|$)/;
const EMOJI = /^\s*(\p{Extended_Pictographic})(?:️|‍\p{Extended_Pictographic})*\s*/u;
const WARNING_EMOJI = new Set(["⚠", "\u{1F6A8}"]);

/** @returns {{ kind: "info" | "warning", title: string | null, rest: string } | null} */
export function calloutOf(text) {
  const alert = text.match(ALERT);
  if (alert) {
    const found = ALERTS[alert[1].toUpperCase()];
    if (!found) return null;
    return { kind: found[0], title: found[1], rest: text.slice(alert[0].length) };
  }
  const emoji = text.match(EMOJI);
  if (emoji) return { kind: WARNING_EMOJI.has(emoji[1]) ? "warning" : "info", title: null, rest: text.slice(emoji[0].length) };
  return null;
}
