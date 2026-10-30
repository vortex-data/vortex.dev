// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import type { ReactNode } from 'react';

/**
 * The pre-paint bootstrap for the landing page's open groups: it opens the
 * groups the URL fragment lists before the browser first paints them, so a
 * reload, Back from a chart page or a shared link shows those groups open at
 * once, with no flash of collapsed groups. The scroll is not the browser's: once
 * the open groups' bodies mount, `LandingState` restores it by element
 * (`lib/scroll-restore.ts`).
 *
 * The groups are visible HTML as they arrive, and on a slow connection the
 * browser paints the first ones before the rest have arrived. So the script
 * runs before the first group, and opens each listed group as soon as the
 * parser has inserted it: a `MutationObserver` callback runs at the end of the
 * parser task that inserted the nodes, before the browser can paint them.
 * [`OPEN_GROUPS_FINISH`], after the last group, ends the work.
 *
 * It is a constant ES5 string with nothing interpolated into it. The only
 * data it reads is `location.hash` (its input listeners, below, record only
 * that input happened). It splits the fragment on `,`, decodes each token in
 * its own `try` (a malformed token is skipped), and keeps each nonempty token
 * once, with a `:` prefix, so a token such as `__proto__` or `constructor`
 * never reads an `Object.prototype` member. It never builds a selector or
 * markup from the fragment.
 *
 * Then it visits the group sections in page order, each once, as they
 * arrive. A section whose `id` (the readable anchor) the fragment lists gets
 * `open` on its `details.group-disclosure`, if it is the first section with
 * that `id`; a visit that finds no disclosure yet waits for the next
 * mutation. It also keeps the first section per `data-group-slug` (the
 * opaque slug the first permalinks carried). At the end, the finish step
 * visits any section not yet visited, then opens, for each listed token that
 * names no section's anchor, the first section with that slug. A slug token
 * waits for the end because a later section could still carry it as an
 * anchor. This is exactly what `openGroupsFromHash` in `lib/open-groups.ts`
 * does after hydration; `OpenGroupsScript.test.tsx` pins the two together.
 * The work is linear in the fragment's length, and the DOM work is bounded by
 * the number of sections, so a crafted multi-megabyte fragment cannot stall
 * the first paint.
 *
 * Last, the finish step leaves a marker on its document for [`LandingState`]
 * (`takeOpenGroupsBootstrap` in `lib/open-groups.ts`):
 * `document.__benchOpenGroups`, an object whose `input` turns true at the
 * reader's first `wheel`, `touchstart`, `keydown` or `pointerdown` (one-shot
 * passive capture listeners on the window, added before the first group;
 * `stop` removes them). After hydration, `LandingState` takes the marker on
 * its first mount. It then keeps the open state as the reader left it (a
 * group opened or closed before hydration stays so, even while the page was
 * still arriving, and the fragment is written from it), and when `input` is
 * true it does not scroll the page at all: no restore, no scroll to the
 * fragment's first group. A scroll is not input: the browser's own jump to a
 * single-anchor fragment fires one. The marker is written only after the
 * groups are open, and each script's outer `try` keeps any failure from
 * reaching the page: without the marker, the groups simply open after
 * hydration instead.
 *
 * Kept as one line so the shipped bytes are what this file shows. Readable:
 *
 *   var t = location.hash.slice(1).split(','),
 *       w = {}, p = [], a = {}, b = {}, j = 0, i, k, o, g, h, v,
 *       n = ['wheel', 'touchstart', 'keydown', 'pointerdown'];
 *   for (i = 0; i < t.length; i++) {
 *     try { k = decodeURIComponent(t[i]); } catch (e) { continue; }
 *     if (!k) continue;
 *     k = ':' + k;
 *     if (w[k]) continue;
 *     w[k] = 1;
 *     p.push(k);
 *   }
 *   // Visit the sections not yet visited; `z` is the finish step.
 *   v = function (z) {
 *     var l = document.querySelectorAll('section[data-group-slug][id]'), s, d, c;
 *     for (; j < l.length; j++) {
 *       s = l[j];
 *       c = ':' + s.id;
 *       if (w[c] && !a[c]) {
 *         d = s.querySelector('details.group-disclosure');
 *         if (!d && !z) return;
 *         if (d) d.open = true;
 *       }
 *       a[c] = 1;
 *       c = ':' + s.getAttribute('data-group-slug');
 *       if (!b[c]) b[c] = s;
 *     }
 *   };
 *   g = {
 *     input: false,
 *     stop: function () {
 *       for (var m = 0; m < n.length; m++) removeEventListener(n[m], h, true);
 *     }
 *   };
 *   h = function () { g.input = true; g.stop(); };
 *   for (i = 0; i < n.length; i++) {
 *     addEventListener(n[i], h, { capture: true, passive: true });
 *   }
 *   // The finish step exists before the observer does: if creating the
 *   // observer fails, the finish step still opens every listed group.
 *   document.__benchOpenGroupsEnd = function () {
 *     var m, d;
 *     document.__benchOpenGroupsEnd = null;
 *     if (o) o.disconnect();
 *     if (p.length) {
 *       v(1);
 *       for (m = 0; m < p.length; m++) {
 *         k = p[m];
 *         if (!a[k] && b[k]) {
 *           d = b[k].querySelector('details.group-disclosure');
 *           if (d) d.open = true;
 *         }
 *       }
 *     }
 *     document.__benchOpenGroups = g;
 *   };
 *   // A fragment that lists nothing has nothing to open: no observer.
 *   if (p.length) {
 *     o = new MutationObserver(function () { try { v(0); } catch (e) {} });
 *     o.observe(document, { childList: true, subtree: true });
 *   }
 */
export const OPEN_GROUPS_BOOTSTRAP =
  '(function(){try{' +
  'var t=location.hash.slice(1).split(","),' +
  'w={},p=[],a={},b={},j=0,i,k,o,g,h,v,' +
  'n=["wheel","touchstart","keydown","pointerdown"];' +
  'for(i=0;i<t.length;i++){' +
  'try{k=decodeURIComponent(t[i])}catch(e){continue}' +
  'if(!k)continue;' +
  'k=":"+k;' +
  'if(w[k])continue;' +
  'w[k]=1;' +
  'p.push(k)}' +
  'v=function(z){' +
  'var l=document.querySelectorAll("section[data-group-slug][id]"),s,d,c;' +
  'for(;j<l.length;j++){' +
  's=l[j];' +
  'c=":"+s.id;' +
  'if(w[c]&&!a[c]){' +
  'd=s.querySelector("details.group-disclosure");' +
  'if(!d&&!z)return;' +
  'if(d)d.open=true}' +
  'a[c]=1;' +
  'c=":"+s.getAttribute("data-group-slug");' +
  'if(!b[c])b[c]=s}};' +
  'g={input:false,stop:function(){' +
  'for(var m=0;m<n.length;m++)removeEventListener(n[m],h,true)}};' +
  'h=function(){g.input=true;g.stop()};' +
  'for(i=0;i<n.length;i++)addEventListener(n[i],h,{capture:true,passive:true});' +
  'document.__benchOpenGroupsEnd=function(){' +
  'var m,d;' +
  'document.__benchOpenGroupsEnd=null;' +
  'if(o)o.disconnect();' +
  'if(p.length){' +
  'v(1);' +
  'for(m=0;m<p.length;m++){' +
  'k=p[m];' +
  'if(!a[k]&&b[k]){' +
  'd=b[k].querySelector("details.group-disclosure");' +
  'if(d)d.open=true}}}' +
  'document.__benchOpenGroups=g};' +
  'if(p.length){' +
  'o=new MutationObserver(function(){try{v(0)}catch(e){}});' +
  'o.observe(document,{childList:true,subtree:true})}' +
  '}catch(e){}})();';

/**
 * The finish step of [`OPEN_GROUPS_BOOTSTRAP`], after the last group: it
 * visits the sections the observer has not reached, opens the groups listed by
 * slug, stops the observer and leaves the marker. When the bootstrap failed it
 * finds no finish step, and its `try` swallows that: no marker is left.
 */
export const OPEN_GROUPS_FINISH = '(function(){try{document.__benchOpenGroupsEnd()}catch(e){}})();';

/**
 * Wraps the landing page's group sections in [`OPEN_GROUPS_BOOTSTRAP`], as an
 * inline script before the first section, and [`OPEN_GROUPS_FINISH`], as one
 * after the last, inside `<main>`. The bootstrap runs before any group has
 * arrived and opens each listed group before it paints, in whatever streamed
 * chunk carries it; the finish step runs as soon as the last group's markup
 * has parsed. The scripts add `open` to a server-rendered `<details>`, which
 * is why `GroupSection`'s disclosure carries `suppressHydrationWarning`.
 *
 * React never runs a script it renders on the client, so a client navigation
 * to `/` skips both and leaves no marker; `LandingState` opens the groups
 * from the fragment then.
 */
export function OpenGroupsScript({ children }: { children?: ReactNode }) {
  return (
    <>
      <script
        data-role="open-groups-bootstrap"
        dangerouslySetInnerHTML={{ __html: OPEN_GROUPS_BOOTSTRAP }}
      />
      {children}
      <script
        data-role="open-groups-finish"
        dangerouslySetInnerHTML={{ __html: OPEN_GROUPS_FINISH }}
      />
    </>
  );
}
