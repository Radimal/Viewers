import { log, Enums } from '@ohif/core';
import { EVENTS, getEnabledElement, metaData } from '@cornerstonejs/core';

const IMAGE_TIMING_KEYS = [];

// False only until the first capture after a full page load. A study opened
// via in-app navigation (no reload) keeps this module instance alive, which
// is what distinguishes switch_type 'in_app' from 'reload'.
let hasCapturedFirstImageThisPageLoad = false;

// A hidden tab suspends requestAnimationFrame, so IMAGE_RENDERED can fire
// minutes — even hours — after the study was actually delivered, while
// performance.now() keeps counting. Those samples measure when the clinician
// came back to the tab, not how fast the study loaded.
let lastVisibilityChangeAt = 0;
document.addEventListener('visibilitychange', () => {
  lastVisibilityChangeAt = performance.now();
});

/**
 * True when the tab was hidden at any point in [startedAt, now]: either it is
 * hidden right now, or visibility flipped after the timer started — any flip
 * inside the window means one side of it was hidden.
 * Reported as `hidden_during_load`; filter on it at query time.
 * ponytail: one page-level timestamp, no per-timer bookkeeping — only one
 * first-image timer is ever in flight.
 */
export function wasHiddenDuringWindow(startedAt: number): boolean {
  return document.visibilityState !== 'visible' || lastVisibilityChangeAt > startedAt;
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
      TimingEnum.STUDY_TO_FIRST_IMAGE,
    );
  }

  if (!IMAGE_TIMING_KEYS.find(key => log.timingKeys[key])) {
    return;
  }
  imageTiming.viewportsWaiting += 1;
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
    (window as any).__capturePostHogEvent?.('first_image_rendered', {
      ms: Math.round(performance.now() - startedAt),
      modality: getRenderedModality(evt),
      cluster: window.location.host,
      switch_type,
      // Flagged, not dropped. A backgrounded tab measures time-until-refocus
      // (seen up to 1.8h), so percentile and rate tiles must exclude these —
      // the `secs >= 0 AND secs < 600` bound every first_image_rendered
      // insight already carries removes them from numerator and denominator
      // alike. Dropping instead would emit no event at all, which is
      // indistinguishable from "the viewer never rendered" — the signal we
      // now use to judge whether backgrounded tabs explain the never-render
      // rate. A guard must not manufacture the thing it is measuring.
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
