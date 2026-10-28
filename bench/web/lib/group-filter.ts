// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

/** Query parameter that identifies the group owning a local series filter. */
export const GROUP_FILTER_PARAM = 'group';

/** Repeated query parameter containing one hidden series label. */
export const HIDDEN_SERIES_PARAM = 'hide';

/** Repeated query parameter containing one explicitly visible series label. */
export const SHOWN_SERIES_PARAM = 'show';

export interface GroupFilter {
  groupAnchor: string;
  hiddenSeries: string[];
  shownSeries: string[];
}

/** Parse one group-local series filter from the landing page query. */
export function parseGroupFilter(
  params: Record<string, string | string[] | undefined>,
): GroupFilter | null {
  const rawGroup = params[GROUP_FILTER_PARAM];
  const groupAnchor = Array.isArray(rawGroup) ? rawGroup[0] : rawGroup;
  if (!groupAnchor) {
    return null;
  }

  const rawHidden = params[HIDDEN_SERIES_PARAM];
  const hidden = rawHidden === undefined ? [] : Array.isArray(rawHidden) ? rawHidden : [rawHidden];
  const rawShown = params[SHOWN_SERIES_PARAM];
  const shown = rawShown === undefined ? [] : Array.isArray(rawShown) ? rawShown : [rawShown];
  const shownSeries = [...new Set(shown.filter((value) => value.length > 0))];
  return {
    groupAnchor,
    hiddenSeries: [...new Set(hidden.filter((value) => value.length > 0))].filter(
      (value) => !shownSeries.includes(value),
    ),
    shownSeries,
  };
}
