import type { LatestConsult } from './radimalCaseStatus';

/**
 * Radimal: which series a completed consultation covered. Reporter's
 * GET /case lists the Orthanc IDs of images we had when the study's latest
 * consult completed (medical_images.created_at). A series is covered only if
 * every image is listed, so an image Reporter doesn't know of (arrived later,
 * still being recorded, or the list is missing) is never shown as read.
 */

const orthancIdBySOP = new Map<string, Promise<string>>();

/**
 * Orthanc's instance ID: SHA-1 of "PatientID|StudyInstanceUID|
 * SeriesInstanceUID|SOPInstanceUID", hex in five dash-separated groups of 8.
 */
export function orthancInstanceId(instance): Promise<string> {
  const { PatientID = '', StudyInstanceUID, SeriesInstanceUID, SOPInstanceUID } = instance;
  const key = `${PatientID}|${StudyInstanceUID}|${SeriesInstanceUID}|${SOPInstanceUID}`;
  if (!orthancIdBySOP.has(key)) {
    orthancIdBySOP.set(
      key,
      crypto.subtle.digest('SHA-1', new TextEncoder().encode(key)).then(digest =>
        Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0'))
          .join('')
          .match(/.{8}/g)
          .join('-')
      )
    );
  }
  return orthancIdBySOP.get(key);
}

export type ConsultCoverage = {
  completedAt: number;
  covered: Set<string>;
  total: number;
  after: number;
};

/**
 * Coverage for one study's image series. null when there is nothing to show:
 * no completed consult, or nothing received after it (then every series was
 * read, and outlining them all would only be noise).
 */
export async function getConsultCoverage(
  displaySets,
  consult: LatestConsult | null | undefined
): Promise<ConsultCoverage | null> {
  if (!consult) {
    return null;
  }
  const covered = new Set<string>();
  let after = 0;
  for (const displaySet of displaySets) {
    const ids = await Promise.all((displaySet.instances ?? []).map(orthancInstanceId));
    if (!ids.length || ids.some(id => !consult.coveredInstanceIds.has(id))) {
      after++;
    } else {
      covered.add(displaySet.displaySetInstanceUID);
    }
  }
  return after
    ? { completedAt: consult.completedAt, covered, total: displaySets.length, after }
    : null;
}
