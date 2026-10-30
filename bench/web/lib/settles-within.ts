// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

/**
 * Whether `promise` settles, fulfilled or rejected, within `ms` milliseconds.
 * It resolves as soon as the promise settles or the time is up, whichever
 * comes first, and never rejects: the caller still awaits `promise` for its
 * value or its error. The timer is cleared once the promise settles.
 */
export function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    const settle = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    promise.then(settle, settle);
  });
}
