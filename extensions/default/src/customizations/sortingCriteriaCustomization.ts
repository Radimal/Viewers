import { utils } from '@ohif/core';

const { sortingCriteria } = utils;
const { seriesSortCriteria } = sortingCriteria;

/**
 * Radimal: thumbnails within a study order by the first image's
 * InstanceNumber (acquisition order). Vet studies routinely tie here (each
 * shot is its own series with InstanceNumber 1), so every level falls
 * through to a deterministic tiebreaker — otherwise thumbnail order tracks
 * async metadata-arrival order and shuffles on every reload:
 * InstanceNumber → SeriesNumber → SeriesInstanceUID.
 */
function byFirstImageInstanceNumber(a, b) {
  const instanceA = parseInt(a?.images?.[0]?.InstanceNumber) || 0;
  const instanceB = parseInt(b?.images?.[0]?.InstanceNumber) || 0;
  if (instanceA !== instanceB) {
    return instanceA - instanceB;
  }

  const seriesNumberA = parseInt(a?.SeriesNumber) || 0;
  const seriesNumberB = parseInt(b?.SeriesNumber) || 0;
  if (seriesNumberA !== seriesNumberB) {
    return seriesNumberA - seriesNumberB;
  }

  return String(a?.SeriesInstanceUID ?? '').localeCompare(String(b?.SeriesInstanceUID ?? ''));
}

/** Stable series order for e2e (Playwright sets TEST_ENV=true via cross-env). */
const sortingCriteriaFn =
  process.env.TEST_ENV === 'true' ? seriesSortCriteria.compareSeriesUID : byFirstImageInstanceNumber;

export default {
  sortingCriteria: sortingCriteriaFn,
};
