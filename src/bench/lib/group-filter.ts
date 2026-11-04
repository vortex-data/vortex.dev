// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

/** Query parameter that identifies the group owning a local series filter. */
export const GROUP_FILTER_PARAM = 'group';

/** Repeated query parameter containing one hidden series label. */
export const HIDDEN_SERIES_PARAM = 'hide';

/** Repeated query parameter containing one explicitly visible series label. */
export const SHOWN_SERIES_PARAM = 'show';

/** Repeated query parameter containing one engine the group's Engine row hides. */
export const HIDDEN_ENGINE_PARAM = 'hide-engine';

/** Repeated query parameter containing one format the group's Format row hides. */
export const HIDDEN_FORMAT_PARAM = 'hide-format';

/**
 * One group's filter choices, one list per row of its filter dropdown. A
 * permalink carries the Engine and Format rows' choices as they are, not as
 * the series they hide now, so they also hide the series of charts that load
 * later.
 */
export interface GroupFilterChoices {
  hiddenSeries: readonly string[];
  shownSeries: readonly string[];
  hiddenEngines: readonly string[];
  hiddenFormats: readonly string[];
}

interface GroupFilter extends GroupFilterChoices {
  groupAnchor: string;
}

/** No choices in any row. */
export const NO_GROUP_FILTER_CHOICES: GroupFilterChoices = {
  hiddenSeries: [],
  shownSeries: [],
  hiddenEngines: [],
  hiddenFormats: [],
};

/** The non-empty values of one repeated query parameter, without repeats. */
function repeated(params: Record<string, string | string[] | undefined>, name: string): string[] {
  const raw = params[name];
  const values = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  return [...new Set(values.filter((value) => value.length > 0))];
}

/** Parse one group-local filter from the landing page query. */
export function parseGroupFilter(
  params: Record<string, string | string[] | undefined>,
): GroupFilter | null {
  const rawGroup = params[GROUP_FILTER_PARAM];
  const groupAnchor = Array.isArray(rawGroup) ? rawGroup[0] : rawGroup;
  if (!groupAnchor) {
    return null;
  }

  const shownSeries = repeated(params, SHOWN_SERIES_PARAM);
  return {
    groupAnchor,
    hiddenSeries: repeated(params, HIDDEN_SERIES_PARAM).filter(
      (value) => !shownSeries.includes(value),
    ),
    shownSeries,
    hiddenEngines: repeated(params, HIDDEN_ENGINE_PARAM),
    hiddenFormats: repeated(params, HIDDEN_FORMAT_PARAM),
  };
}
