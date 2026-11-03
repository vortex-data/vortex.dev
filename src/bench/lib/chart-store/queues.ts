// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import {
  BUNDLE_CONCURRENCY,
  FULL_HISTORY_CONCURRENCY,
  HYDRATION_CONCURRENCY,
} from '@/lib/chart-format';

// ---------------------------------------------------------------------------
// Bounded priority queues (ported from chart-init.js sections 11 and 15).
// ---------------------------------------------------------------------------

/** A queued fetch task; `priority` may be bumped while still queued. */
export interface QueueEntry {
  priority: number;
  /** Resolves/rejects with the task's outcome once the queue runs it. */
  promise: Promise<unknown>;
}

interface InternalEntry extends QueueEntry {
  task: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
}

/** A bounded-concurrency, priority-ordered task queue. */
export interface TaskQueue {
  /** Enqueue `task` and start draining; higher `priority` runs first. */
  schedule(task: () => Promise<unknown>, priority?: number): QueueEntry;
  /** Re-sort and start any idle slots (called after a priority bump). */
  drain(): void;
}

function makeQueue(concurrency: number): TaskQueue {
  let active = 0;
  const queue: InternalEntry[] = [];

  function drain(): void {
    while (active < concurrency && queue.length > 0) {
      queue.sort((a, b) => b.priority - a.priority);
      const item = queue.shift();
      if (item === undefined) {
        return;
      }
      active += 1;
      Promise.resolve()
        .then(item.task)
        .then(
          (value) => {
            active -= 1;
            item.resolve(value);
            drain();
          },
          (err: unknown) => {
            active -= 1;
            item.reject(err);
            drain();
          },
        );
    }
  }

  function schedule(task: () => Promise<unknown>, priority = 0): QueueEntry {
    let resolve!: (value: unknown) => void;
    let reject!: (err: unknown) => void;
    const promise = new Promise<unknown>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const entry: InternalEntry = { task, priority, promise, resolve, reject };
    queue.push(entry);
    drain();
    return entry;
  }

  return { schedule, drain };
}

/** Per-tab queue for the initial latest-100 chart fetches. */
export const hydrationQueue: TaskQueue = makeQueue(HYDRATION_CONCURRENCY);

/** Per-tab queue for the background `?n=all` full-history upgrades. */
export const fullHistoryQueue: TaskQueue = makeQueue(FULL_HISTORY_CONCURRENCY);

/** Per-tab queue for the per-group `/api/group/{slug}?n=100` bundle fetches. */
export const bundleQueue: TaskQueue = makeQueue(BUNDLE_CONCURRENCY);
