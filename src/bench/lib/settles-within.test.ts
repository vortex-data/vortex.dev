// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { settlesWithin } from './settles-within';

describe('settlesWithin', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('says true as soon as the promise fulfills in time', async () => {
    await expect(settlesWithin(Promise.resolve(1), 150)).resolves.toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('says true for a rejection in time, and leaves the error to the caller', async () => {
    const failing = Promise.reject(new Error('database down'));
    await expect(settlesWithin(failing, 150)).resolves.toBe(true);
    await expect(failing).rejects.toThrow('database down');
  });

  it('says false once the time is up and the promise is still pending', async () => {
    let finish: (value: number) => void = () => {};
    const slow = new Promise<number>((resolve) => {
      finish = resolve;
    });
    const verdict = settlesWithin(slow, 150);
    await vi.advanceTimersByTimeAsync(149);
    finish(1);
    await expect(verdict).resolves.toBe(true);

    const slower = new Promise<number>(() => {});
    const late = settlesWithin(slower, 150);
    await vi.advanceTimersByTimeAsync(150);
    await expect(late).resolves.toBe(false);
  });
});
