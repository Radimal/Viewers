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
    // Microsoft's Outlook/Defender Safe Links bot opening an emailed viewer link, not a real reader.
    'Object Not Found Matching Id',
  ],
});

// Lets extensions (which can't import @ohif/app) report a non-crash event, the way
// window.__capturePostHogEvent does for PostHog. Each message groups as one issue, and its
// details are tags so they can be searched and charted (e.g. openViewerWindows).
// captureEvent, not captureMessage: the SDK gives a message a synthetic stack trace, and
// Sentry then titled the issue after its top frame ("window.__captureSentryMessage").
(
  window as unknown as {
    __captureSentryMessage?: (message: string, details: Record<string, unknown>) => void;
  }
).__captureSentryMessage = (message, details) =>
  Sentry.captureEvent({
    message,
    level: 'warning',
    fingerprint: [message],
    tags: details as Record<string, string | number | boolean | undefined>,
  });

export default Sentry;
