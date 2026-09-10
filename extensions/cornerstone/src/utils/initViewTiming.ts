import { log, Enums } from '@ohif/core';
import { EVENTS, getEnabledElement, metaData } from '@cornerstonejs/core';

const IMAGE_TIMING_KEYS = [];

// False only until the first capture after a full page load. A study opened
// via in-app navigation (no reload) keeps this module instance alive, which
// is what distinguishes switch_type 'in_app' from 'reload'.
let hasCapturedFirstImageThisPageLoad = false;

// The switch_type reported for THIS study, latched at first paint. all_images
// fires after hasCapturedFirstImageThisPageLoad has already flipped, so reading
// that latch again there would label every study 'in_app', including the first.
let switchTypeThisStudy: 'in_app' | 'reload' = 'reload';

// How many viewports this study is waiting on. viewportsWaiting counts DOWN to
// zero, so it is always 0 at the point all_images_rendered fires and cannot be
// the denominator. Reset when a fresh batch starts registering.
let viewportsThisStudy = 0;

// A hidden tab suspends requestAnimationFrame, so IMAGE_RENDERED can fire
// minutes — even hours — after the study was actually delivered, while
// performance.now() keeps counting. Those samples measure when the clinician
// came back to the tab, not how fast the study loaded.
let lastVisibilityChangeAt = 0;
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    lastVisibilityChangeAt = performance.now();
  });
}

/**
 * True when the tab was hidden at any point in [startedAt, now]: either it is
 * hidden right now, or visibility flipped after the timer started — any flip
 * inside the window means one side of it was hidden.
 * Reported as `hidden_during_load`; filter on it at query time.
 * ponytail: one page-level timestamp, no per-timer bookkeeping — only one
 * first-image timer is ever in flight.
 */
export function wasHiddenDuringWindow(startedAt: number): boolean {
  // `prerendering` excluded: a prerendering page reports visibilityState
  // 'hidden' throughout while rendering normally, so without it a study painted
  // during a prerender is flagged as a background-tab sample and dropped from
  // every percentile tile.
  //
  // This covers the paint that COMPLETES during the prerender, and only that.
  // A window that spans prerender -> activation is still flagged, because the
  // activation fires visibilitychange and the interval clause below stamps it.
  // Narrowing that too would mean telling an activation apart from a real
  // backgrounding, which is more machinery than an unreachable case is worth:
  // nothing prerenders this viewer. Checked 2026-09-07 — no speculation rules
  // and no rel=prerender in this repo or in radimal-vet, every entry point into
  // the viewer is window.open or a pasted share link, and the nginx config that
  // ships in this image sends no Supports-Loading-Mode opt-in for what is a
  // cross-origin navigation. The prerendering guard below is kept regardless:
  // it costs nothing, and an empty cohort is an infra fact with no test behind
  // it. posthog.ts carries the full check and the condition to re-check under.
  //
  // posthog.ts says its prerender predicate is half a pattern and must not be
  // lifted without the prerenderingchange listener. That rule does not carry
  // here, and the reason is worth stating: it latches a one-shot, this only
  // stamps a timestamp. No visibility transition occurs DURING a prerender —
  // the document is hidden from navigation start to activation — so the
  // listener below cannot fire while prerendering, and guarding it would be
  // unreachable code. A mutant adding that guard survives the suite for exactly
  // that reason; it is equivalent, not untested.
  const hiddenNow =
    document.visibilityState !== 'visible' &&
    !(document as Document & { prerendering?: boolean }).prerendering;
  return hiddenNow || lastVisibilityChangeAt > startedAt;
}

const imageTiming = {
  viewportsWaiting: 0,
};

/**
 * Defines the initial view timing reporting.
 * This allows knowing how many viewports are waiting for initial views and
 * when the IMAGE_RENDERED gets sent out.
 * The first image rendered will fire the FIRST_IMAGE timeEnd logs, while
 * the last of the enabled viewport will fire the ALL_IMAGES timeEnd logs.
 *
 */

export default function initViewTiming({ element }) {
  if (!IMAGE_TIMING_KEYS.length) {
    // Work around a bug in WebPack that doesn't getting the enums initialized
    // quite fast enough to be declared statically.
    const { TimingEnum } = Enums;

    IMAGE_TIMING_KEYS.push(
      TimingEnum.DISPLAY_SETS_TO_ALL_IMAGES,
      TimingEnum.DISPLAY_SETS_TO_FIRST_IMAGE,
      TimingEnum.STUDY_TO_FIRST_IMAGE
    );
  }

  if (!IMAGE_TIMING_KEYS.find(key => log.timingKeys[key])) {
    return;
  }
  // A zero here means the previous batch has fully drained, so this element is
  // the first of a new one. Counting up separately keeps a denominator that
  // survives viewportsWaiting being decremented back to zero.
  if (!imageTiming.viewportsWaiting) {
    viewportsThisStudy = 0;
  }
  imageTiming.viewportsWaiting += 1;
  viewportsThisStudy += 1;
  element.addEventListener(EVENTS.IMAGE_RENDERED, imageRenderedListener);
}

function imageRenderedListener(evt) {
  if (evt.detail.viewportStatus === 'preRender') {
    return;
  }
  const { TimingEnum } = Enums;
  captureFirstImageRendered(evt);
  log.timeEnd(TimingEnum.DISPLAY_SETS_TO_FIRST_IMAGE);
  log.timeEnd(TimingEnum.STUDY_TO_FIRST_IMAGE);
  log.timeEnd(TimingEnum.SCRIPT_TO_VIEW);
  imageTiming.viewportsWaiting -= 1;
  evt.detail.element.removeEventListener(EVENTS.IMAGE_RENDERED, imageRenderedListener);
  if (!imageTiming.viewportsWaiting) {
    log.timeEnd(TimingEnum.DISPLAY_SETS_TO_ALL_IMAGES);
    captureAllImagesRendered(evt);
  }
}

/**
 * Reports `all_images_rendered` when the last enabled viewport has painted.
 *
 * COUNTS VIEWPORTS, NOT FRAMES. This is "everything in the current layout is on
 * screen", which is the question a reader asks when they open a case, and NOT
 * "every image in the series is loaded so scrolling never stalls". For x-ray the
 * two are close; for a long CT stack they are not. Answering the second needs an
 * expected-frame denominator (`displaySet.numImageFrames`, summed across the
 * study) and a per-frame hook, which is a larger change.
 *
 * `viewports` is emitted so a consumer can see the denominator rather than
 * assume one, and so a single-viewport layout is distinguishable from a grid.
 *
 * Duration is deliberately NOT computed here. DISPLAY_SETS_TO_ALL_IMAGES starts
 * in defaultRouteInit, after metadata retrieval, which is the same defect that
 * makes `first_image_rendered.ms` cover a fraction of the real window. Subtract
 * `ms_since_navigation_start` between events instead.
 *
 * Does not fire when a viewport never paints, which is the same shape as
 * `first_image_rendered` and is the signal the stuck-viewer rate is built on: a
 * missing event is data, so this must not manufacture one.
 */
function captureAllImagesRendered(evt) {
  try {
    const { TimingEnum } = Enums;
    // timeEnd() clears timingKeys but never timeStartedAt, so the start instant
    // is still readable here even though the timer has been stopped. Guard on
    // the timestamp rather than on timingKeys for that reason.
    const startedAt = log.timeStartedAt?.[TimingEnum.STUDY_TO_FIRST_IMAGE];
    if (startedAt === undefined) {
      return;
    }
    (window as any).__capturePostHogEvent?.('all_images_rendered', {
      viewports: viewportsThisStudy,
      modality: getRenderedModality(evt),
      cluster: window.location.host,
      // Latched at first paint. By the time the last viewport lands,
      // hasCapturedFirstImageThisPageLoad is already true and would read
      // 'in_app' for every study including the first.
      switch_type: switchTypeThisStudy,
      // Same window as first_image_rendered's flag but a longer one, so it is
      // strictly more likely to trip. Exclude at query time, do not drop here.
      hidden_during_load: wasHiddenDuringWindow(startedAt),
    });
  } catch (e) {
    console.warn('[PostHog] all_images_rendered capture failed', e);
  }
}

/**
 * Reports STUDY_TO_FIRST_IMAGE to PostHog as `first_image_rendered` — the
 * clinician-perceived study-open → first-image-on-screen time. Fires once per
 * study load: only while the STUDY_TO_FIRST_IMAGE timer is still running, i.e.
 * before the log.timeEnd() call below this one stops it for later viewports.
 * Samples whose measured window overlapped a hidden tab are flagged
 * `hidden_during_load` — see wasHiddenDuringWindow above. They measure
 * time-until-refocus, not load latency, and must be excluded at query time.
 * No patient data in the properties.
 */
function captureFirstImageRendered(evt) {
  try {
    const { TimingEnum } = Enums;
    const startedAt = log.timeStartedAt?.[TimingEnum.STUDY_TO_FIRST_IMAGE];
    if (!log.timingKeys[TimingEnum.STUDY_TO_FIRST_IMAGE] || startedAt === undefined) {
      return;
    }
    const switch_type = hasCapturedFirstImageThisPageLoad ? 'in_app' : 'reload';
    hasCapturedFirstImageThisPageLoad = true;
    switchTypeThisStudy = switch_type;
    (window as any).__capturePostHogEvent?.('first_image_rendered', {
      // `ms` starts at defaultRouteInit, AFTER the tab opened, the bundle loaded
      // and the app booted, so it under-reports by the whole boot. The
      // clinician-perceived number is `ms_since_navigation_start`, which
      // capturePostHogEvent now stamps on every event — see its header for why
      // that clock and not page_load_started_at against the event timestamp.
      ms: Math.round(performance.now() - startedAt),
      modality: getRenderedModality(evt),
      cluster: window.location.host,
      switch_type,
      // Flagged, not dropped, because dropping would emit no event at all —
      // indistinguishable from "the viewer never rendered", the signal we use
      // to judge whether backgrounded tabs explain the never-render rate. A
      // guard must not manufacture the thing it is measuring.
      //
      // THE EXISTING INSIGHTS ARE NOT ALREADY CLEAN. Measured 2026-09-01: 16
      // saved insights reference first_image_rendered and NONE of them exclude
      // hidden samples. Some already carry a hand-rolled parked-tab heuristic
      // (their SQL labels it as such), which is not the same thing and does not
      // make them clean.
      //
      // An upper `secs` bound is not a substitute either: over a rolling 14 days
      // to 2026-09-01 a 600s bound dropped roughly 350 of ~44,000 samples while
      // RETAINING over 1,500 above 10s, several hundred of those past a minute.
      // Deliberately rounded -- a rolling window does not reproduce to the digit
      // and precise-looking figures here have gone stale twice. Re-measure if
      // the exact numbers matter; the magnitude is the argument.
      //
      // So every percentile and rate tile needs
      // `properties.hidden_during_load != 'true'` added explicitly — the
      // string, since PostHog stores custom booleans as JSON strings.
      //
      // THAT FILTER FAILS OPEN, AND MUST BE PAIRED WITH A PRESENCE GUARD.
      // With the property absent, `!= 'true'` retains EVERY row -- HogQL wraps
      // it in ifNull(..., 1). That is a structural ratio, not a sample, so no
      // row count is quoted: re-check it with a count over your own window
      // rather than against a number here. That is what makes it safe on
      // pre-deploy history, and it is the same reason it silently reverts every
      // tile to the polluted numbers if this branch is rolled back, the
      // property is renamed, or capture regresses. A tile cannot tell that from
      // "no hidden samples today". Gate on
      // `JSONHas(properties, 'hidden_during_load') AND properties.hidden_during_load != 'true'`
      // wherever the tile must fail closed, exactly as the anti-join in
      // posthog.ts is gated on lifetime render count.
      //
      // That gate has its own cost, so choose per tile rather than applying it
      // blindly: this branch has NOT deployed, so JSONHas currently matches zero
      // first_image_rendered rows, and a 30- or 90-day tile gated on it renders
      // NOTHING for every pre-deploy day -- visually identical to an outage.
      // Failing closed is the point; knowing which failure you bought is the
      // requirement. (No row count quoted: it only means "everything before the
      // deploy", and every attempt to pin it to a fixed number has drifted.)
      //
      // Do NOT import the "`= true` fails open" warning from that block. There
      // it describes an anti-join subquery, where matching nothing satisfies
      // NOT EXISTS for everyone. In an inclusion filter on a percentile tile,
      // `= true` matching nothing yields zero rows — fail-CLOSED and visibly
      // broken. The direction inverts with the query shape.
      hidden_during_load: wasHiddenDuringWindow(startedAt),
    });
  } catch {
    // Never let analytics break rendering.
  }
}

function getRenderedModality(evt): string | undefined {
  const viewport = getEnabledElement(evt.detail.element)?.viewport;
  const imageId = (viewport as any)?.getCurrentImageId?.();
  return imageId ? metaData.get('generalSeriesModule', imageId)?.modality : undefined;
}
