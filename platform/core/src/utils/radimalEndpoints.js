/**
 * Single source of truth for Radimal service origins.
 *
 * Every place that needs to talk to the reporter or the vet app derives the
 * endpoint from here based on the viewer's own origin. Previously this
 * origin-switch was duplicated across six call sites, which is how a
 * 'https://http://...' endpoint typo shipped to production unnoticed.
 */

const REPORTER_ORIGINS = {
  local: 'http://localhost:5007',
  staging: 'https://reporter-staging.onrender.com',
  prod: 'https://radimal-reporter.onrender.com',
};

const VET_APP_ORIGINS = {
  local: 'http://localhost:8000',
  staging: 'https://radimal-vet-staging.onrender.com',
  prod: 'https://vet.radimal.ai',
};

/**
 * Any *.stage-1.radimal.ai host counts as staging: the viewer is reachable
 * both as view.stage-1.radimal.ai (CloudFront) and viewer.stage-1.radimal.ai
 * (ALB). Unknown origins deliberately fall through to prod, matching the
 * fork's historical behavior.
 */
export function getRadimalEnvironment(origin = window.location.origin) {
  if (origin === 'http://localhost:3000') {
    return 'local';
  }
  const host = origin.replace(/^https?:\/\//, '');
  if (host.endsWith('.stage-1.radimal.ai')) {
    return 'staging';
  }
  return 'prod';
}

export function getReporterOrigin(origin = undefined) {
  return REPORTER_ORIGINS[getRadimalEnvironment(origin ?? window.location.origin)];
}

export function getVetAppOrigin(origin = undefined) {
  return VET_APP_ORIGINS[getRadimalEnvironment(origin ?? window.location.origin)];
}

/** Origins the viewer accepts postMessage events from (vet app windows). */
export const VET_APP_ALLOWED_ORIGINS = Object.values(VET_APP_ORIGINS);
