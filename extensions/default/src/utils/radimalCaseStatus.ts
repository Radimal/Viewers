import { utils } from '@ohif/core';

/**
 * Radimal case-status cache: which studies have a reporter case with a
 * consultation PDF. Owns the network lookups (the fork did these inside
 * ui-next components) and exposes a synchronous read for UI gating plus a
 * subscribe for React (useSyncExternalStore-compatible).
 */

const caseStatusByStudy = new Map<string, boolean>();
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

  const reporterOrigin = utils.radimalEndpoints.getReporterOrigin();
  const lookup = fetch(`${reporterOrigin}/case/${studyInstanceUID}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  })
    .then(response => (response.ok ? response.json() : null))
    .then(caseData => {
      const result = Boolean(caseData?.cases?.[0]?.consultations?.[0]?.s3_url);
      caseStatusByStudy.set(studyInstanceUID, result);
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
