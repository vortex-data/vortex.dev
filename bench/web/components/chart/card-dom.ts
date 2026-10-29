// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { DEFAULT_VISIBLE, MAX_VISIBLE_POINTS } from '@/lib/chart-format';

import type { CardState } from './types';

/** Mirror the chart's visible commit count onto the toolbar slider; called
 * from every path that changes the visible range. Programmatic value writes
 * do not fire the slider's `input` event, so this never re-enters
 * `applyScope`. */
export function setSliderFromRange(slider: HTMLInputElement | null, visibleCommits: number): void {
  if (!slider) {
    return;
  }
  const lo = parseInt(slider.min, 10) || 1;
  const hi = parseInt(slider.max, 10) || visibleCommits;
  slider.value = String(Math.max(lo, Math.min(hi, visibleCommits)));
}

/** Show the badge when the visible range was downsampled. The numbers are
 * commit counts, matching the slider's mental model. */
export function renderDownsampleBadge(
  badge: HTMLSpanElement | null,
  keptCommits: number,
  visibleCommits: number,
  anyDownsampled: boolean,
): void {
  if (!badge) {
    return;
  }
  if (!anyDownsampled || keptCommits >= visibleCommits) {
    badge.setAttribute('hidden', '');
    badge.textContent = '';
    return;
  }
  badge.removeAttribute('hidden');
  badge.textContent = `downsampled · ${keptCommits} / ${visibleCommits}`;
  badge.setAttribute(
    'title',
    `Showing ${keptCommits} of ${visibleCommits} commits in view. Each series renders at most ` +
      `${MAX_VISIBLE_POINTS} points at a time; when more are in view, we apply LTTB (Largest ` +
      `Triangle, Three Buckets), an algorithm that picks representative points by maximising ` +
      `the area of triangles formed with neighbouring buckets. Visual peaks and valleys are ` +
      `preserved while the chart stays responsive. Zoom in past ${MAX_VISIBLE_POINTS} visible ` +
      `commits to see every raw measurement.`,
  );
}

/** Render the per-card window chip from controller state. Imperative, like
 * `syncDownsampleBadge`: the chip is hidden for charts born complete, and
 * otherwise reflects windowed → loading → complete, with an error → retry
 * path and a hover-revealed "load all N" action. */
export function renderWindowChip(chip: HTMLButtonElement | null, state: CardState): void {
  if (!chip) {
    return;
  }
  const payload = state.payload;
  if (!payload || !state.everWindowed) {
    chip.setAttribute('hidden', '');
    chip.dataset.state = 'hidden';
    chip.textContent = '';
    chip.disabled = true;
    chip.removeAttribute('title');
    return;
  }
  // Pin the locale so the grouped digits ("3,572") are deterministic across
  // runtimes and CI ICU builds (and match the test expectations) rather than
  // following the host's default locale.
  const total = payload.history.total_commits.toLocaleString('en-US');
  const loaded = payload.history.loaded_commits.toLocaleString('en-US');
  chip.removeAttribute('hidden');
  if (state.fullLoaded) {
    chip.dataset.state = 'complete';
    chip.disabled = true;
    chip.textContent = `all ${total}`;
    chip.removeAttribute('title');
    return;
  }
  if (state.fullUnavailable) {
    chip.dataset.state = 'windowed';
    chip.disabled = true;
    chip.textContent = `latest ${loaded} of ${total}`;
    chip.removeAttribute('title');
    return;
  }
  if (state.fullFetchPending) {
    chip.dataset.state = 'loading';
    chip.disabled = true;
    chip.textContent = `loading all ${total}…`;
    chip.removeAttribute('title');
    return;
  }
  if (state.chipError) {
    chip.dataset.state = 'error';
    chip.disabled = false;
    chip.textContent = 'retry';
    chip.setAttribute('title', 'Loading the full history failed. Click to retry.');
    return;
  }
  chip.dataset.state = 'windowed';
  chip.disabled = false;
  chip.textContent = state.hovering ? `load all ${total}` : `latest ${loaded} of ${total}`;
  chip.setAttribute(
    'title',
    `Showing the latest ${loaded} of ${total} commits. Click to load the full history.`,
  );
}

/** Cap the slider's `max` to the chart's full x-axis length; for a virtual
 * latest-100 payload this is intentionally larger than the loaded count so
 * "show all" can expose the unloaded older range while the full-history
 * fetch is warming. */
export function setSliderBounds(slider: HTMLInputElement | null, commitCount: number): void {
  if (!slider) {
    return;
  }
  const max = Math.max(5, commitCount);
  slider.max = String(max);
  // ~200 stops across the slider so dragging feels continuous regardless of
  // history size.
  slider.step = String(Math.max(1, Math.round(max / 200)));
  const current = parseInt(slider.value, 10);
  if (!Number.isFinite(current) || current > max) {
    slider.value = String(Math.min(DEFAULT_VISIBLE, max));
  }
}
