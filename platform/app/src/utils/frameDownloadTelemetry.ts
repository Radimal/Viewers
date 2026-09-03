import { capturePostHogEvent } from './posthog';

/**
 * Network-tab-equivalent telemetry for DICOM frame downloads.
 *
 * A PerformanceObserver watches browser resource-timing entries for
 * /dicom-web/.../frames/ requests (the viewer's own fetches — precache in the
 * upstream app tab has its own telemetry), aggregates them per study, and
 * periodically emits a `frame_download_stats` PostHog event with duration,
 * TTFB, and transfer-size percentiles. Resource timing is observational only:
 * nothing here wraps fetch or can affect image loading.
 *
 * transferSize/TTFB detail requires same-origin frames or `Timing-Allow-Origin`.
 * Frames are NOT same-origin: the viewer runs on veg-view / view.radimal.ai while
 * frames come from the CloudFront hostnames, so this depends entirely on the TAO
 * header (radimal-terraform #366 / Asana T29). Note that
 * `Access-Control-Allow-Origin` — which these responses do send — is a separate
 * grant and does NOT unlock timing detail. Until TAO ships, `responseStart` and
 * `transferSize` are 0 for every frame and every request lands in
 * `opaque_frames`; duration percentiles are unaffected either way.
 *
 * `opaque_frames == frames` is the canary for TAO having been lost again.
 *
 * Each event also carries four figures describing the flush WINDOW rather than
 * the study — `window_ms`, `hidden_ms`, `long_tasks`, `long_task_ms` — plus
 * `window_started_ms`, which identifies the window rather than measuring it.
 * The four separate "the frames were slow to arrive" from "the tab was
 * backgrounded and the browser deferred the work" from "the main thread was
 * blocked". See the flush-window accounting block below for how they must be
 * aggregated, and why the fifth is needed to do it.
 */

const FRAME_URL_REGEX = /\/dicom-web\/studies\/([^/]+)\/[^?#]*\/frames\//;
const FLUSH_INTERVAL_MS = 15_000;
// A multiframe ultrasound can be thousands of frames; cap raw samples so a
// pathological session can't grow memory unbounded between flushes.
const MAX_SAMPLES_PER_STUDY = 5_000;

type StudyStats = {
  durations: number[];
  ttfbs: number[];
  networkBytes: number;
  // [start, end) of each network fetch, in performance-timeline ms. Frames are
  // fetched concurrently, so these overlap and must be unioned rather than summed.
  networkSpans: Array<[number, number]>;
  cachedFrames: number;
  networkFrames: number;
  opaqueFrames: number;
  droppedSamples: number;
};

let _observer: PerformanceObserver | null = null;
let _longTaskObserver: PerformanceObserver | null = null;
let _flushTimer: ReturnType<typeof setInterval> | null = null;
const _pending = new Map<string, StudyStats>();

/**
 * Flush-window accounting.
 *
 * `window_ms`, `hidden_ms`, `long_tasks` and `long_task_ms` describe the FLUSH
 * WINDOW — the span since the previous flush — and not the study. A flush with
 * two pending studies emits two events carrying identical window figures, so
 * those four must never be summed across the events of one flush. Group by
 * (`$session_id`, `window_started_at`) first — `window_started_at` is the fifth
 * window-scoped property and exists to make that grouping possible; it is a key,
 * never a quantity to aggregate. `frames` and the byte counters stay per-study
 * and are summed across flushes exactly as before.
 *
 * `window_started_at` is EPOCH milliseconds, not a `performance.now()` offset,
 * and that is the whole point. `performance.now()`'s origin is the document's
 * navigation start, so every page load counts from zero and two documents in one
 * analytics session produce colliding offsets. Adding `performance.timeOrigin` —
 * that same navigation start, in epoch time — makes the value unique per page
 * load by construction and directly comparable to the event `timestamp`.
 *
 * Do NOT reach for `$window_id` to separate page loads. posthog-js carries a
 * window id FORWARD across a same-tab navigation: `sessionid.js` restores the
 * stored id whenever `primary_window_exists` is absent, which is exactly the
 * state a normal unload leaves behind, and mints a fresh one only for a
 * duplicated tab. Measured 2026-09-02: 516 of 3,125 (session, window) pairs
 * cover more than one page load, one of them 51. An earlier version of this
 * comment asserted the opposite without reading that source.
 *
 * `network_active_ms / window_ms` is NOT a utilisation ratio and can exceed 1.
 * Resource-timing entries are delivered at completion and span the whole
 * request, so a fetch that began several windows ago lands wholly in the window
 * that saw it finish. Over the whole of 2026-09-02, the first day this event
 * reached both production clusters, 9.3% of emitted events exceeded the 15s
 * interval and the largest was 229s — fifteen intervals of span reported against
 * one window.
 *
 * Treat 229s as a FLOOR. An earlier version of this comment quoted 135s and
 * called the maximum "the stable part": it was read mid-day, and a maximum over
 * a growing sample only ever ratchets. The share is the quantity that settles.
 */
let _windowStartedAt = 0;
let _hiddenMsThisWindow = 0;
// Non-null while the tab is hidden, holding the moment it went hidden. Seeded
// at start() rather than only on transitions: a tab opened in the background
// (ctrl-click, "open link in a background tab") fires NO visibilitychange, and
// would otherwise read as visible for its entire first window — which is the
// case hidden_ms most needs to catch.
let _hiddenSince: number | null = null;
let _longTasks = 0;
let _longTaskMs = 0;
// Distinguishes "measured zero long tasks" from "long tasks were not measured".
// Emitted as null in the latter case so a consumer cannot read an unsupported
// browser as a quiet main thread.
let _longTasksObserved = false;

function newStudyStats(): StudyStats {
  return {
    durations: [],
    ttfbs: [],
    networkBytes: 0,
    networkSpans: [],
    cachedFrames: 0,
    networkFrames: 0,
    opaqueFrames: 0,
    droppedSamples: 0,
  };
}

/** Nearest-rank percentile; `sorted` must be ascending and non-empty. */
function quantile(sorted: number[], q: number): number {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[index];
}

function recordEntry(entry: PerformanceResourceTiming): void {
  const match = FRAME_URL_REGEX.exec(entry.name);
  if (!match) {
    return;
  }
  let studyInstanceUid = match[1];
  try {
    studyInstanceUid = decodeURIComponent(studyInstanceUid);
  } catch {
    // keep the raw path segment
  }

  let stats = _pending.get(studyInstanceUid);
  if (!stats) {
    stats = newStudyStats();
    _pending.set(studyInstanceUid, stats);
  }
  if (stats.durations.length >= MAX_SAMPLES_PER_STUDY) {
    stats.droppedSamples += 1;
    return;
  }

  stats.durations.push(entry.duration);

  // responseStart is 0 for cross-origin entries without Timing-Allow-Origin —
  // no cache/network split or TTFB is knowable for those.
  if (entry.responseStart > 0) {
    const fromCache = entry.transferSize === 0;
    if (fromCache) {
      stats.cachedFrames += 1;
    } else {
      stats.networkFrames += 1;
      stats.networkBytes += entry.transferSize;
      stats.networkSpans.push([entry.startTime, entry.startTime + entry.duration]);
      stats.ttfbs.push(entry.responseStart - entry.startTime);
    }
  } else {
    stats.opaqueFrames += 1;
  }
}

/**
 * Wall-clock milliseconds during which at least one network fetch was in flight.
 *
 * The loader runs up to `maxNumRequests.interaction` frames concurrently (100
 * in `public/config/default.js`, the config the viewer build actually uses)
 * multiplexed over a single HTTP/2 connection, so each
 * entry's `duration` spans the same window. Summing them overcounts elapsed time
 * by roughly the concurrency factor and understates throughput by the same
 * factor; the union of the intervals is the actual transfer window.
 */
function activeMs(spans: Array<[number, number]>): number {
  if (!spans.length) {
    return 0;
  }
  const sorted = spans.slice().sort((a, b) => a[0] - b[0]);
  let total = 0;
  let [start, end] = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    const [s, e] = sorted[i];
    if (s > end) {
      total += end - start;
      [start, end] = [s, e];
    } else if (e > end) {
      end = e;
    }
  }
  return total + (end - start);
}

function flush(reason: string): void {
  const now = performance.now();
  // An in-progress hidden stretch counts up to now; it is re-based below rather
  // than closed, since the tab is still hidden when the next window opens.
  const hiddenMs = _hiddenMsThisWindow + (_hiddenSince !== null ? now - _hiddenSince : 0);
  const windowStartedAt = _windowStartedAt;
  const windowMs = now - _windowStartedAt;
  const longTasks = _longTasksObserved ? _longTasks : null;
  const longTaskMs = _longTasksObserved ? Math.round(_longTaskMs) : null;

  _pending.forEach((stats, studyInstanceUid) => {
    try {
      const durations = stats.durations.slice().sort((a, b) => a - b);
      const ttfbs = stats.ttfbs.slice().sort((a, b) => a - b);
      const networkMs = activeMs(stats.networkSpans);
      capturePostHogEvent('frame_download_stats', {
        study_instance_uid: studyInstanceUid,
        cluster: window.location.host,
        flush_reason: reason,
        frames: durations.length,
        cached_frames: stats.cachedFrames,
        network_frames: stats.networkFrames,
        opaque_frames: stats.opaqueFrames,
        dropped_samples: stats.droppedSamples,
        p50_ms: Math.round(quantile(durations, 0.5)),
        p90_ms: Math.round(quantile(durations, 0.9)),
        p95_ms: Math.round(quantile(durations, 0.95)),
        max_ms: Math.round(durations[durations.length - 1]),
        p50_ttfb_ms: ttfbs.length ? Math.round(quantile(ttfbs, 0.5)) : null,
        max_ttfb_ms: ttfbs.length ? Math.round(ttfbs[ttfbs.length - 1]) : null,
        network_bytes: stats.networkBytes,
        // Throughput over the wall-clock window in which frames were in flight —
        // the pipe, not one request's share of it. See activeMs().
        network_kbps: networkMs > 0 ? Math.round((stats.networkBytes * 8) / networkMs) : null,
        network_active_ms: Math.round(networkMs),
        // Wall clock actually elapsed since the previous flush. For
        // flush_reason = 'interval' the scheduled span is FLUSH_INTERVAL_MS, so
        // the excess is how much the browser deferred the timer — the only
        // direct read we have on background timer throttling, measured on real
        // readers' browsers rather than inferred.
        window_ms: Math.round(windowMs),
        // Identifies the flush, globally. Every event of one flush carries the
        // same value, so (`$session_id`, `window_started_at`) is the grouping
        // key the aggregation rule above requires. Epoch ms via
        // performance.timeOrigin — see that block for why a bare
        // performance.now() offset collides across page loads.
        window_started_at: Math.round(performance.timeOrigin + windowStartedAt),
        // Milliseconds of that window during which the tab was hidden.
        // Deliberately an interval measure, not document.visibilityState at
        // emit time: flush('hidden') runs AT the transition and flush('pagehide')
        // at teardown, so an instantaneous read reports 'hidden' for two of the
        // four flush reasons regardless of what the window actually contained.
        hidden_ms: Math.round(hiddenMs),
        // Main-thread blocking during the window. null (not 0) where the
        // browser does not support the longtask entry type.
        long_tasks: longTasks,
        long_task_ms: longTaskMs,
      });
    } catch (e) {
      console.warn('[PostHog] frame_download_stats capture failed', e);
    }
  });
  _pending.clear();

  // Reset unconditionally, including on a flush that emitted nothing: these
  // describe the span since the previous flush, not since the last event. Were
  // they only reset when _pending was non-empty, an idle stretch would be
  // charged to the next window that happened to have frames in it.
  _windowStartedAt = now;
  _hiddenMsThisWindow = 0;
  _hiddenSince = _hiddenSince !== null ? now : null;
  _longTasks = 0;
  _longTaskMs = 0;

  // Re-phase the interval to the window it measures. A 'hidden' / 'pagehide'
  // flush rebases _windowStartedAt mid-interval; leaving the timer on its
  // original phase would hand the next 'interval' flush a window SHORTER than
  // FLUSH_INTERVAL_MS. window_ms is documented above as measured-minus-
  // scheduled deferral, so a consumer would read that shortfall as NEGATIVE
  // deferral. Deduplicated per page load, 5.6% of interval flushes directly
  // follow a non-interval one (57 of 1,014 on 2026-09-02); the figure swings
  // with how "directly follow" is defined, so treat it as an order of
  // magnitude, not a rate.
  //
  // NOT on an 'interval' flush, which is already in phase. Re-phasing there
  // would restart the timer AFTER the emit loop, adding its cost to every
  // subsequent window and biasing the deferral reading upward by exactly the
  // amount this module spends serialising.
  //
  // Guarded on _flushTimer: stop() clears the timer before its final flush and
  // must not resurrect it.
  //
  // The `reason !== 'interval'` half is NOT pinned by a test and cannot be:
  // under jest's fake timers a callback costs zero, so re-phasing from inside
  // the interval schedules the next fire at exactly the instant it would have
  // fired anyway. A mutant dropping that clause survives the suite. Recorded
  // here so nobody adds an assertion that cannot fail; the reason it is correct
  // is the real clock, not the test one.
  if (_flushTimer !== null && reason !== 'interval') {
    clearInterval(_flushTimer);
    _flushTimer = setInterval(() => flush('interval'), FLUSH_INTERVAL_MS);
  }
}

function onVisibilityChange(): void {
  if (document.visibilityState === 'hidden') {
    // Flush first, then latch. The two orderings turn out to be equivalent --
    // the clock does not move between them, so this window's hidden_ms rounds
    // to 0 either way, and a mutation swapping them survives the suite. Written
    // this way because it matches what the window means, not because it changes
    // the number.
    flush('hidden');
    _hiddenSince = performance.now();
  } else if (_hiddenSince !== null) {
    _hiddenMsThisWindow += performance.now() - _hiddenSince;
    _hiddenSince = null;
  }
}

function onPageHide(): void {
  flush('pagehide');
}

/**
 * Starts observing frame downloads. Idempotent; safe to call before PostHog
 * finishes loading (events for a not-yet-loaded PostHog are dropped by
 * capturePostHogEvent, and the first flush happens 15s in).
 */
export function startFrameDownloadTelemetry(): void {
  if (typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') {
    return;
  }
  if (_observer) {
    return;
  }
  try {
    // The default resource-timing buffer (250 entries) would truncate the
    // `buffered: true` snapshot below for image-heavy studies.
    performance.setResourceTimingBufferSize?.(4_000);
  } catch {
    // non-fatal — live observation is unaffected
  }
  try {
    _observer = new PerformanceObserver(list => {
      try {
        list.getEntries().forEach(entry => recordEntry(entry as PerformanceResourceTiming));
      } catch (e) {
        console.warn('[PostHog] frame download observer callback failed', e);
      }
    });
    _observer.observe({ type: 'resource', buffered: true });
  } catch (e) {
    console.warn('[PostHog] frame download observer failed to start', e);
    _observer = null;
    return;
  }
  startLongTaskObserver();
  _windowStartedAt = performance.now();
  _hiddenMsThisWindow = 0;
  // A bare visibilityState read on purpose, unlike posthog.ts's isHidden():
  // a prerendering document reports 'hidden', and Chrome deprioritises its
  // network work, so charging a prerender to hidden_ms is what this field
  // means. hidden_at_boot answers a different question — "did the reader open
  // this into a background tab" — where a prerender is a false positive.
  _hiddenSince = document.visibilityState === 'hidden' ? _windowStartedAt : null;
  _flushTimer = setInterval(() => flush('interval'), FLUSH_INTERVAL_MS);
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pagehide', onPageHide);
}

/**
 * Counts main-thread long tasks per flush window, so a study whose frames
 * arrived promptly but rendered late can be told apart from one that was
 * waiting on the network. Not buffered: tasks from before this call belong to
 * application boot, which is a different question.
 */
function startLongTaskObserver(): void {
  if (!PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
    return;
  }
  try {
    _longTaskObserver = new PerformanceObserver(list => {
      try {
        list.getEntries().forEach(entry => {
          _longTasks += 1;
          _longTaskMs += entry.duration;
        });
      } catch (e) {
        console.warn('[PostHog] long task observer callback failed', e);
      }
    });
    _longTaskObserver.observe({ type: 'longtask' });
    _longTasksObserved = true;
  } catch (e) {
    console.warn('[PostHog] long task observer failed to start', e);
    _longTaskObserver = null;
    _longTasksObserved = false;
  }
}

export function stopFrameDownloadTelemetry(): void {
  if (!_observer) {
    return;
  }
  try {
    _observer.disconnect();
  } catch (e) {
    console.warn('[PostHog] frame download observer disconnect failed', e);
  }
  _observer = null;
  if (_longTaskObserver) {
    try {
      _longTaskObserver.disconnect();
    } catch (e) {
      console.warn('[PostHog] long task observer disconnect failed', e);
    }
    _longTaskObserver = null;
  }
  if (_flushTimer !== null) {
    clearInterval(_flushTimer);
    _flushTimer = null;
  }
  document.removeEventListener('visibilitychange', onVisibilityChange);
  window.removeEventListener('pagehide', onPageHide);
  flush('stop');
  // AFTER the final flush. Clearing it first made every flush_reason = 'stop'
  // event report long_tasks: null on a browser that had measured them, which
  // reads as "this browser cannot measure long tasks" — the one thing null is
  // documented to mean.
  //
  // Worth knowing before spending more effort here: flush_reason 'stop' has
  // never fired in production (0 of 3,976 events over the 7 days to
  // 2026-09-02). This is App.tsx's unmount cleanup, which an SPA effectively
  // never runs — the page tears down and fires pagehide instead.
  _longTasksObserved = false;
}
