import posthog from 'posthog-js';
import { isLocalCommit, normalizeCommit } from './updateDetection';

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
// of COMMIT_HASH normalizes for that reason. isLocalCommit owns what counts as
// "not a real deploy" ('', 'local', 'dev') — collapsing them to one value keeps
// local builds in a single PostHog bucket instead of splitting it.
const BUILD_PROPS = {
  build_commit: isLocalCommit(process.env.COMMIT_HASH)
    ? 'local'
    : normalizeCommit(process.env.COMMIT_HASH),
  // NOTE: build-*start* time (webpack config load), NOT the buildTime in
  // /version.json, which is stamped at asset-emit time and is later by the
  // whole build duration. These two never match — join on build_commit.
  build_time: process.env.BUILD_TIME || null,
};

// Was the tab already hidden when this bundle evaluated? Read here and not
// inside posthog's `loaded` callback, which runs one React mount later:
// initPostHog is called from an App.tsx useEffect, and `loaded` is invoked
// synchronously from init(). A snapshot, not a latch over later
// visibilitychange events — a latch here would also flag a foreground load
// whose user tabbed away during boot, which `viewer_hidden` below reports
// separately with its own timestamp rather than folding into this flag.
//
// Named for the boot instant, NOT `hidden_during_load` on first_image_rendered:
// that one is an interval flag over the measured window, this one is a point
// sample at t=0. Different events, different questions — the two-character
// difference in the old name was an invitation to filter on the wrong one.
// ponytail: blind to hiding before the bundle evaluates. An inline stamp in
// index.html would close that, if the numbers ever suggest it matters.
const HIDDEN_AT_BOOT = typeof document !== 'undefined' && document.visibilityState !== 'visible';

// The other half of the never-render question. `hidden_at_boot` only catches
// tabs that were ALREADY hidden; this fires once for a tab backgrounded after
// that, which a point sample structurally cannot see.
//
// USE THE ELAPSED TIME, NEVER MERE PRESENCE. Browsers fire visibilitychange →
// hidden on tab close and on navigate-away, so a clinician who waits 40s on a
// spinner and gives up emits this event too — with ms_since_navigation_start
// around 40000. Treating "a viewer_hidden exists" as "this session was
// throttled" therefore reclassifies the genuine failures as throttled ones and
// concludes that background tabs explain everything. An early hide means
// throttled; a late one means the reader gave up. The threshold, and the
// session-level HogQL this needs (these are three separate events, and PostHog
// stores booleans as the JSON strings 'true'/'false'), live in
// the radimal `__artifacts/viewer-slowness-detection.md` (a sibling repo, not
// this one) — it is a session-level anti-join, not a filter row.
//
// Also not sufficient on its own: a headless mail-security link scanner loads
// visible and never fires visibilitychange at all, so it lands in whatever
// bucket "never hidden" maps to. The lifetime-render-count cohort filter has to
// be applied alongside this, exactly as it is for the 14.0%/7.0% figures.
//
// One-shot: only the first backgrounding bears on the question, and a viewer
// left open all day would otherwise emit one per tab switch. The latch is a
// flag rather than just the unsubscribe, so calling this directly a second time
// cannot double-emit — the property is structural, not positional.
let firstHiddenAtMs: number | null = null;
let hideReported = false;

const captureFirstHide = () => {
  if (hideReported) {
    return;
  }
  // Record the hide even when PostHog is not loaded yet. capturePostHogEvent
  // no-ops before load, and visibilitychange fires only on TRANSITIONS, so a
  // reader who backgrounds during bundle download and returns before the
  // App.tsx mount effect would otherwise never be recorded at all: the
  // listener could not report it, and no further event would ever fire. This
  // is the longest and most throttled stretch of a background-tab load, so it
  // is the one that least deserves to be invisible. Latching the timestamp
  // keeps it exact instead of approximating it at init.
  if (firstHiddenAtMs === null && document.visibilityState !== 'visible') {
    firstHiddenAtMs = Math.round(performance.now());
  }
  if (firstHiddenAtMs === null || !isReady()) {
    return;
  }
  hideReported = true;
  document.removeEventListener('visibilitychange', captureFirstHide);
  capturePostHogEvent('viewer_hidden', { ms_since_navigation_start: firstHiddenAtMs });
};

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', captureFirstHide);
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
      // MUST stay above the viewer_loaded capture below. `loaded` is invoked
      // synchronously from inside init(), so registering after init() returns
      // is too late: viewer_loaded has already been captured. On a repeat visit
      // the super property is still in localStorage and the loss is invisible,
      // so the events that lose `app` are exactly the first-visit ones — the
      // one-shot sessions the never-render cohort is made of.
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
        // A viewer_loaded with no matching first_image_rendered is how we count
        // opens that never painted an image. Without this property there is
        // nothing to separate a case opened into a background tab — where the
        // browser throttles the load and nothing paints until refocus — from a
        // genuine failure to render.
        // Routed through the shared helper so BUILD_PROPS is attached in
        // exactly one place. Safe this early: posthog sets __loaded at the top
        // of init(), before it invokes this callback, so isReady() holds.
        capturePostHogEvent('viewer_loaded', { hidden_at_boot: HIDDEN_AT_BOOT });
      } catch (e) {
        console.warn('[PostHog] viewer_loaded capture failed', e);
      }
      // Flush a hide that the listener latched but could not report, because
      // PostHog was not loaded yet. Covers both the tab still hidden now and
      // the one that was hidden and came back before this point —
      // visibilitychange would never fire again for the latter, so without this
      // the event is lost outright rather than delayed. No-op if never hidden.
      captureFirstHide();
    },
  });

  // Expose the capture helper so extensions (which can't import from @ohif/app)
  // can still emit events. Optional-chained at call sites for safety.
  (
    window as unknown as {
      __capturePostHogEvent?: (n: string, p?: Record<string, unknown>) => void;
    }
  ).__capturePostHogEvent = capturePostHogEvent;

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

export function capturePostHogEvent(name: string, properties?: Record<string, unknown>): void {
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
