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
export type LatestConsult = { completedAt: number; lateInstanceIds: Set<string> };
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

  return fetchCase(studyInstanceUID);
}

/**
 * Re-read the study's case from Reporter, bypassing the cache, so the
 * received-after-consult list covers images that arrived while the study
 * was open. The cached status stays in place until the new one lands.
 */
export function refreshCaseStatus(studyInstanceUID: string): Promise<boolean> {
  return pendingLookups.get(studyInstanceUID) ?? fetchCase(studyInstanceUID);
}

function fetchCase(studyInstanceUID: string): Promise<boolean> {
  const reporterOrigin = utils.orthancUtils.reporterOriginFor(window.location.origin);
  const lookup = fetch(`${reporterOrigin}/case/${studyInstanceUID}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  })
    .then(response => (response.ok ? response.json() : null))
    .then(caseData => {
      const result = Boolean(caseData?.cases?.[0]?.consultations?.[0]?.s3_url);
      caseStatusByStudy.set(studyInstanceUID, result);
      latestConsultByStudy.set(studyInstanceUID, latestCompletedConsult(caseData?.cases));
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
 * Latest completed_at across the study's cases, with the Orthanc IDs of
 * images Reporter says arrived after each case's latest completed consult.
 */
export function latestCompletedConsult(cases): LatestConsult | null {
  let completedAt = -Infinity;
  const lateInstanceIds = new Set<string>();
  // Never let an odd reply break the View Report lookup around it.
  const list = value => (Array.isArray(value) ? value : []);
  list(cases).forEach(caseData => {
    list(caseData?.consultations).forEach(consultation => {
      const time = parseUtc(consultation?.completed_at);
      if (Number.isFinite(time)) {
        completedAt = Math.max(completedAt, time);
      }
    });
    list(caseData?.images_after_consult).forEach(id => lateInstanceIds.add(id));
  });
  return Number.isFinite(completedAt) ? { completedAt, lateInstanceIds } : null;
}

/** An ISO timestamp as UTC ms; one without an offset is read as UTC, not browser-local. */
function parseUtc(value): number {
  if (typeof value !== 'string') {
    return NaN;
  }
  return Date.parse(/(Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}Z`);
}
