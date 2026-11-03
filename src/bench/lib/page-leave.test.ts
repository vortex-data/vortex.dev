// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PAGE_LEAVE_GRACE_MS, unlessPageLeft, watchPageLeave } from '@/lib/page-leave';

// A window stand-in: the helper only listens on it.
function fakeWindow(): Window {
  return new EventTarget() as unknown as Window;
}

describe('unlessPageLeft', () => {
  let win: Window;
  let report: ReturnType<typeof vi.fn<() => string>>;

  beforeEach(() => {
    vi.useFakeTimers();
    win = fakeWindow();
    // As the module does for the real window when it loads.
    watchPageLeave(win);
    report = vi.fn(() => 'reported');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports a failure that leaving the page cannot cause at once', () => {
    for (const error of [
      new Error('HTTP 500'),
      new DOMException('Fetch timed out', 'TimeoutError'),
      new SyntaxError('Unexpected end of JSON input'),
    ]) {
      expect(unlessPageLeft(error, report, win)).toBe('reported');
    }
    expect(report).toHaveBeenCalledTimes(3);
  });

  it('reports at once without a window (on the server)', () => {
    expect(unlessPageLeft(new TypeError('fetch failed'), report, undefined)).toBe('reported');
  });

  it('reports a network failure after the grace while the page stays', async () => {
    const result = unlessPageLeft(new TypeError('Failed to fetch'), report, win);
    await vi.advanceTimersByTimeAsync(PAGE_LEAVE_GRACE_MS - 1);
    expect(report).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBe('reported');
  });

  it('drops a network failure when the page starts to unload within the grace', async () => {
    const result = unlessPageLeft(new TypeError('Load failed'), report, win);
    await vi.advanceTimersByTimeAsync(20);
    win.dispatchEvent(new Event('pagehide'));
    await vi.advanceTimersByTimeAsync(PAGE_LEAVE_GRACE_MS * 10);
    expect(report).not.toHaveBeenCalled();

    // Restored from the back/forward cache: the data never came, so the failure counts now.
    win.dispatchEvent(new Event('pageshow'));
    await expect(result).resolves.toBe('reported');
  });

  it('drops an AbortError that no controller of ours raised (Firefox)', async () => {
    void unlessPageLeft(new DOMException('The operation was aborted.', 'AbortError'), report, win);
    win.dispatchEvent(new Event('pagehide'));
    await vi.advanceTimersByTimeAsync(PAGE_LEAVE_GRACE_MS * 10);
    expect(report).not.toHaveBeenCalled();
  });

  it('holds a failure that comes after the page hid until it shows again', async () => {
    win.dispatchEvent(new Event('pagehide'));
    const result = unlessPageLeft(new TypeError('Load failed'), report, win);
    await vi.advanceTimersByTimeAsync(PAGE_LEAVE_GRACE_MS * 10);
    expect(report).not.toHaveBeenCalled();
    win.dispatchEvent(new Event('pageshow'));
    await expect(result).resolves.toBe('reported');

    // Shown again, a later failure waits only for the grace.
    const later = unlessPageLeft(new TypeError('Failed to fetch'), report, win);
    await vi.advanceTimersByTimeAsync(PAGE_LEAVE_GRACE_MS);
    await expect(later).resolves.toBe('reported');
  });

  it('rejects when the report throws', async () => {
    const failure = new Error('island gone');
    const result = unlessPageLeft(
      new TypeError('Failed to fetch'),
      () => {
        throw failure;
      },
      win,
    );
    const settled = expect(result).rejects.toBe(failure);
    await vi.advanceTimersByTimeAsync(PAGE_LEAVE_GRACE_MS);
    await settled;
  });
});
