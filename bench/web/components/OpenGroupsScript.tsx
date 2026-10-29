// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

/**
 * The pre-paint bootstrap for the landing page's open groups: it opens the
 * groups the URL fragment lists before the browser first paints them, so a
 * reload, Back from a chart page or a shared link shows those groups open at
 * once, with no flash of collapsed groups. The scroll is not the browser's: once
 * the open groups' bodies mount, `LandingState` restores it by element
 * (`lib/scroll-restore.ts`).
 *
 * It is a constant ES5 string with nothing interpolated into it. The only
 * data it reads is `location.hash` (its input listeners, below, record only
 * that input happened). It first builds two lookups from the group
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
 * paint.
 *
 * Last, it leaves a marker on its document for [`LandingState`]
 * (`takeOpenGroupsBootstrap` in `lib/open-groups.ts`):
 * `document.__benchOpenGroups`, an object whose `input` turns true at the
 * reader's first `wheel`, `touchstart`, `keydown` or `pointerdown` (one-shot
 * passive capture listeners on the window; `stop` removes them). After hydration,
 * `LandingState` takes the marker on its first mount. It then keeps the open
 * state as the reader left it (a group opened or closed before hydration
 * stays so, and the fragment is written from it), and when `input` is true
 * it does not scroll the page at all: no restore, no scroll to the fragment's
 * first group. A scroll is not input: the browser's own jump
 * to a single-anchor fragment fires one. The marker is written only after
 * the groups are open, and the outer `try` keeps any failure from reaching the
 * page: without the marker, the groups simply open after hydration instead.
 *
 * Kept as one line so the shipped bytes are what this file shows. Readable:
 *
 *   var t = location.hash.slice(1).split(','),
 *       s = document.querySelectorAll('section[data-group-slug][id]'),
 *       a = {}, b = {}, u = {}, i, k, m, d, g, h,
 *       n = ['wheel', 'touchstart', 'keydown', 'pointerdown'];
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
 *   g = document.__benchOpenGroups = {
 *     input: false,
 *     stop: function () {
 *       for (var j = 0; j < n.length; j++) removeEventListener(n[j], h, true);
 *     }
 *   };
 *   h = function () { g.input = true; g.stop(); };
 *   for (i = 0; i < n.length; i++) {
 *     addEventListener(n[i], h, { capture: true, passive: true });
 *   }
 */
export const OPEN_GROUPS_BOOTSTRAP =
  '(function(){try{' +
  'var t=location.hash.slice(1).split(","),' +
  's=document.querySelectorAll("section[data-group-slug][id]"),' +
  'a={},b={},u={},i,k,m,d,g,h,' +
  'n=["wheel","touchstart","keydown","pointerdown"];' +
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
  'g=document.__benchOpenGroups={input:false,stop:function(){' +
  'for(var j=0;j<n.length;j++)removeEventListener(n[j],h,true)}};' +
  'h=function(){g.input=true;g.stop()};' +
  'for(i=0;i<n.length;i++)addEventListener(n[i],h,{capture:true,passive:true})' +
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
 * to `/` skips this and leaves no marker; `LandingState` opens the groups
 * from the fragment then.
 */
export function OpenGroupsScript() {
  return (
    <script
      data-role="open-groups-bootstrap"
      dangerouslySetInnerHTML={{ __html: OPEN_GROUPS_BOOTSTRAP }}
    />
  );
}
