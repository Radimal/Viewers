import { capturePostHogEvent } from './posthog';

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
