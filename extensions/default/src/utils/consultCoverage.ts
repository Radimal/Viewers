import type { LatestConsult } from './radimalCaseStatus';

/**
 * Radimal: which series a completed consultation covered. Reporter's
 * GET /case lists the series Orthanc had finished receiving by the study's
 * latest completed consult, with their image counts.
 */

export type ConsultCoverage = {
  completedAt: number;
  covered: Set<string>;
  total: number;
  after: number;
};

/**
 * Coverage for one study's image series. A series is covered when Reporter
 * lists it and the viewer holds no more of its images than Reporter counted,
 * so a series that is new or grew since is never shown as read.
 * imagesInSeries counts every instance held, hidden duplicates included,
 * as Orthanc does. null when there is nothing to show: no completed
 * consult, or every series covered.
 */
export function getConsultCoverage(
  displaySets,
  consult: LatestConsult | null | undefined,
  imagesInSeries: (SeriesInstanceUID: string) => number
): ConsultCoverage | null {
  if (!consult) {
    return null;
  }
  const covered = new Set<string>(
    displaySets
      .filter(
        ({ SeriesInstanceUID }) =>
          imagesInSeries(SeriesInstanceUID) <= consult.coveredSeries.get(SeriesInstanceUID)
      )
      .map(({ displaySetInstanceUID }) => displaySetInstanceUID)
  );
  const after = displaySets.length - covered.size;
  return after
    ? { completedAt: consult.completedAt, covered, total: displaySets.length, after }
    : null;
}
