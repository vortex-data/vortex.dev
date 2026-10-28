import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { syntaxTheme } from "@/lib/syntax-theme";

const tokens = readFileSync(
  new URL("../../src/styles/vortex-tokens.css", import.meta.url),
  "utf8"
);

const colors = [
  ...Object.values(syntaxTheme.colors),
  ...syntaxTheme.tokenColors.flatMap((r) =>
    r.settings.foreground ? [r.settings.foreground] : []
  )
];

// TextMate's rule for one scope: the longest selector that is a prefix of
// it at a dot.
const ruleFor = (scope: string) => {
  let best: {
    length: number;
    rule: (typeof syntaxTheme.tokenColors)[number];
  } | null = null;
  for (const rule of syntaxTheme.tokenColors)
    for (const sel of [rule.scope].flat())
      if (
        (scope === sel || scope.startsWith(`${sel}.`)) &&
        sel.length > (best?.length ?? -1)
      )
        best = { length: sel.length, rule };
  return best?.rule;
};

describe("syntaxTheme", () => {
  it("colours code only with the system's syntax-* tokens, so code follows the theme", () => {
    assert.ok(colors.length > 4);
    for (const c of colors) {
      const name = c.match(/^var\(--(syntax-[a-z]+)\)$/)?.[1];
      assert.ok(name, `${c} is a syntax token`);
      // Defined in both themes.
      assert.equal(
        tokens.match(new RegExp(`--${name}:`, "g"))?.length,
        2,
        `${name} in Dark and Light`
      );
    }
  });

  it("maps the CodeBlock card's four roles", () => {
    const colour = (scope: string) => ruleFor(scope)?.settings.foreground;
    for (const [scope, want] of [
      ["keyword.control.rust", "keyword"],
      ["storage.type.rust", "keyword"],
      ["keyword.other.DML.sql", "keyword"],
      ["entity.name.function.rust", "function"],
      ["entity.name.function.macro.rust", "function"],
      ["entity.name.type.primitive.rust", "function"],
      ["string.quoted.double.rust", "string"],
      ["punctuation.definition.string.begin.rust", "string"],
      ["constant.numeric.decimal.rust", "string"],
      ["constant.language.bool.rust", "string"],
      ["comment.line.double-slash.rust", "comment"],
      ["punctuation.definition.comment.rust", "comment"],
      ["keyword.operator.assignment.equal.rust", "plain"],
      ["punctuation.brackets.curly.rust", "plain"]
    ] as const)
      assert.equal(colour(scope), `var(--syntax-${want})`, scope);
    assert.equal(ruleFor("comment.line")?.settings.fontStyle, "italic");
  });

  it("sets plain text and no background, so the block keeps CodeBlock's raised ground", () => {
    assert.equal(
      syntaxTheme.colors["editor.foreground"],
      "var(--syntax-plain)"
    );
    assert.equal("editor.background" in syntaxTheme.colors, false);
  });
});
