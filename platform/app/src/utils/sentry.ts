import * as Sentry from '@sentry/react';
import { isLocalEnvironment, normalizeCommit } from './updateDetection';

// TODO: DSN of the viewer's Sentry project. Public by design, as in radimal-vet's src/utils/sentry.ts.
const SENTRY_DSN = '';

const commit = process.env.COMMIT_HASH;

Sentry.init({
  dsn: SENTRY_DSN,
  release: normalizeCommit(commit),
  // One image serves every stack; the hostname is what tells prod, stage, veg and ethos apart.
  environment: window.location.hostname,
  // Off for local and test builds, the same rule update detection uses.
  enabled: !isLocalEnvironment(commit, window.location.hostname),
  // Errors are reported from the route ErrorBoundary (routes/index.tsx), which already listens to
  // window errors and unhandled rejections and skips transient Orthanc 504/409 image requests.
  // Sentry's own global handlers would report every one of those a second time.
  integrations: defaults => defaults.filter(integration => integration.name !== 'GlobalHandlers'),
  ignoreErrors: [
    // PostHog's lazy recorder script got blocked or stubbed (ad blocker/proxy). Recording is skipped and the app is unaffected.
    'Called on script loaded before session recording is available',
    // Cancelled fetches. Browser noise with no stack.
    'AbortError',
  ],
});

export default Sentry;
