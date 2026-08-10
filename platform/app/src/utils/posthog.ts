import posthog from 'posthog-js';

export type PostHogConfig = {
  apiKey?: string;
  apiHost?: string;
};

let _identifiedFromUrl = false;

function isReady(): boolean {
  return typeof window !== 'undefined' && Boolean((posthog as { __loaded?: boolean }).__loaded);
}

function isProductionBuild(): boolean {
  return process.env.NODE_ENV === 'production';
}

export function initPostHog(config?: PostHogConfig): void {
  try {
    _initPostHogUnsafe(config);
  } catch (e) {
    // PostHog init must never break the viewer.
    console.warn('[PostHog] init failed', e);
  }
}

function _initPostHogUnsafe(config?: PostHogConfig): void {
  if (typeof window === 'undefined') {
    return;
  }
  if ((posthog as { __loaded?: boolean }).__loaded) {
    return;
  }
  if (!isProductionBuild()) {
    return;
  }

  const apiKey = config?.apiKey;
  const apiHost = config?.apiHost ?? 'https://us.i.posthog.com';
  if (!apiKey) {
    return;
  }

  posthog.init(apiKey, {
    api_host: apiHost,
    autocapture: false,
    capture_pageview: false,
    capture_performance: false,
    enable_heatmaps: false,
    disable_surveys: true,
    session_recording: {
      maskAllInputs: false,
      maskInputOptions: { password: true },
    },
    loaded: ph => {
      // Expose for console debugging in DevTools.
      (window as unknown as { posthog?: typeof posthog }).posthog = ph;
      // Tags every event with app=viewer so dashboards can filter viewer
      // activity apart from vet.radimal.ai (shared PostHog project).
      try {
        ph.register({ app: 'viewer' });
      } catch (e) {
        console.warn('[PostHog] register super properties failed', e);
      }
      // Start session recording for everyone — including anonymous users —
      // so we can debug user-reported issues (e.g. hotkey resets) regardless
      // of whether the user came in via vet.radimal.ai with a distinct_id.
      try {
        ph.startSessionRecording?.();
      } catch (e) {
        console.warn('[PostHog] startSessionRecording failed', e);
      }
      try {
        ph.capture('viewer_loaded');
      } catch (e) {
        console.warn('[PostHog] viewer_loaded capture failed', e);
      }
    },
  });

  // Expose the capture helper so extensions (which can't import from @ohif/app)
  // can still emit events. Optional-chained at call sites for safety.
  (window as unknown as {
    __capturePostHogEvent?: (n: string, p?: Record<string, unknown>) => void;
  }).__capturePostHogEvent = capturePostHogEvent;

  // Cross-app identity hand-off: vet.radimal.ai (and other entry points)
  // can append ?distinct_id=<id> when redirecting users into the viewer so
  // their PostHog session continues across the domain boundary.
  const params = new URLSearchParams(window.location.search);
  const distinctId = params.get('distinct_id');
  if (distinctId) {
    try {
      posthog.identify(distinctId);
      _identifiedFromUrl = true;
      posthog.startSessionRecording?.(true);
    } catch (e) {
      console.warn('[PostHog] URL identify failed', e);
    }
  }
}

export function identifyPostHogUser(
  distinctId: string,
  properties?: Record<string, unknown>
): void {
  if (!isReady()) {
    return;
  }
  // URL hand-off wins — don't clobber the canonical id from the upstream app.
  if (_identifiedFromUrl) {
    return;
  }
  try {
    posthog.identify(distinctId, properties);
    posthog.startSessionRecording?.(true);
  } catch (e) {
    console.warn('PostHog identify failed', e);
  }
}

export function capturePostHogEvent(
  name: string,
  properties?: Record<string, unknown>
): void {
  if (!isReady()) {
    if (isProductionBuild()) {
      console.warn(`PostHog not loaded; event "${name}" dropped`);
    }
    return;
  }
  try {
    posthog.capture(name, properties);
  } catch (e) {
    console.warn(`PostHog capture failed for "${name}"`, e);
  }
}

export function resetPostHog(): void {
  if (!isReady()) {
    return;
  }
  try {
    posthog.reset();
    _identifiedFromUrl = false;
  } catch (e) {
    console.warn('PostHog reset failed', e);
  }
}

export { posthog };
