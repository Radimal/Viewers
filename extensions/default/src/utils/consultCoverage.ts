import { utils } from '@ohif/core';

/**
 * Radimal: which series a completed consultation covered. Reporter's
 * GET /case/<uid>/coverage lists the series Orthanc had finished receiving by the study's
 * latest completed consult, with their image counts, and for small series
 * that changed since (X-rays, one thumbnail per image) the images it had. It
 * also lists what the consult left out (DNR series, reduced images).
 */

export type LatestConsult = {
  completedAt: number;
  coveredSeries: Map<string, number>;
  coveredImages: Map<string, Set<string>>;
  leftOutSeries: Set<string>;
  leftOutImages: Map<string, Set<string>>;
};

const coverageByStudy = new Map<string, Promise<LatestConsult | null>>();

/**
 * The study's latest completed consult and what it covered, fetched once per
 * study. null when there is none, coverage is off, or the lookup fails (not
 * cached, so a later call retries).
 */
export function fetchConsultCoverage(studyInstanceUID: string): Promise<LatestConsult | null> {
  if (!coverageByStudy.has(studyInstanceUID)) {
    const reporterOrigin = utils.orthancUtils.reporterOriginFor(window.location.origin);
    const lookup = fetch(`${reporterOrigin}/case/${studyInstanceUID}/coverage`)
      .then(response => {
        if (!response.ok) {
          throw new Error(`coverage ${response.status}`);
        }
        return response.json();
      })
      .then(body => parseConsultCoverage(body?.consult_coverage))
      .catch(() => {
        coverageByStudy.delete(studyInstanceUID);
        return null;
      });
    coverageByStudy.set(studyInstanceUID, lookup);
  }
  return coverageByStudy.get(studyInstanceUID);
}

/** Reporter's consult_coverage; null for anything malformed. */
export function parseConsultCoverage(coverage): LatestConsult | null {
  const completedAt = parseUtc(coverage?.completed_at);
  const isObject = value => value && typeof value === 'object' && !Array.isArray(value);
  if (!Number.isFinite(completedAt) || !isObject(coverage.covered_series)) {
    return null;
  }
  const coveredSeries = new Map<string, number>(
    Object.entries(coverage.covered_series).filter((entry): entry is [string, number] =>
      Number.isInteger(entry[1])
    )
  );
  const imagesBySeries = value =>
    new Map<string, Set<string>>(
      Object.entries(isObject(value) ? value : {})
        .filter(([, sops]) => Array.isArray(sops))
        .map(([uid, sops]) => [uid, new Set(sops as string[])])
    );
  return {
    completedAt,
    coveredSeries,
    coveredImages: imagesBySeries(coverage.covered_images),
    leftOutSeries: new Set(Array.isArray(coverage.left_out_series) ? coverage.left_out_series : []),
    leftOutImages: imagesBySeries(coverage.left_out_images),
  };
}

/** An ISO timestamp as UTC ms; one without an offset is read as UTC, not browser-local. */
function parseUtc(value): number {
  if (typeof value !== 'string') {
    return NaN;
  }
  return Date.parse(/(Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}Z`);
}

export type ConsultCoverage = {
  completedAt: number;
  covered: Set<string>;
  total: number;
  /** Thumbnails received after the consultation. */
  after: Set<string>;
};

/**
 * Coverage for one study's image series (thumbnails). One is covered when
 * Reporter lists its series and the viewer holds no more of the series'
 * images than Reporter counted, or when Reporter lists every one of its
 * images. So a series or image that is new or grew since is never shown as
 * read. What the consult left out (DNR, reduced) is neither covered nor
 * counted as received after.
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
  const allIn = (images: Map<string, Set<string>>, { SeriesInstanceUID, instances = [] }) =>
    instances.length > 0 &&
    instances.every(i => images.get(SeriesInstanceUID)?.has(i.SOPInstanceUID));
  const counted = displaySets.filter(
    ds => !consult.leftOutSeries.has(ds.SeriesInstanceUID) && !allIn(consult.leftOutImages, ds)
  );
  const covered = new Set<string>(
    counted
      .filter(
        ds =>
          imagesInSeries(ds.SeriesInstanceUID) <= consult.coveredSeries.get(ds.SeriesInstanceUID) ||
          allIn(consult.coveredImages, ds)
      )
      .map(({ displaySetInstanceUID }) => displaySetInstanceUID)
  );
  const after = new Set<string>(
    counted.map(ds => ds.displaySetInstanceUID).filter(uid => !covered.has(uid))
  );
  return after.size
    ? { completedAt: consult.completedAt, covered, total: counted.length, after }
    : null;
}
