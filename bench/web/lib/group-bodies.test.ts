// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { beforeEach, describe, expect, it } from 'vitest';

import { getGroupSnapshot, initGroupFilter, toggleGroupSeries } from './chart-store';
import {
  type GroupBodiesReady,
  groupBodiesReady,
  noteGroupBodyOpen,
  resetGroupBodies,
  seedGroupFilterOnce,
} from './group-bodies';

/** Drain every pending microtask (and promise chain) before asserting. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Record which of `ready`'s promises have resolved, in order. */
function track(ready: GroupBodiesReady): string[] {
  const fired: string[] = [];
  void ready.mounted.then(() => fired.push('mounted'));
  void ready.settled.then(() => fired.push('settled'));
  return fired;
}

describe('groupBodiesReady', () => {
  beforeEach(() => {
    resetGroupBodies();
  });

  it('resolves mounted once every listed group has noted its body, and settled after their bundles', async () => {
    const fired = track(groupBodiesReady(['a', 'b']));
    noteGroupBodyOpen('a', Promise.resolve());
    await flush();
    expect(fired).toEqual([]);

    let resolveB!: () => void;
    noteGroupBodyOpen(
      'b',
      new Promise<void>((resolve) => {
        resolveB = resolve;
      }),
    );
    await flush();
    expect(fired).toEqual(['mounted']);

    resolveB();
    await flush();
    expect(fired).toEqual(['mounted', 'settled']);
  });

  it('treats a failed bundle as settled', async () => {
    const fired = track(groupBodiesReady(['a']));
    let rejectA!: (err: unknown) => void;
    noteGroupBodyOpen(
      'a',
      new Promise<void>((_resolve, reject) => {
        rejectA = reject;
      }),
    );
    await flush();
    expect(fired).toEqual(['mounted']);

    rejectA(new Error('bundle failed'));
    await flush();
    expect(fired).toEqual(['mounted', 'settled']);
  });

  it('resolves at once for no groups, and counts notes made before the call', async () => {
    const none = track(groupBodiesReady([]));
    await flush();
    expect(none).toEqual(['mounted', 'settled']);

    noteGroupBodyOpen('a', Promise.resolve());
    const early = track(groupBodiesReady(['a']));
    await flush();
    expect(early).toEqual(['mounted', 'settled']);
  });
});

describe('seedGroupFilterOnce', () => {
  beforeEach(() => {
    resetGroupBodies();
    initGroupFilter('g', [], []);
  });

  it("seeds a group's filter once per page load", () => {
    seedGroupFilterOnce('g', ['a'], []);
    expect(getGroupSnapshot('g').hiddenSeries).toEqual(['a']);

    toggleGroupSeries('g', 'a');
    seedGroupFilterOnce('g', ['a'], []);
    expect(getGroupSnapshot('g').hiddenSeries).toEqual([]);
  });
});
