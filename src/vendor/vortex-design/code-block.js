// The CodeBlock card's rules for a highlighter. DOM-free.
//
// `shikiTheme` is a Shiki theme (it also serves rehype-pretty-code) whose every colour is one of the
// syntax-* tokens, so code follows Light and Dark with the page. It sets no background: the block
// sits on CodeBlock's `raised`. TextMate gives a token the rule that matches its innermost scope,
// so the operator and punctuation rules win inside keywords and constants, and strings and comments
// keep their own quotes and markers.
//
// `codeLabel(lang)` is the label in the block's head row: the language as its owners spell it, and
// "Text" for a block with no language or plain text.

const PLAIN = "var(--syntax-plain)";
const KEYWORD = "var(--syntax-keyword)";
const FUNCTION = "var(--syntax-function)";
const STRING = "var(--syntax-string)";
const COMMENT = "var(--syntax-comment)";

export const shikiTheme = {
  name: "vortex",
  type: "dark",
  colors: { "editor.foreground": PLAIN },
  tokenColors: [
    { scope: ["keyword", "storage.type", "storage.modifier", "variable.language"], settings: { foreground: KEYWORD } },
    { scope: ["keyword.operator", "punctuation"], settings: { foreground: PLAIN } },
    {
      scope: ["entity.name.function", "support.function", "entity.name.type", "entity.name.class", "support.type", "support.class", "entity.other.inherited-class"],
      settings: { foreground: FUNCTION },
    },
    { scope: ["string", "constant", "punctuation.definition.string", "punctuation.definition.char", "markup.inline.raw"], settings: { foreground: STRING } },
    { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: COMMENT, fontStyle: "italic" } },
  ],
};

const LANGUAGES = {
  bash: "Shell",
  c: "C",
  cpp: "C++",
  java: "Java",
  javascript: "JavaScript",
  js: "JavaScript",
  json: "JSON",
  py: "Python",
  python: "Python",
  rust: "Rust",
  rs: "Rust",
  sh: "Shell",
  shell: "Shell",
  sql: "SQL",
  toml: "TOML",
  ts: "TypeScript",
  typescript: "TypeScript",
  yaml: "YAML",
  yml: "YAML",
};

export function codeLabel(lang) {
  if (!lang || /^(plain)?(te?xt)?$/i.test(lang)) return "Text";
  return LANGUAGES[lang.toLowerCase()] ?? lang;
}
