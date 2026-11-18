import { utils } from '@ohif/core';

/**
 * Radimal case-status cache: which studies have a reporter case with a
 * consultation PDF. Owns the network lookups (the fork did these inside
 * ui-next components) and exposes a synchronous read for UI gating plus a
 * subscribe for React (useSyncExternalStore-compatible).
 */

const caseStatusByStudy = new Map<string, boolean>();
// Radimal: the latest completed consultation per study, for the Studies
// panel's "covered by the consultation" outline. null = none completed.
export type LatestConsult = { completedAt: number; coveredSeries: Map<string, number> };
const latestConsultByStudy = new Map<string, LatestConsult | null>();
const pendingLookups = new Map<string, Promise<boolean>>();
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach(listener => {
    try {
      listener();
    } catch (e) {
      console.warn('radimalCaseStatus listener failed', e);
    }
  });
}

/** Synchronous read: true/false when known, undefined while unknown. */
export function hasCase(studyInstanceUID: string): boolean | undefined {
  return caseStatusByStudy.get(studyInstanceUID);
}

/** The latest completed consultation, null when none, undefined while unknown. */
export function getLatestConsult(studyInstanceUID: string): LatestConsult | null | undefined {
  return latestConsultByStudy.get(studyInstanceUID);
}

export function subscribeCaseStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Look up (once) whether the study has a case with a consultation PDF.
 * Concurrent calls for the same study share one request; failures resolve
 * to false but are not cached, so a later retry is possible.
 */
export function ensureCaseStatus(studyInstanceUID: string): Promise<boolean> {
  if (!studyInstanceUID) {
    return Promise.resolve(false);
  }

  const known = caseStatusByStudy.get(studyInstanceUID);
  if (known !== undefined) {
    return Promise.resolve(known);
  }

  const pending = pendingLookups.get(studyInstanceUID);
  if (pending) {
    return pending;
  }

  const reporterOrigin = utils.orthancUtils.reporterOriginFor(window.location.origin);
  const lookup = fetch(`${reporterOrigin}/case/${studyInstanceUID}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  })
    .then(response => (response.ok ? response.json() : null))
    .then(caseData => {
      const result = Boolean(caseData?.cases?.[0]?.consultations?.[0]?.s3_url);
      caseStatusByStudy.set(studyInstanceUID, result);
      latestConsultByStudy.set(studyInstanceUID, parseConsultCoverage(caseData?.consult_coverage));
      notify();
      return result;
    })
    .catch(() => false)
    .finally(() => {
      pendingLookups.delete(studyInstanceUID);
    });

  pendingLookups.set(studyInstanceUID, lookup);
  return lookup;
}

/**
 * Reporter's consult_coverage: the study's latest completed consult and the
 * series it covered (SeriesInstanceUID -> image count). Never lets an odd
 * reply break the View Report lookup around it.
 */
export function parseConsultCoverage(coverage): LatestConsult | null {
  const completedAt = parseUtc(coverage?.completed_at);
  const series = coverage?.covered_series;
  if (!Number.isFinite(completedAt) || !series || typeof series !== 'object') {
    return null;
  }
  const coveredSeries = new Map<string, number>(
    Object.entries(series).filter((entry): entry is [string, number] => Number.isInteger(entry[1]))
  );
  return { completedAt, coveredSeries };
}

/** An ISO timestamp as UTC ms; one without an offset is read as UTC, not browser-local. */
function parseUtc(value): number {
  if (typeof value !== 'string') {
    return NaN;
  }
  return Date.parse(/(Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}Z`);
}
