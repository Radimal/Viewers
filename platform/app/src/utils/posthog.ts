import posthog from 'posthog-js';
import { isLocalCommit, normalizeCommit } from './updateDetection';

export type PostHogConfig = {
  apiKey?: string;
  apiHost?: string;
};

let _identifiedFromUrl = false;

// Build identity of THIS bundle, baked in by DefinePlugin (.webpack/webpack.base.js).
// Per-event, NOT a PostHog super property. The reason is narrower than an
// earlier version of this comment claimed: super properties do live in shared
// localStorage, but posthog-js loads persistence into memory in the
// PostHogPersistence constructor only, so another tab's register() does NOT
// relabel an already-initialised tab's events. What it does affect is the NEXT
// tab to init, which reads whatever the last writer left. Keeping build
// identity per-event sidesteps that entirely, and two windows on different
// builds is a case ./updateDetection exists to handle.
//
// page_load_id below IS a super property despite being per-document. It is
// registered inside `loaded`, before this document captures anything, and the
// no-clock branch UNREGISTERS rather than omitting -- otherwise the previous
// load's value would survive in localStorage and be attributed to this one.
// normalizeCommit because webpack.base.js reads commit.txt untrimmed.
const BUILD_PROPS = {
  build_commit: isLocalCommit(process.env.COMMIT_HASH)
    ? 'local'
    : normalizeCommit(process.env.COMMIT_HASH),
  // NOTE: build-*start* time (webpack config load), NOT the buildTime in
  // /version.json, which is stamped at asset-emit time and is later by the
  // whole build duration. These two never match — join on build_commit.
  build_time: process.env.BUILD_TIME || null,
};

// Was the tab already hidden when this bundle evaluated? Read at module eval,
// not in posthog's `loaded` callback, which runs a React mount later.
// A SNAPSHOT, not a latch: a latch would also flag a foreground load whose user
// tabbed away during boot, which `viewer_hidden` reports separately below.
// Named for the boot instant, NOT `hidden_during_load` on first_image_rendered:
// that one is an interval flag over the measured window, this is a point sample
// at t=0. Different events, different questions — do not filter on the wrong one.
// ponytail: blind to hiding before the bundle evaluates. An inline stamp in
// index.html would close that, if the numbers ever suggest it matters.
// One predicate for both the boot snapshot and the live check below, so they
// cannot drift. `prerendering` is the non-obvious half: a prerendering page
// reports visibilityState 'hidden' for the whole prerender while rendering
// normally, and fires visibilitychange on activation. Without the guard, a page
// the reader activates and views instantly lands in the boot-hidden cohort
// these two signals exist to size. web-vitals carries the same guard in its own
// firstHiddenTime (node_modules/web-vitals/src/lib/getVisibilityWatcher.ts).
//
// This predicate is only HALF the pattern. The other half is the
// prerenderingchange listener registered below — copying the guard without it
// converts the false positive into a false negative, which is how this was
// first written. Do not lift one without the other.
const isHidden = (): boolean =>
  document.visibilityState !== 'visible' &&
  !(document as Document & { prerendering?: boolean }).prerendering;

const HIDDEN_AT_BOOT = typeof document !== 'undefined' && isHidden();

// Identifies THIS page load, so the per-load anti-join below has a key. Epoch
// ms of navigation start: constant for the life of a document, different for
// the next load. The flush-window telemetry branch derives its own window key
// the same way, so the two will group consistently IF both ship -- that
// property is not in production today, so do not write a join against it yet.
//
// Not unique "by construction": two documents whose navigation starts round to
// the same millisecond collide, which two tabs opened in one gesture can do.
// Rare, and it degrades to today's behaviour (a session-level join) rather than
// to a wrong answer, but do not write queries that assume uniqueness.
//
// NULL, NEVER 0, when the clock is unavailable (Safari < 15, some webviews).
// A 0 would register as a real value that JSONHas() reports present, so every
// such load in a session would share the key and the anti-join would silently
// collapse them into one group -- reporting the session healthy because one of
// them painted, which is the exact under-count this property exists to fix.
// Absent is the honest encoding: the presence guard then excludes the cohort
// instead of mis-grouping it. See the query note below.
const PAGE_LOAD_ID: number | null =
  typeof performance !== 'undefined' && performance.timeOrigin
    ? Math.round(performance.timeOrigin)
    : null;

// The other half of the never-render question. `hidden_at_boot` only catches
// tabs that were ALREADY hidden; this fires once for a tab backgrounded after
// that, which a point sample structurally cannot see.
//
// THRESHOLD ON THE ELAPSED TIME, NEVER ON MERE PRESENCE. Browsers fire
// visibilitychange → hidden on tab close and navigate-away, so a clinician who
// watches a spinner for 40s and gives up emits this too, at ~40000. Reading
// "a viewer_hidden exists" as "this session was throttled" therefore relabels
// the genuine failures as throttled and concludes background tabs explain
// everything. An early hide means throttled; a late one means the reader gave up.
//
// TWO LIMITS ON THAT RULE, both structural. It only discriminates within
// `hidden_at_boot = false`: a boot-hidden tab's first hide IS navigation start,
// so it always reports 0, and a later give-up hide in that cohort is
// unobservable because the one-shot latch has already fired. And "early" has no
// settled cut yet — derive it from the deployed distribution, do not invent one.
//
// Four query traps: these are three separate events, so it is an anti-join, not
// an insight filter row; PostHog stores custom booleans as the JSON strings
// 'true'/'false', so `= true` matches nothing while failing open; and a headless
// link scanner loads visible and never fires visibilitychange at all,
// satisfying "never hidden" by construction — the lifetime-render-count cohort
// filter is mandatory alongside this, not optional.
//
// The fourth: DO NOT make that anti-join session-level, which an earlier version
// of this comment prescribed. All three signals are per PAGE LOAD —
// hidden_at_boot is a module-eval snapshot, viewer_hidden is a module-state
// latch, first_image_rendered fires per study — while an analytics session
// survives navigation. Measured with one query over one population — sessions
// carrying any of viewer_loaded / viewer_hidden / first_image_rendered,
// counting a page load as one distinct $initialization_time, project-local:
//   2026-09-02 (one day):      619 of 2,459 = 25.2%, max 72 loads
//   2026-08-26..09-02 (7 days): 4,111 of 16,686 = 24.6%, max 177
// The SHARE is what settles; the counts and the max only ratchet. Both lines
// must come from the same population or they are not comparable — an earlier
// version of this comment mixed two, and a ±1 discrepancy against a differently
// scoped run is expected, so state the population when requoting.
// In a session with five loads where
// four rendered and one did not, a session-level
// `viewer_loaded AND NOT first_image_rendered` sees a render and calls the whole
// session healthy, hiding the never-render load this exists to count.
//
// Scope the anti-join on (`$session_id`, `page_load_id`), the super property
// registered at init below. `$window_id` is NOT a substitute: posthog-js carries
// a window id forward across a same-tab navigation (`sessionid.js` restores it
// whenever `primary_window_exists` is absent, the state a normal unload leaves).
// Events captured before init — there are none today — would carry no
// page_load_id at all, so guard with JSONHas rather than assuming presence.
//
// One-shot: only the first backgrounding bears on the question. The FLAG is
// what guarantees that, not the unsubscribe: captureFirstHide removes the
// visibilitychange listener but never the prerenderingchange one registered
// below, so a prerender activation after a hide would re-enter. The unsubscribe
// is cleanup. Measured, not assumed: deleting the flag fails one test (the
// prerenderingchange re-entry case); deleting the unsubscribe fails none, so
// the cleanup half is the uncovered one. Both are kept — the flag because it
// carries the guarantee, the unsubscribe because leaking a listener is its own
// defect — but only the flag is currently pinned by a test.
//
// Seeded from HIDDEN_AT_BOOT, where 0 is the truthful value. A tab hidden from
// navigation start (ctrl-click, "open link in a background tab" — how a case
// link is normally opened) fires NO visibilitychange, leaving only the flush at
// init, which would stamp bundle-eval + mount time. In a throttled background
// tab that IS the inflated number this event exists to explain, so the
// threshold above would file the most-throttled sessions under "gave up". The
// seed also rescues such a tab refocused before init: its first transition is
// hidden→visible, so the live check never latches and the flush sees 'visible'.
let firstHiddenAtMs: number | null = HIDDEN_AT_BOOT ? 0 : null;
let hideReported = false;

const captureFirstHide = () => {
  if (hideReported) {
    return;
  }
  // Latch even when PostHog is not loaded yet: capturePostHogEvent no-ops
  // before load, and visibilitychange fires only on TRANSITIONS, so a reader
  // who backgrounds during bundle download and returns before the App.tsx mount
  // effect would otherwise be lost outright — no further event would ever fire.
  // That stretch is the longest and most throttled part of the load.
  if (firstHiddenAtMs === null && isHidden()) {
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
  // A prerendered page activated into a BACKGROUND tab goes hidden -> hidden,
  // so no visibilitychange fires and the isHidden() guard above would leave it
  // recorded as never-hidden — a false negative in place of the false positive
  // the guard removes. prerenderingchange is the only event that observes that
  // transition; web-vitals registers it for the same reason.
  //
  // One deliberate divergence from that authority: web-vitals stamps 0 for this
  // case (`firstHiddenTime = event.type === 'visibilitychange' ? … : 0`),
  // reasoning that such a tab was always hidden. We stamp the live clock,
  // because HIDDEN_AT_BOOT is false for a prerendering document and a prerender
  // is not throttled the way a background tab is — the two are not the same
  // population. Noted because the block above names web-vitals as the pattern.
  document.addEventListener('prerenderingchange', captureFirstHide);
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
      // MUST stay above the viewer_loaded capture. `loaded` is invoked
      // synchronously from init(), so registering after init() returns is too
      // late. On a repeat visit the super property is already in localStorage,
      // so the events that would lose `app` are exactly the first-visit ones —
      // the one-shot sessions the never-render cohort is made of.
      try {
        ph.register({ app: 'viewer' });
        // Register or UNREGISTER, never merely omit. Super properties persist
        // in localStorage across page loads, so omitting the key on a load with
        // no usable clock leaves the PREVIOUS load's page_load_id in place --
        // strictly worse than absent, because the anti-join then groups two
        // real loads as one while JSONHas() reports the key present. An
        // explicit null would persist as a registered key for the same reason.
        if (PAGE_LOAD_ID !== null) {
          ph.register({ page_load_id: PAGE_LOAD_ID });
        } else {
          ph.unregister('page_load_id');
        }
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
        // viewer_loaded with no matching first_image_rendered is how we count
        // opens that never painted. hidden_at_boot is what separates a case
        // opened into a throttled background tab from a genuine render failure.
        // Via the shared helper so BUILD_PROPS is attached in one place; safe
        // this early because posthog sets __loaded at the top of init().
        capturePostHogEvent('viewer_loaded', { hidden_at_boot: HIDDEN_AT_BOOT });
      } catch (e) {
        console.warn('[PostHog] viewer_loaded capture failed', e);
      }
      // Flush a hide the listener latched but could not report before load,
      // and catch a tab still hidden now. No-op if never hidden.
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
