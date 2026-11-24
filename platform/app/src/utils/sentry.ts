import * as Sentry from '@sentry/react';
import { isTransportRejection } from '@ohif/ui-next';
import { isLocalEnvironment, normalizeCommit } from './updateDetection';

// radimal/radimal-viewer. Public by design, as in radimal-vet's src/utils/sentry.ts.
const SENTRY_DSN = 'https://24eff3d1a2bafe1f7591ba38552641c7@o558129.ingest.us.sentry.io/4512482715697152';

const commit = process.env.COMMIT_HASH;

Sentry.init({
  dsn: SENTRY_DSN,
  release: normalizeCommit(commit),
  // One image serves every stack; the hostname is what tells prod, stage, veg and ethos apart.
  environment: window.location.hostname,
  // Off for local and test builds, the same rule update detection uses.
  enabled: !isLocalEnvironment(commit, window.location.hostname),
  // Sentry's global handlers report every uncaught error and rejection right away, including
  // crashes outside the route ErrorBoundary (modals, dialogs, UpdateBanner). Transient Orthanc
  // 504/409 image requests are retried, so they are skipped here, as the boundary skips them.
  beforeSend: (event, hint) => (isTransportRejection(hint.originalException) ? null : event),
  ignoreErrors: [
    // PostHog's lazy recorder script got blocked or stubbed (ad blocker/proxy). Recording is skipped and the app is unaffected.
    'Called on script loaded before session recording is available',
    // Cancelled fetches. Browser noise with no stack.
    'AbortError',
  ],
});

export default Sentry;
