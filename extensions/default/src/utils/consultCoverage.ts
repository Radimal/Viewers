import type { LatestConsult } from './radimalCaseStatus';

/**
 * Radimal: which series a completed consultation covered. Reporter's
 * GET /case gives the study's latest completed consult, how many images it
 * has, and the Orthanc IDs of those received after the consult
 * (medical_images.created_at). Series with none of those were covered.
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
 * no completed consult, nothing received after it (every series was read),
 * or the viewer holds a different number of images than Reporter. Images
 * Reporter hasn't recorded (still arriving, or reduced out of the consult)
 * can't be placed, so nothing is outlined rather than something wrongly.
 */
export async function getConsultCoverage(
  displaySets,
  consult: LatestConsult | null | undefined,
  viewerImageCount: number
): Promise<ConsultCoverage | null> {
  if (!consult?.lateInstanceIds.size || viewerImageCount !== consult.imageCount) {
    return null;
  }
  const covered = new Set<string>();
  let after = 0;
  for (const displaySet of displaySets) {
    const ids = await Promise.all((displaySet.instances ?? []).map(orthancInstanceId));
    if (ids.some(id => consult.lateInstanceIds.has(id))) {
      after++;
    } else {
      covered.add(displaySet.displaySetInstanceUID);
    }
  }
  return after
    ? { completedAt: consult.completedAt, covered, total: displaySets.length, after }
    : null;
}
