import { capturePostHogEvent } from './posthog';

const IMAGE_LOAD_TELEMETRY_EVENT = 'radimal:image-load-telemetry';

/** Extracts DICOM UIDs from a wadors/wadouri imageId so image-load events can
 * be joined against per-study telemetry (display_set_added, precache_*). */
function parseWadorsImageId(imageId: unknown): Record<string, string> {
  if (typeof imageId !== 'string') {
    return {};
  }
  const match = imageId.match(
    /studies\/([^/]+)\/series\/([^/]+)\/instances\/([^/]+)/
  );
  if (!match) {
    return {};
  }
  return {
    studyInstanceUid: match[1],
    seriesInstanceUid: match[2],
    sopInstanceUid: match[3],
  };
}

let _teardown: (() => void) | null = null;

/**
 * Subscribes to OHIF services and forwards domain events to PostHog.
 * Safe to call multiple times — re-subscribes idempotently. Every
 * subscription handler is wrapped in try/catch so a PostHog issue can
 * never bubble back into the viewer's event flow.
 */
export function startPostHogEventBridge(
  servicesManager: AppTypes.ServicesManager
): void {
  if (_teardown) {
    _teardown();
    _teardown = null;
  }

  const subs: Array<{ unsubscribe: () => void }> = [];

  try {
    const { displaySetService, measurementService } = servicesManager.services;

    if (displaySetService?.subscribe) {
      subs.push(
        displaySetService.subscribe(
          displaySetService.EVENTS.DISPLAY_SETS_ADDED,
          ({ displaySetsAdded }) => {
            try {
              (displaySetsAdded ?? []).forEach((ds: Record<string, unknown>) => {
                capturePostHogEvent('display_set_added', {
                  studyInstanceUid: ds?.StudyInstanceUID,
                  seriesInstanceUid: ds?.SeriesInstanceUID,
                  modality: ds?.Modality,
                  seriesDescription: ds?.SeriesDescription,
                });
              });
            } catch (e) {
              console.warn('[PostHog] DISPLAY_SETS_ADDED handler failed', e);
            }
          }
        )
      );
    }

    if (measurementService?.subscribe) {
      subs.push(
        measurementService.subscribe(
          measurementService.EVENTS.MEASUREMENT_ADDED,
          ({ measurement }) => {
            try {
              capturePostHogEvent('measurement_added', {
                toolName: measurement?.toolName,
                modality: measurement?.modality,
                studyInstanceUid: measurement?.referenceStudyUID,
                seriesInstanceUid: measurement?.referenceSeriesUID,
              });
            } catch (e) {
              console.warn('[PostHog] MEASUREMENT_ADDED handler failed', e);
            }
          }
        )
      );

      subs.push(
        measurementService.subscribe(
          measurementService.EVENTS.MEASUREMENT_REMOVED,
          ({ measurement }) => {
            try {
              capturePostHogEvent('measurement_removed', {
                measurementUid: measurement,
              });
            } catch (e) {
              console.warn('[PostHog] MEASUREMENT_REMOVED handler failed', e);
            }
          }
        )
      );
    }
  } catch (e) {
    console.warn('[PostHog] event bridge subscribe failed', e);
  }

  // Image-load recovery telemetry (stall aborts, retries, terminal failures)
  // is announced on a window CustomEvent channel by the cornerstone extension
  // and the study browser thumbnails — forward it with UIDs parsed from the
  // wadors imageId so failures are queryable per study/series/instance.
  const onImageLoadTelemetry = (evt: Event) => {
    try {
      const { event, imageId, ...rest } = (evt as CustomEvent).detail ?? {};
      if (!event) {
        return;
      }
      capturePostHogEvent(event, {
        imageId,
        ...parseWadorsImageId(imageId),
        ...rest,
      });
    } catch (e) {
      console.warn('[PostHog] image load telemetry handler failed', e);
    }
  };
  window.addEventListener(IMAGE_LOAD_TELEMETRY_EVENT, onImageLoadTelemetry);
  subs.push({
    unsubscribe: () => window.removeEventListener(IMAGE_LOAD_TELEMETRY_EVENT, onImageLoadTelemetry),
  });

  _teardown = () => {
    subs.forEach(s => {
      try {
        s.unsubscribe();
      } catch (e) {
        console.warn('[PostHog] unsubscribe failed', e);
      }
    });
  };
}

export function stopPostHogEventBridge(): void {
  if (_teardown) {
    _teardown();
    _teardown = null;
  }
}
