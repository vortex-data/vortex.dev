// Types for code-block.js, shipped beside it.

export interface ShikiTokenColor {
  scope: string | string[];
  settings: { foreground?: string; fontStyle?: string };
}

/** A Shiki theme drawn only with the syntax-* tokens, with no background. */
export const shikiTheme: {
  name: string;
  type: "dark";
  colors: Record<string, string>;
  tokenColors: ShikiTokenColor[];
};

/** The CodeBlock head's label: "Text" for no language or plain text, else the language's name. */
export function codeLabel(lang: string | undefined): string;
