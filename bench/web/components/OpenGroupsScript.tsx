// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

/**
 * The pre-paint bootstrap for the landing page's open groups: it opens the
 * groups the URL fragment lists before the browser first paints them, so a
 * reload, Back from a chart page or a shared link shows those groups open at
 * once, with no flash of folded rows, and the browser's scroll restoration
 * lands against the full page.
 *
 * It is a constant ES5 string with nothing interpolated into it. Its only
 * input is `location.hash`. It splits the fragment on `,`, decodes each token
 * in its own `try` (a malformed token is skipped), and compares each token by
 * string equality with each group section's `id` (the readable anchor), then,
 * for a token no anchor matched, with its `data-group-slug` (the opaque slug
 * the first permalinks carried). It never builds a selector or markup from the
 * fragment. For a match it sets `open` on that section's
 * `details.group-disclosure`. This is exactly what `openGroupsFromHash` in
 * `lib/open-groups.ts` does after hydration; `OpenGroupsScript.test.tsx` pins
 * the two together. The outer `try` keeps any failure from reaching the page:
 * without it, the groups simply open after hydration instead.
 *
 * Kept as one line so the shipped bytes are what this file shows. Readable:
 *
 *   var t = location.hash.slice(1).split(','),
 *       s = document.querySelectorAll('section[data-group-slug][id]'), i, j, k, m, d;
 *   for (i = 0; i < t.length; i++) {
 *     try { k = decodeURIComponent(t[i]); } catch (e) { continue; }
 *     if (!k) continue;
 *     m = null;
 *     for (j = 0; j < s.length && !m; j++) if (s[j].id === k) m = s[j];
 *     for (j = 0; j < s.length && !m; j++) if (s[j].getAttribute('data-group-slug') === k) m = s[j];
 *     d = m && m.querySelector('details.group-disclosure');
 *     if (d) d.open = true;
 *   }
 */
export const OPEN_GROUPS_BOOTSTRAP =
  '(function(){try{' +
  'var t=location.hash.slice(1).split(","),' +
  's=document.querySelectorAll("section[data-group-slug][id]"),i,j,k,m,d;' +
  'for(i=0;i<t.length;i++){' +
  'try{k=decodeURIComponent(t[i])}catch(e){continue}' +
  'if(!k)continue;' +
  'm=null;' +
  'for(j=0;j<s.length&&!m;j++)if(s[j].id===k)m=s[j];' +
  'for(j=0;j<s.length&&!m;j++)if(s[j].getAttribute("data-group-slug")===k)m=s[j];' +
  'd=m&&m.querySelector("details.group-disclosure");' +
  'if(d)d.open=true}' +
  '}catch(e){}})();';

/**
 * Renders [`OPEN_GROUPS_BOOTSTRAP`] as an inline script. The landing page
 * places it right after the last group section, inside `<main>`, so it runs
 * as soon as the groups' markup has parsed, in whatever streamed chunk
 * carries them, and before they paint. The script adds `open` to a
 * server-rendered `<details>`, which is why `GroupSection`'s disclosure
 * carries `suppressHydrationWarning`.
 *
 * React never runs a script it renders on the client, so a client navigation
 * to `/` skips this; `LandingState` opens the groups from the fragment then.
 */
export function OpenGroupsScript() {
  return (
    <script
      data-role="open-groups-bootstrap"
      dangerouslySetInnerHTML={{ __html: OPEN_GROUPS_BOOTSTRAP }}
    />
  );
}
