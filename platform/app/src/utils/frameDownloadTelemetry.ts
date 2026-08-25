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
let _flushTimer: ReturnType<typeof setInterval> | null = null;
const _pending = new Map<string, StudyStats>();

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
 * The loader runs up to `maxNumRequests.interaction` frames concurrently (20 in
 * the deployed config) multiplexed over a single HTTP/2 connection, so each
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
      });
    } catch (e) {
      console.warn('[PostHog] frame_download_stats capture failed', e);
    }
  });
  _pending.clear();
}

function onVisibilityChange(): void {
  if (document.visibilityState === 'hidden') {
    flush('hidden');
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
  _flushTimer = setInterval(() => flush('interval'), FLUSH_INTERVAL_MS);
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pagehide', onPageHide);
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
  if (_flushTimer !== null) {
    clearInterval(_flushTimer);
    _flushTimer = null;
  }
  document.removeEventListener('visibilitychange', onVisibilityChange);
  window.removeEventListener('pagehide', onPageHide);
  flush('stop');
}
