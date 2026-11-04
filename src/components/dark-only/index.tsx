import { DARK_LOCK_SCRIPT } from "@/lib/theme";
import { DarkLock } from "./lock";

/**
 * Keeps a page Dark whatever theme the reader chose: the homepage and the
 * 404, which were too bright in Light. The switch still shows and saves the
 * choice, which the blog, bench, and the docs follow. Render it ahead of the
 * page's content: its script locks the theme before what follows paints
 * (`DARK_LOCK_SCRIPT`), and `DarkLock` keeps the lock across client-side
 * navigation.
 */
export function DarkOnly() {
  return (
    <>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: a constant script that locks the theme before the page paints. */}
      <script dangerouslySetInnerHTML={{ __html: DARK_LOCK_SCRIPT }} />
      <DarkLock />
    </>
  );
}
