// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  cancelUrlWrite,
  flushUrlWrites,
  resetUrlWrites,
  scheduleUrlWrite,
  URL_WRITE_DELAY_MS,
  urlWritePending,
  writeUrlNow,
} from '@/lib/url-writes';

const setHash = (hash: string) => (url: URL) => {
  url.hash = hash;
};
const setParam = (name: string, value: string) => (url: URL) => {
  url.searchParams.set(name, value);
};

describe('coalesced URL writes', () => {
  let writes: string[];

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
    window.history.replaceState(null, '', '/?n=all');
    resetUrlWrites(window);
    writes = [];
    const replaceState = History.prototype.replaceState;
    vi.spyOn(window.history, 'replaceState').mockImplementation(function (
      this: History,
      data,
      unused,
      url,
    ) {
      writes.push(String(url));
      replaceState.call(this, data, unused, url);
    });
  });

  afterEach(() => {
    resetUrlWrites(window);
    vi.useRealTimers();
  });

  function here(): string {
    return `${window.location.pathname}${window.location.search}${window.location.hash}`;
  }

  it('writes every pending part in one call', () => {
    scheduleUrlWrite(window, 'filters', setParam('engine', 'a'));
    scheduleUrlWrite(window, 'filters', setParam('engine', 'b'));
    scheduleUrlWrite(window, 'open-groups', setHash('#g1'), { ownsHash: true });
    expect(writes).toEqual(['/?n=all&engine=a']);

    vi.advanceTimersByTime(URL_WRITE_DELAY_MS);
    expect(writes).toEqual(['/?n=all&engine=a', '/?n=all&engine=b#g1']);
    expect(here()).toBe('/?n=all&engine=b#g1');
  });

  it('shares one rate limit between the parts', () => {
    scheduleUrlWrite(window, 'open-groups', setHash('#g1'), { ownsHash: true });
    // Inside the delay after the fragment write, a filter write waits.
    vi.advanceTimersByTime(URL_WRITE_DELAY_MS - 1);
    scheduleUrlWrite(window, 'filters', setParam('format', ''));
    expect(writes).toHaveLength(1);
    vi.advanceTimersByTime(URL_WRITE_DELAY_MS);
    expect(writes).toHaveLength(2);
    expect(here()).toBe('/?n=all&format=#g1');
  });

  it('writes a part now with the other pending parts', () => {
    scheduleUrlWrite(window, 'filters', setParam('engine', 'a'));
    scheduleUrlWrite(window, 'filters', setParam('engine', 'b'));
    expect(writeUrlNow(window, 'open-groups', setHash('#g2'))).toBe(true);
    expect(here()).toBe('/?n=all&engine=b#g2');
    expect(urlWritePending(window, 'filters')).toBe(false);
  });

  it('cancels one part and keeps the other', () => {
    scheduleUrlWrite(window, 'filters', setParam('engine', 'a'));
    scheduleUrlWrite(window, 'filters', setParam('engine', 'b'));
    scheduleUrlWrite(window, 'open-groups', setHash('#g1'), { ownsHash: true });
    cancelUrlWrite(window, 'open-groups');
    expect(flushUrlWrites(window)).toBe(true);
    expect(here()).toBe('/?n=all&engine=b');
  });

  it('drops the fragment part when the fragment changed, but not the query part', () => {
    scheduleUrlWrite(window, 'filters', setParam('engine', 'a'));
    scheduleUrlWrite(window, 'filters', setParam('engine', 'b'));
    scheduleUrlWrite(window, 'open-groups', setHash('#g1'), { ownsHash: true });
    // A link changes the fragment before its `hashchange` runs.
    History.prototype.replaceState.call(window.history, null, '', '/?n=all&engine=a#typed');
    expect(flushUrlWrites(window)).toBe(true);
    expect(here()).toBe('/?n=all&engine=b#typed');
  });

  it('drops every part when the path changed', () => {
    scheduleUrlWrite(window, 'filters', setParam('engine', 'a'));
    scheduleUrlWrite(window, 'filters', setParam('engine', 'b'));
    History.prototype.replaceState.call(window.history, null, '', '/chart/x');
    expect(flushUrlWrites(window)).toBe(false);
    expect(here()).toBe('/chart/x');
  });

  it('survives a browser that refuses the write', () => {
    vi.mocked(window.history.replaceState).mockImplementationOnce(() => {
      throw new DOMException('too many calls', 'SecurityError');
    });
    expect(writeUrlNow(window, 'filters', setParam('engine', 'a'))).toBe(false);
    expect(here()).toBe('/?n=all');
  });
});
