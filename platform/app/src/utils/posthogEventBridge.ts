import { capturePostHogEvent } from './posthog';

let _teardown: (() => void) | null = null;

/**
 * Subscribes to OHIF services and forwards domain events to PostHog.
 * Safe to call multiple times — re-subscribes idempotently. Every
 * subscription handler is wrapped in try/catch so a PostHog issue can
 * never bubble back into the viewer's event flow.
 */
export function startPostHogEventBridge(servicesManager: AppTypes.ServicesManager): void {
  if (_teardown) {
    _teardown();
    _teardown = null;
  }

  const subs: Array<{ unsubscribe: () => void }> = [];

  try {
    const {
      displaySetService,
      measurementService,
      cornerstoneViewportService,
      cineService,
      viewportGridService,
    } = servicesManager.services;

    // Tracks the display set currently shown in each viewport so we can
    // (a) dedupe re-broadcasts for the same display set and (b) attribute
    // cine play events to the display set being played.
    const shownDisplaySetByViewport = new Map<string, string>();
    const changeCountByViewport = new Map<string, number>();

    const describeDisplaySet = (displaySetInstanceUID: string): Record<string, unknown> => {
      const ds = displaySetService?.getDisplaySetByUID?.(displaySetInstanceUID) as
        | {
            instance?: Record<string, unknown>;
            instances?: Record<string, unknown>[];
            StudyInstanceUID?: string;
            SeriesInstanceUID?: string;
            Modality?: string;
            SeriesDescription?: string;
            numImageFrames?: number;
          }
        | undefined;
      const instance = ds?.instance ?? ds?.instances?.[0];
      return {
        displaySetInstanceUid: displaySetInstanceUID,
        studyInstanceUid: ds?.StudyInstanceUID,
        seriesInstanceUid: ds?.SeriesInstanceUID,
        modality: ds?.Modality,
        seriesDescription: ds?.SeriesDescription,
        instanceNumber: instance?.InstanceNumber,
        numberOfFrames: instance?.NumberOfFrames ?? ds?.numImageFrames,
      };
    };

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

    if (cornerstoneViewportService?.subscribe) {
      subs.push(
        cornerstoneViewportService.subscribe(
          cornerstoneViewportService.EVENTS.VIEWPORT_DATA_CHANGED,
          ({ viewportData, viewportId }) => {
            try {
              const primaryUid = (viewportData?.data ?? [])
                .map((d: Record<string, unknown>) => d?.displaySetInstanceUID)
                .find(Boolean) as string | undefined;
              if (!primaryUid) {
                return;
              }
              // The service re-broadcasts on presentation-only updates too —
              // only capture actual display set swaps in the viewport.
              if (shownDisplaySetByViewport.get(viewportId) === primaryUid) {
                return;
              }
              shownDisplaySetByViewport.set(viewportId, primaryUid);
              const changeIndex = changeCountByViewport.get(viewportId) ?? 0;
              changeCountByViewport.set(viewportId, changeIndex + 1);
              capturePostHogEvent('viewport_displayset_changed', {
                viewportId,
                changeIndex,
                // changeIndex 0 is the hanging protocol's initial assignment;
                // anything after that came from a user action (thumbnail
                // click/drag, next-series, etc.).
                trigger: changeIndex === 0 ? 'auto' : 'user',
                ...describeDisplaySet(primaryUid),
              });
            } catch (e) {
              console.warn('[PostHog] VIEWPORT_DATA_CHANGED handler failed', e);
            }
          }
        )
      );
    }

    if (cineService?.subscribe) {
      subs.push(
        cineService.subscribe(cineService.EVENTS.CINE_STATE_CHANGED, state => {
          try {
            const activeViewportId = viewportGridService?.getActiveViewportId?.();
            const activeUid = activeViewportId
              ? shownDisplaySetByViewport.get(activeViewportId)
              : undefined;
            capturePostHogEvent('cine_state_changed', {
              isPlaying: state?.isPlaying,
              isCineEnabled: state?.isCineEnabled,
              viewportId: activeViewportId,
              ...(activeUid ? describeDisplaySet(activeUid) : {}),
            });
          } catch (e) {
            console.warn('[PostHog] CINE_STATE_CHANGED handler failed', e);
          }
        })
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
