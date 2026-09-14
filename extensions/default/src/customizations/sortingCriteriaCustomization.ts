import { utils } from '@ohif/core';

const { sortingCriteria } = utils;
const { seriesSortCriteria } = sortingCriteria;

const dateTimeSortedModalities = ['CT', 'MR'];

/**
 * Radimal display-set ordering, ported from the fork's thumbnail comparator
 * (v3.10.0.71 _compareThumbnailDisplaySets — a total order, transitive across
 * mixed-modality studies):
 * - per-study grouping first, so multi-study comparisons stay transitive
 * - CT/MR: oldest-to-newest by SeriesDate+SeriesTime (DICOM DA/TM strings
 *   sort correctly lexicographically), then SeriesNumber, InstanceNumber,
 *   SeriesInstanceUID
 * - everything else: first-image InstanceNumber, with the same deterministic
 *   tiebreaks (vet series routinely tie at InstanceNumber 1)
 *
 * Also consumed for series-METADATA fetch ordering (objects lack .images
 * there); every field access degrades gracefully.
 */
function compareDisplaySets(a, b) {
  const aStudyUID = a?.StudyInstanceUID || '';
  const bStudyUID = b?.StudyInstanceUID || '';
  if (aStudyUID !== bStudyUID) {
    return aStudyUID < bStudyUID ? -1 : 1;
  }

  const aIsCTMR = dateTimeSortedModalities.includes(a?.Modality);
  const bIsCTMR = dateTimeSortedModalities.includes(b?.Modality);
  if (aIsCTMR !== bIsCTMR) {
    // Group non-CT/MR ahead of CT/MR within a study (PET/CT groups rather
    // than interleaves by instance number).
    return aIsCTMR ? 1 : -1;
  }

  if (aIsCTMR) {
    const aDateTime = a?.SeriesDate ? a.SeriesDate + (a.SeriesTime || '') : '';
    const bDateTime = b?.SeriesDate ? b.SeriesDate + (b.SeriesTime || '') : '';
    if (aDateTime !== bDateTime) {
      return aDateTime < bDateTime ? -1 : 1;
    }
  }

  const aInstanceNum = parseInt(a?.images?.[0]?.InstanceNumber) || 0;
  const bInstanceNum = parseInt(b?.images?.[0]?.InstanceNumber) || 0;
  if (!aIsCTMR && aInstanceNum !== bInstanceNum) {
    return aInstanceNum - bInstanceNum;
  }

  const aSeriesNum = parseInt(a?.SeriesNumber) || 0;
  const bSeriesNum = parseInt(b?.SeriesNumber) || 0;
  if (aSeriesNum !== bSeriesNum) {
    return aSeriesNum - bSeriesNum;
  }

  if (aIsCTMR && aInstanceNum !== bInstanceNum) {
    return aInstanceNum - bInstanceNum;
  }

  const aUID = a?.SeriesInstanceUID || '';
  const bUID = b?.SeriesInstanceUID || '';
  return aUID < bUID ? -1 : aUID > bUID ? 1 : 0;
}

/** Stable series order for e2e (Playwright sets TEST_ENV=true via cross-env). */
const sortingCriteriaFn =
  process.env.TEST_ENV === 'true' ? seriesSortCriteria.compareSeriesUID : compareDisplaySets;

export default {
  sortingCriteria: sortingCriteriaFn,
};
