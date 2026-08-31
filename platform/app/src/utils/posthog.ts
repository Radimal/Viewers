import posthog from 'posthog-js';
import { normalizeCommit } from './updateDetection';

export type PostHogConfig = {
  apiKey?: string;
  apiHost?: string;
};

let _identifiedFromUrl = false;

// Build identity of THIS bundle, baked in at compile time by DefinePlugin
// (.webpack/webpack.base.js). Attached per-event in capturePostHogEvent rather
// than registered as a PostHog super property: super properties live in
// localStorage, which is shared across every tab on the origin, so the last tab
// to init would relabel events emitted by the others. Two windows running
// different builds side by side is a case this app explicitly supports — see
// the header comment in ./updateDetection and the cacheManager that converges
// it — so a per-event value is the only one that stays true.
//
// normalizeCommit trims: webpack.base.js reads commit.txt without trimming
// (unlike webpack.pwa.js, which builds /version.json), and every other consumer
// of COMMIT_HASH normalizes for that reason. 'local' is updateDetection's own
// sentinel for "not a real deploy".
const BUILD_PROPS = {
  build_commit: normalizeCommit(process.env.COMMIT_HASH) || 'local',
  // NOTE: build-*start* time (webpack config load), NOT the buildTime in
  // /version.json, which is stamped at asset-emit time and is later by the
  // whole build duration. These two never match — join on build_commit.
  build_time: process.env.BUILD_TIME || null,
};

// Whether the tab has been hidden at any point before viewer_loaded fires.
// Reading document.visibilityState inside posthog's `loaded` callback is too
// late to answer "was this case opened into a background tab": `loaded` is
// invoked from a promise chain after init() returns, so a tab opened hidden and
// focused before then reads 'visible' while its load really was throttled —
// the same point-in-time trap wasHiddenDuringWindow avoids for
// first_image_rendered. Latch from module eval instead.
// ponytail: still blind to hiding before the bundle evaluates. An inline stamp
// in index.html would close that, if the numbers ever suggest it matters.
let _hiddenBeforeLoad = typeof document !== 'undefined' && document.visibilityState !== 'visible';
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') {
      _hiddenBeforeLoad = true;
    }
  });
}

/** Exported for the test that guards the latch; read as `hidden_at_load`. */
export function wasHiddenBeforeLoad(): boolean {
  return _hiddenBeforeLoad;
}

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
      // ponytail: canvas capture at 2fps/0.3 quality so replays show the DICOM
      // viewport without competing with the render budget. Raise if too choppy.
      captureCanvas: { recordCanvas: true, canvasFps: 2, canvasQuality: '0.3' },
    },
    loaded: ph => {
      // Expose for console debugging in DevTools.
      (window as unknown as { posthog?: typeof posthog }).posthog = ph;
      // Start session recording for everyone — including anonymous users —
      // so we can debug user-reported issues (e.g. hotkey resets) regardless
      // of whether the user came in via vet.radimal.ai with a distinct_id.
      try {
        ph.startSessionRecording?.();
      } catch (e) {
        console.warn('[PostHog] startSessionRecording failed', e);
      }
      try {
        // A viewer_loaded with no matching first_image_rendered is how we count
        // opens that never painted an image. Without this property there is
        // nothing to separate a case opened into a background tab — where the
        // browser throttles the load and nothing paints until refocus — from a
        // genuine failure to render.
        ph.capture('viewer_loaded', {
          hidden_at_load: wasHiddenBeforeLoad(),
          ...BUILD_PROPS,
        });
      } catch (e) {
        console.warn('[PostHog] viewer_loaded capture failed', e);
      }
    },
  });

  // Registered here, synchronously after init() returns, NOT in the `loaded`
  // callback: `loaded` is invoked from a promise chain, so it runs after the
  // URL identify below and $identify would ship without `app`. Only `app` is a
  // super property — build identity is per-event (see BUILD_PROPS).
  try {
    posthog.register({ app: 'viewer' });
  } catch (e) {
    console.warn('[PostHog] register super properties failed', e);
  }

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
    posthog.capture(name, { ...BUILD_PROPS, ...properties });
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
