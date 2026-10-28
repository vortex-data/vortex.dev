/**
 * A Shiki theme for rehype-pretty-code whose every colour is one of the
 * design system's `syntax-*` tokens, so a post's code follows Light and Dark
 * with the rest of the page. The roles are the CodeBlock card's: keywords,
 * functions and type names, strings, numbers and constants, and italic
 * comments, over plain text. There is no background: the block sits on
 * CodeBlock's `raised` ground.
 */

interface TokenColor {
  scope: string | string[];
  settings: { foreground?: string; fontStyle?: string };
}

const PLAIN = "var(--syntax-plain)";
const KEYWORD = "var(--syntax-keyword)";
const FUNCTION = "var(--syntax-function)";
const STRING = "var(--syntax-string)";
const COMMENT = "var(--syntax-comment)";

// TextMate gives a token the rule that matches its innermost scope, so the
// operator and punctuation rules win inside keywords and constants, and the
// string and comment rules keep their own quotes and markers.
const tokenColors: TokenColor[] = [
  {
    scope: ["keyword", "storage.type", "storage.modifier", "variable.language"],
    settings: { foreground: KEYWORD }
  },
  {
    scope: ["keyword.operator", "punctuation"],
    settings: { foreground: PLAIN }
  },
  {
    scope: [
      "entity.name.function",
      "support.function",
      "entity.name.type",
      "entity.name.class",
      "support.type",
      "support.class",
      "entity.other.inherited-class"
    ],
    settings: { foreground: FUNCTION }
  },
  {
    scope: [
      "string",
      "constant",
      "punctuation.definition.string",
      "punctuation.definition.char",
      "markup.inline.raw"
    ],
    settings: { foreground: STRING }
  },
  {
    scope: ["comment", "punctuation.definition.comment"],
    settings: { foreground: COMMENT, fontStyle: "italic" }
  }
];

export const syntaxTheme = {
  name: "vortex",
  type: "dark" as const,
  colors: { "editor.foreground": PLAIN } as Record<string, string>,
  tokenColors
};
