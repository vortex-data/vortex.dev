/**
 * JSON for an inline `<script type="application/ld+json">`, on both sites.
 * `<` is escaped, so a `</script>` in a title or description cannot end the
 * script early; JSON parsers read `<` as the same character.
 */
export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data).replaceAll("<", "\\u003c");
}
