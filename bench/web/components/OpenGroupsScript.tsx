// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

/**
 * The pre-paint bootstrap for the landing page's open groups: it opens the
 * groups the URL fragment lists before the browser first paints them, so a
 * reload, Back from a chart page or a shared link shows those groups open at
 * once, with no flash of folded rows. The scroll is not the browser's: once
 * the open groups' bodies mount, `LandingState` restores it by element
 * (`lib/scroll-restore.ts`).
 *
 * It is a constant ES5 string with nothing interpolated into it. Its only
 * input is `location.hash`. It first builds two lookups from the group
 * sections, each keeping the first section per key: the section `id` (the
 * readable anchor) and its `data-group-slug` (the opaque slug the first
 * permalinks carried). Keys carry a `:` prefix, so a token such as
 * `__proto__` or `constructor` never reads an `Object.prototype` member. It
 * then splits the fragment on `,`, decodes each token in its own `try` (a
 * malformed token is skipped), skips empty and repeated tokens, and looks the
 * token up as an anchor and then, failing that, as a slug. It never builds a
 * selector or markup from the fragment. For a match it sets `open` on that
 * section's `details.group-disclosure`. This is exactly what
 * `openGroupsFromHash` in `lib/open-groups.ts` does after hydration;
 * `OpenGroupsScript.test.tsx` pins the two together. The work is linear in
 * the fragment's length, and the DOM work is bounded by the number of
 * sections, so a crafted multi-megabyte fragment cannot stall the first
 * paint. The outer `try` keeps any failure from reaching the page: without
 * it, the groups simply open after hydration instead.
 *
 * Kept as one line so the shipped bytes are what this file shows. Readable:
 *
 *   var t = location.hash.slice(1).split(','),
 *       s = document.querySelectorAll('section[data-group-slug][id]'),
 *       a = {}, b = {}, u = {}, i, k, m, d;
 *   for (i = 0; i < s.length; i++) {
 *     k = ':' + s[i].id;
 *     if (!a[k]) a[k] = s[i];
 *     k = ':' + s[i].getAttribute('data-group-slug');
 *     if (!b[k]) b[k] = s[i];
 *   }
 *   for (i = 0; i < t.length; i++) {
 *     try { k = decodeURIComponent(t[i]); } catch (e) { continue; }
 *     if (!k) continue;
 *     k = ':' + k;
 *     if (u[k]) continue;
 *     u[k] = 1;
 *     m = a[k] || b[k];
 *     d = m && m.querySelector('details.group-disclosure');
 *     if (d) d.open = true;
 *   }
 */
export const OPEN_GROUPS_BOOTSTRAP =
  '(function(){try{' +
  'var t=location.hash.slice(1).split(","),' +
  's=document.querySelectorAll("section[data-group-slug][id]"),' +
  'a={},b={},u={},i,k,m,d;' +
  'for(i=0;i<s.length;i++){' +
  'k=":"+s[i].id;if(!a[k])a[k]=s[i];' +
  'k=":"+s[i].getAttribute("data-group-slug");if(!b[k])b[k]=s[i]}' +
  'for(i=0;i<t.length;i++){' +
  'try{k=decodeURIComponent(t[i])}catch(e){continue}' +
  'if(!k)continue;' +
  'k=":"+k;' +
  'if(u[k])continue;' +
  'u[k]=1;' +
  'm=a[k]||b[k];' +
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
