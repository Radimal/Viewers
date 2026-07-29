/**
 * Which radimal-reporter a given viewer origin reports to.
 *
 * Duplicates reporterOriginFor from @ohif/core's orthancUtils because ui-next does not depend on
 * @ohif/core — keep the two in sync. Pattern-based rather than exact-match so every origin of an
 * environment resolves the same way: the exact-string ladders this replaces defaulted any
 * unrecognized origin (veg-view.stage-1.radimal.ai among them) to production.
 */
export function reporterOriginFor(origin: string): string {
  if (origin === 'http://localhost:3000') {
    return 'http://localhost:5007';
  }
  if (origin.endsWith('.stage-1.radimal.ai')) {
    return 'https://reporter-staging.onrender.com';
  }
  return 'https://radimal-reporter.onrender.com';
}
