import { utils } from '@ohif/core';

const { sortingCriteria } = utils;
const { seriesSortCriteria } = sortingCriteria;

/**
 * Radimal: thumbnails within a study order by the first image's
 * InstanceNumber (acquisition order), falling back to the upstream
 * modality-aware criteria when neither side has one.
 */
function byFirstImageInstanceNumber(a, b) {
  const instanceA = parseInt(a?.images?.[0]?.InstanceNumber) || 0;
  const instanceB = parseInt(b?.images?.[0]?.InstanceNumber) || 0;
  if (!instanceA && !instanceB) {
    return seriesSortCriteria.seriesInfoSortingCriteria(a, b);
  }
  return instanceA - instanceB;
}

/** Stable series order for e2e (Playwright sets TEST_ENV=true via cross-env). */
const sortingCriteriaFn =
  process.env.TEST_ENV === 'true' ? seriesSortCriteria.compareSeriesUID : byFirstImageInstanceNumber;

export default {
  sortingCriteria: sortingCriteriaFn,
};
