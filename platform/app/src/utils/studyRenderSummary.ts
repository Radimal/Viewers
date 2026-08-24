import { capturePostHogEvent } from './posthog';

/**
 * study_render_summary — fired ONCE per study open, when the user leaves it:
 * in-app study switch / navigation away (Mode route cleanup) or tab close
 * (pagehide). Firing on exit is deliberate: it captures failures that happen
 * mid-read, which an open-time metric cannot see.
 *
 * "Fully usable" bar (lazy loading makes "all images" ambiguous): every
 * supported display set's thumbnail rendered + zero failed image requests.
 * The thumbnail pipeline decodes one frame per display set, so it doubles as
 * the "first frame of every display set" check.
 *
 * Feeds arrive via window.__studyRenderSummary (extensions can't import from
 * @ohif/app — same pattern as window.__capturePostHogEvent):
 *  - extensions/cornerstone/src/init.tsx: image 'rendered'/'failed' per imageId
 *  - extensions/default PanelStudyBrowser: thumbnail 'expected'/'rendered'/'failed'
 *
 * Known limits, accepted by the ticket:
 *  - Requests that hang forever only become visible when the HTTP layer times
 *    out and fires IMAGE_LOAD_FAILED, so instances_expected = rendered + failed.
 *  - peak_heap_mb misses GPU textures and is Chromium-only (null elsewhere).
 *  - measured_mbps / ttfb_p50_ms need Timing-Allow-Origin on the image CDN;
 *    without it transferSize/responseStart read 0 cross-origin and both
 *    report null. (CloudFront response-headers-policy change, tracked on the
 *    ticket.)
 *  - Exit uses pagehide only, not visibilitychange: radiologists constantly
 *    tab-switch to the vet tab mid-read, and visibility:hidden would end the
 *    session minutes early. Cost: a tab killed by the OS without pagehide
 *    loses its event.
 */

type Session = {
  openedAt: number;
  switchType: 'reload' | 'in_app';
  servicesManager?: AppTypes.ServicesManager;
  imagesRendered: Set<string>;
  imagesFailed: Set<string>;
  thumbsExpected: Set<string>;
  thumbsRendered: Set<string>;
  thumbsFailed: Set<string>;
  lastThumbRenderedAt: number | null;
  unknownSeq: number;
  peakHeapBytes: number;
  heapTimer: number | null;
  longtaskMs: number;
  longtaskSupported: boolean;
  observers: PerformanceObserver[];
  netIntervals: Array<{ start: number; end: number }>;
  netBytes: number;
  netTtfbs: number[];
};

let session: Session | null = null;

// False only until the first study open after a full page load — same
// switch_type semantics as first_image_rendered in initViewTiming.ts.
let hasOpenedStudyThisPageLoad = false;

export function startStudyRenderSummary(servicesManager?: AppTypes.ServicesManager): void {
  try {
    if (session) {
      // Safety net — Mode.tsx pairs start/stop, so this shouldn't happen.
      send('route');
    }
    const s: Session = {
      openedAt: performance.now(),
      switchType: hasOpenedStudyThisPageLoad ? 'in_app' : 'reload',
      servicesManager,
      imagesRendered: new Set(),
      imagesFailed: new Set(),
      thumbsExpected: new Set(),
      thumbsRendered: new Set(),
      thumbsFailed: new Set(),
      lastThumbRenderedAt: null,
      unknownSeq: 0,
      peakHeapBytes: 0,
      heapTimer: null,
      longtaskMs: 0,
      longtaskSupported: false,
      observers: [],
      netIntervals: [],
      netBytes: 0,
      netTtfbs: [],
    };
    hasOpenedStudyThisPageLoad = true;

    sampleHeap(s);
    s.heapTimer = window.setInterval(() => sampleHeap(s), 15000);

    try {
      // buffered:false — buffered longtask entries would include page-boot /
      // previous-study work and inflate this study's number.
      const lt = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          s.longtaskMs += entry.duration;
        }
      });
      lt.observe({ type: 'longtask' });
      s.longtaskSupported = true;
      s.observers.push(lt);
    } catch {
      // longtask is Chromium-only.
    }

    try {
      const ro = new PerformanceObserver(list => {
        for (const entry of list.getEntries() as PerformanceResourceTiming[]) {
          if (entry.startTime < s.openedAt) {
            continue;
          }
          if (!entry.name.includes('dicomweb') && !entry.name.includes('dicom-web')) {
            continue;
          }
          if (entry.responseEnd > entry.startTime) {
            s.netIntervals.push({ start: entry.startTime, end: entry.responseEnd });
          }
          s.netBytes += entry.transferSize || 0;
          if (entry.responseStart > 0) {
            s.netTtfbs.push(entry.responseStart - entry.fetchStart);
          }
        }
      });
      ro.observe({ type: 'resource', buffered: true });
      s.observers.push(ro);
    } catch {
      // Resource timing observers are near-universal; degrade to nulls.
    }

    session = s;
  } catch {
    // Analytics must never break the viewer.
  }
}

export function stopStudyRenderSummary(): void {
  send('route');
}

function send(exitType: 'route' | 'pagehide'): void {
  const s = session;
  if (!s) {
    return;
  }
  session = null;
  try {
    if (s.heapTimer !== null) {
      clearInterval(s.heapTimer);
    }
    s.observers.forEach(o => {
      try {
        o.disconnect();
      } catch {
        /* already disconnected */
      }
    });
    sampleHeap(s);

    const secsOpen = (performance.now() - s.openedAt) / 1000;
    const fullyUsable =
      s.thumbsExpected.size > 0 &&
      s.thumbsRendered.size === s.thumbsExpected.size &&
      s.thumbsFailed.size === 0 &&
      s.imagesFailed.size === 0;

    const mem = (performance as { memory?: { jsHeapSizeLimit?: number } }).memory;
    const nav = navigator as Navigator & {
      deviceMemory?: number;
      connection?: { effectiveType?: string; downlink?: number; rtt?: number };
    };

    capturePostHogEvent(
      'study_render_summary',
      {
        instances_expected: s.imagesRendered.size + s.imagesFailed.size,
        instances_rendered: s.imagesRendered.size,
        instances_failed: s.imagesFailed.size,
        thumbnails_expected: s.thumbsExpected.size,
        thumbnails_rendered: s.thumbsRendered.size,
        thumbnails_failed: s.thumbsFailed.size,
        fully_usable: fullyUsable,
        secs_to_fully_usable:
          fullyUsable && s.lastThumbRenderedAt !== null
            ? round1((s.lastThumbRenderedAt - s.openedAt) / 1000)
            : null,
        secs_open: round1(secsOpen),
        peak_heap_mb: s.peakHeapBytes > 0 ? Math.round(s.peakHeapBytes / 1048576) : null,
        heap_limit_mb: mem?.jsHeapSizeLimit ? Math.round(mem.jsHeapSizeLimit / 1048576) : null,
        longtask_ms_per_min:
          s.longtaskSupported && secsOpen > 0 ? Math.round(s.longtaskMs / (secsOpen / 60)) : null,
        device_memory_gb: nav.deviceMemory ?? null,
        cores: navigator.hardwareConcurrency ?? null,
        conn_effective_type: nav.connection?.effectiveType ?? null,
        conn_downlink_mbps: nav.connection?.downlink ?? null,
        conn_rtt_ms: nav.connection?.rtt ?? null,
        measured_mbps: measuredMbps(s),
        ttfb_p50_ms: median(s.netTtfbs),
        modality: getModalities(s),
        cluster: window.location.host,
        switch_type: s.switchType,
        exit_type: exitType,
      },
      // sendBeacon so the pagehide-path event survives tab close; harmless
      // (and tiny) on the route path too.
      { transport: 'sendBeacon' }
    );
  } catch {
    // Analytics must never break the viewer.
  }
}

function sampleHeap(s: Session): void {
  const used = (performance as { memory?: { usedJSHeapSize?: number } }).memory?.usedJSHeapSize;
  if (typeof used === 'number' && used > s.peakHeapBytes) {
    s.peakHeapBytes = used;
  }
}

/** sum(transferSize) ÷ time-with-a-request-in-flight, in Mbps. */
function measuredMbps(s: Session): number | null {
  if (!s.netBytes || !s.netIntervals.length) {
    return null;
  }
  const busyMs = mergedBusyMs(s.netIntervals);
  if (busyMs <= 0) {
    return null;
  }
  return round1((s.netBytes * 8) / (busyMs * 1000));
}

/** Union length of possibly-overlapping [start, end] intervals, in ms. */
export function mergedBusyMs(intervals: Array<{ start: number; end: number }>): number {
  if (!intervals.length) {
    return 0;
  }
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  let busy = 0;
  let curStart = sorted[0].start;
  let curEnd = sorted[0].end;
  for (let i = 1; i < sorted.length; i++) {
    const { start, end } = sorted[i];
    if (start > curEnd) {
      busy += curEnd - curStart;
      curStart = start;
      curEnd = end;
    } else if (end > curEnd) {
      curEnd = end;
    }
  }
  return busy + (curEnd - curStart);
}

export function median(vals: number[]): number | null {
  if (!vals.length) {
    return null;
  }
  const sorted = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return Math.round(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function getModalities(s: Session): string | null {
  try {
    const displaySets = s.servicesManager?.services?.displaySetService?.activeDisplaySets ?? [];
    const modalities = [
      ...new Set(displaySets.map(ds => (ds as { Modality?: string })?.Modality).filter(Boolean)),
    ];
    return modalities.length ? modalities.sort().join(',') : null;
  } catch {
    return null;
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => send('pagehide'));

  // Ingest hooks for extensions. No-ops while no study is open. An image that
  // eventually renders is not a failure — a rendered outcome clears an earlier
  // failed one for the same key (retry succeeded; the pixel is on screen).
  (window as { __studyRenderSummary?: unknown }).__studyRenderSummary = {
    image(outcome: 'rendered' | 'failed', imageId?: string): void {
      try {
        const s = session;
        if (!s) {
          return;
        }
        const key = imageId || `unknown:${++s.unknownSeq}`;
        if (outcome === 'rendered') {
          s.imagesRendered.add(key);
          s.imagesFailed.delete(key);
        } else if (!s.imagesRendered.has(key)) {
          s.imagesFailed.add(key);
        }
      } catch {
        /* never break the viewer */
      }
    },
    thumbnail(outcome: 'expected' | 'rendered' | 'failed', displaySetUid?: string): void {
      try {
        const s = session;
        if (!s || !displaySetUid) {
          return;
        }
        s.thumbsExpected.add(displaySetUid);
        if (outcome === 'rendered') {
          s.thumbsRendered.add(displaySetUid);
          s.thumbsFailed.delete(displaySetUid);
          s.lastThumbRenderedAt = performance.now();
        } else if (outcome === 'failed' && !s.thumbsRendered.has(displaySetUid)) {
          s.thumbsFailed.add(displaySetUid);
        }
      } catch {
        /* never break the viewer */
      }
    },
  };
}
