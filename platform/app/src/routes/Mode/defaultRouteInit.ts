import { DicomMetadataStore, log, utils, Enums } from '@ohif/core';
import getStudies from './studiesList';
import isSeriesFilterUsed from '../../utils/isSeriesFilterUsed';

const { getSplitParam, orthancUtils } = utils;

function isDuplicateStudyError(error: any): boolean {
  const details = error?.response?.Details;
  if (typeof details === 'string') {
    return /Multiple Series found/i.test(details);
  }
  return false;
}

// Tracks whether the duplicate study notification has already been shown
// (defaultRouteInit may be called more than once for the same study).
let shownDuplicateStudyNotification = false;

// When Orthanc reports a duplicate StudyInstanceUID, the WADO-RS metadata
// endpoint cannot disambiguate the two patient records and 404s. The vet app
// passes the intended Orthanc study UUID as `?studyId=` so we can
// auto-download the exact copy that matches the consultation; `?patientId=`
// lets us compute the UUID locally as a backup. `distinct_id` is forwarded
// for reporter-side attribution.
function handleDuplicateStudyError(uiNotificationService): void {
  if (shownDuplicateStudyNotification) {
    return;
  }
  shownDuplicateStudyNotification = true;

  const params = new URLSearchParams(window.location.search);
  const studyId = params.get('studyId');
  const distinctId = params.get('distinct_id');
  const patientIdParam = params.get('patientId') || params.get('PatientID');
  const studyInstanceUIDParam = params.get('StudyInstanceUIDs')?.split(',')[0];
  const reporterOrigin = orthancUtils.reporterOriginFor(window.location.origin);

  let downloadPromise: Promise<void> | null = null;
  if (studyId) {
    downloadPromise = orthancUtils.downloadOrthancStudy(studyId, reporterOrigin, distinctId);
  } else if (patientIdParam && studyInstanceUIDParam) {
    downloadPromise = orthancUtils.downloadStudyByDICOMIds(
      patientIdParam,
      studyInstanceUIDParam,
      reporterOrigin
    );
  }

  if (!downloadPromise) {
    uiNotificationService.show({
      title: 'Study Load Error',
      message:
        'Multiple patients share this study ID. As an alternative, you can use the download button in the top right.',
      type: 'error',
      autoClose: false,
    });
    return;
  }

  uiNotificationService.show({
    title: 'Study Load Error',
    message:
      'Multiple patients share this study ID. Downloading the correct copy automatically — check your browser for the file.',
    type: 'warning',
    autoClose: false,
  });

  downloadPromise.catch((downloadError: any) => {
    console.error('Auto-download for duplicate study failed:', downloadError);
    uiNotificationService.show({
      title: 'Download Failed',
      message: `Automatic download failed: ${downloadError?.message || 'Unknown error'}. Please use the download button in the top right.`,
      type: 'error',
      autoClose: false,
    });
  });
}

/**
 * Initialize the route.
 *
 * @param props.servicesManager to read services from
 * @param props.studyInstanceUIDs for a list of studies to read
 * @param props.dataSource to read the data from
 * @param props.filters filters from query params to read the data from
 * @returns array of subscriptions to cancel
 */
export async function defaultRouteInit(
  {
    servicesManager,
    studyInstanceUIDs,
    dataSource,
    filters,
    appConfig,
  }: withAppTypes & { studyInstanceUIDs?: string[]; appConfig?: AppTypes.Config },
  hangingProtocolId,
  stageIndex
) {
  const {
    displaySetService,
    hangingProtocolService,
    uiNotificationService,
    customizationService,
    viewportGridService,
  } = servicesManager.services;
  /**
   * Function to apply the hanging protocol when the minimum number of display sets were
   * received or all display sets retrieval were completed
   * @returns
   */
  function applyHangingProtocol() {
    const displaySets = displaySetService.getActiveDisplaySets();
    // The display sets are not necessarily in load order, even though the
    // series got started in load order, so re-sort them before hanging
    const sortCriteria = customizationService.getCustomization('sortingCriteria') as (
      a,
      b
    ) => number;

    if (!displaySets || !displaySets.length) {
      return;
    }
    const sortedDisplaySets = [...displaySets].sort(sortCriteria);

    // Gets the studies list to use
    const studies = getStudies(studyInstanceUIDs, sortedDisplaySets);

    // study being displayed, and is thus the "active" study.
    const activeStudy = studies[0];

    // run the hanging protocol matching on the displaySets with the predefined
    // hanging protocol in the mode configuration
    hangingProtocolService.run({ studies, activeStudy, displaySets: sortedDisplaySets }, hangingProtocolId, {
      stageIndex,
    });
  }

  const unsubscriptions = [];
  const issuedWarningSeries = [];
  const { unsubscribe: instanceAddedUnsubscribe } = DicomMetadataStore.subscribe(
    DicomMetadataStore.EVENTS.INSTANCES_ADDED,
    function ({ StudyInstanceUID, SeriesInstanceUID, madeInClient = false }) {
      const seriesMetadata = DicomMetadataStore.getSeries(StudyInstanceUID, SeriesInstanceUID);

      // checks if the series filter was used, if it exists
      const seriesInstanceUIDs = filters?.seriesInstanceUID;
      if (
        seriesInstanceUIDs?.length &&
        !isSeriesFilterUsed(seriesMetadata.instances, filters) &&
        !issuedWarningSeries.includes(seriesInstanceUIDs[0])
      ) {
        // stores the series instance filter so it shows only once the warning
        issuedWarningSeries.push(seriesInstanceUIDs[0]);
        uiNotificationService.show({
          title: 'Series filter',
          message: `Each of the series in filter: ${seriesInstanceUIDs} are not part of the current study. The entire study is being displayed`,
          type: 'error',
          duration: 7000,
        });
      }

      displaySetService.makeDisplaySets(seriesMetadata.instances, { madeInClient });
    }
  );

  unsubscriptions.push(instanceAddedUnsubscribe);

  log.time(Enums.TimingEnum.STUDY_TO_DISPLAY_SETS);
  log.time(Enums.TimingEnum.STUDY_TO_FIRST_IMAGE);

  const allRetrieves = studyInstanceUIDs.map(StudyInstanceUID =>
    dataSource.retrieve.series.metadata({
      StudyInstanceUID,
      filters,
      returnPromises: true,
      sortCriteria: customizationService.getCustomization('sortingCriteria'),
    })
  );

  // log the error if this fails, otherwise it's so difficult to tell what went wrong...
  allRetrieves.forEach(retrieve => {
    retrieve.catch(error => {
      console.error(error);
      if (isDuplicateStudyError(error)) {
        handleDuplicateStudyError(uiNotificationService);
      } else {
        uiNotificationService.show({
          title: 'Study Load Error',
          message: 'Failed to load study metadata. Please try refreshing the page.',
          type: 'error',
          autoClose: false,
        });
      }
    });
  });

  // is displaysets from URL and has initialSOPInstanceUID or initialSeriesInstanceUID
  // then we need to wait for all display sets to be retrieved before applying the hanging protocol
  const params = new URLSearchParams(window.location.search);

  const initialSeriesInstanceUID = getSplitParam('initialseriesinstanceuid', params);
  const initialSOPInstanceUID = getSplitParam('initialsopinstanceuid', params);

  let displaySetFromUrl = false;
  if (initialSeriesInstanceUID || initialSOPInstanceUID) {
    displaySetFromUrl = true;
  }

  // Every series metadata request started by the initial load, so the live poll can wait for them
  // instead of re-requesting series that are still downloading.
  const initialSeriesLoads = [];

  await Promise.allSettled(allRetrieves).then(async promises => {
    log.timeEnd(Enums.TimingEnum.STUDY_TO_DISPLAY_SETS);
    log.time(Enums.TimingEnum.DISPLAY_SETS_TO_FIRST_IMAGE);
    log.time(Enums.TimingEnum.DISPLAY_SETS_TO_ALL_IMAGES);

    const allPromises = [];
    const remainingPromises = [];

    function startRemainingPromises(remainingPromises) {
      remainingPromises.forEach(p =>
        p.forEach(p => {
          const started = p.start();
          initialSeriesLoads.push(started);
          started.catch(error => {
            console.error('Remaining series metadata fetch failed:', error);
          });
        })
      );
    }

    promises.forEach(promise => {
      const retrieveSeriesMetadataPromise = promise.value;
      if (!Array.isArray(retrieveSeriesMetadataPromise)) {
        return;
      }

      if (displaySetFromUrl) {
        const requiredSeriesPromises = retrieveSeriesMetadataPromise.map(promise => {
          const p = promise.start();
          p.catch(() => {}); // Handled by Promise.allSettled below
          return p;
        });
        allPromises.push(Promise.allSettled(requiredSeriesPromises));
        initialSeriesLoads.push(...requiredSeriesPromises);
      } else {
        const { requiredSeries, remaining } = hangingProtocolService.filterSeriesRequiredForRun(
          hangingProtocolId,
          retrieveSeriesMetadataPromise
        );
        const requiredSeriesPromises = requiredSeries.map(promise => {
          const p = promise.start();
          p.catch(() => {}); // Handled by Promise.allSettled below
          return p;
        });
        allPromises.push(Promise.allSettled(requiredSeriesPromises));
        initialSeriesLoads.push(...requiredSeriesPromises);
        remainingPromises.push(remaining);
      }
    });

    await Promise.allSettled(allPromises).then(studyResults => {
      let hasDuplicateStudyError = false;
      let hasOtherSeriesError = false;

      studyResults.forEach(studyResult => {
        if (studyResult.status === 'fulfilled' && Array.isArray(studyResult.value)) {
          studyResult.value.forEach(seriesResult => {
            if (seriesResult.status === 'rejected') {
              console.error('Series metadata fetch failed:', seriesResult.reason);
              if (isDuplicateStudyError(seriesResult.reason)) {
                hasDuplicateStudyError = true;
              } else {
                hasOtherSeriesError = true;
              }
            }
          });
        }
      });

      if (hasDuplicateStudyError) {
        handleDuplicateStudyError(uiNotificationService);
      } else if (hasOtherSeriesError) {
        uiNotificationService.show({
          title: 'Study Load Error',
          message: 'Some series in this study failed to load. Please try refreshing the page.',
          type: 'error',
          autoClose: false,
        });
      }

      applyHangingProtocol();
    });
    startRemainingPromises(remainingPromises);
    applyHangingProtocol();
  });

  const pollMs = appConfig?.liveStudyPollIntervalMs ?? 10000;
  if (pollMs > 0) {
    unsubscriptions.push(
      startLiveStudyPoll({
        studyInstanceUIDs,
        dataSource,
        filters,
        pollMs,
        uiNotificationService,
        ready: Promise.allSettled(initialSeriesLoads),
      })
    );
    unsubscriptions.push(fillEmptyViewportsOnArrival({ displaySetService, viewportGridService }));
  }

  return unsubscriptions;
}

/**
 * Once the initial hang is done, drop each newly created image display set into the first empty
 * viewport, so a specialist sitting in a 2x2 layout sees arriving images without re-picking the
 * layout. Non-image display sets (SR, SEG, unsupported) are left to the panels.
 *
 * @returns a function that stops listening
 */
function fillEmptyViewportsOnArrival({ displaySetService, viewportGridService }) {
  const { unsubscribe } = displaySetService.subscribe(
    displaySetService.EVENTS.DISPLAY_SETS_ADDED,
    ({ displaySetsAdded }) => {
      const { viewports } = viewportGridService.getState();
      const empty = [...viewports.values()].filter(v => !v.displaySetInstanceUIDs?.length);
      const images = displaySetsAdded.filter(ds => !ds.unsupported && ds.numImageFrames > 0);
      const assignments = images.slice(0, empty.length).map((ds, i) => ({
        viewportId: empty[i].viewportId,
        displaySetInstanceUIDs: [ds.displaySetInstanceUID],
      }));
      if (assignments.length) {
        console.info('[LiveStudyPoll] filling empty viewports', assignments);
        viewportGridService.setDisplaySetsForViewports(assignments);
      }
    }
  );
  return unsubscribe;
}

// After this many consecutive quiet ticks (30 ticks at the default 10s = 5
// minutes) the poll IDLES to a slow interval instead of stopping — a wet-read
// study can receive images at any point while it is open (a re-sent old study
// too, which is why there is deliberately NO StudyDate age gate: acquisition
// time says nothing about ingest time). Growth snaps it back to the fast
// interval, so the worst case is one idle-interval delay before images flow.
const LIVE_POLL_MAX_QUIET_TICKS = 30;
const LIVE_POLL_IDLE_INTERVAL_MS = 60 * 1000;
// At most one "images arriving" toast per this window, so a burst of ticks
// doesn't stack notifications.
const LIVE_POLL_NOTIFY_THROTTLE_MS = 60 * 1000;

/**
 * Re-queries the study's series list on an interval so images stored in Orthanc after the
 * study was opened show up without a reload. Series metadata is only re-fetched for series
 * that are new or whose QIDO NumberOfSeriesRelatedInstances exceeds what the store holds;
 * DicomMetadataStore.addInstances dedupes by SOPInstanceUID, and the stack SOP class handler's
 * addInstances grows the existing display set so the open viewport refreshes in place.
 *
 * Re-land guards (see the revert ticket for 7ac1202e52): polling is gated to recent
 * studies, stops itself after a quiet period, and pauses while the tab is hidden.
 *
 * @returns a function that stops the poll
 */
function startLiveStudyPoll({
  studyInstanceUIDs,
  dataSource,
  filters,
  pollMs,
  uiNotificationService,
  ready = Promise.resolve(),
}) {
  let inFlight = false;
  let quietTicks = 0;
  let idle = false;
  let lastNotifiedAt = 0;
  // Series whose metadata fetch is still pending; Orthanc can take minutes to answer while it is
  // ingesting, and stacking duplicate requests for the same series only makes that worse.
  const pendingSeries = new Set<string>();

  let timer;
  let stopped = false;

  function currentInterval() {
    return idle ? LIVE_POLL_IDLE_INTERVAL_MS : pollMs;
  }

  function setIdle(nextIdle) {
    if (idle === nextIdle) {
      return;
    }
    idle = nextIdle;
    if (timer) {
      clearInterval(timer);
      timer = setInterval(poll, currentInterval());
    }
    console.info(
      idle
        ? `[LiveStudyPoll] idling (${LIVE_POLL_IDLE_INTERVAL_MS}ms) after quiet period`
        : `[LiveStudyPoll] resuming fast poll (${pollMs}ms)`
    );
  }

  function notifyArrival(grownCount) {
    const now = Date.now();
    if (now - lastNotifiedAt < LIVE_POLL_NOTIFY_THROTTLE_MS) {
      return;
    }
    lastNotifiedAt = now;
    uiNotificationService?.show({
      title: 'New images arriving',
      message: `${grownCount} series receiving new images.`,
      type: 'info',
      duration: 4000,
    });
  }

  function stop(reason) {
    if (stopped) {
      return;
    }
    stopped = true;
    clearInterval(timer);
    timer = undefined;
    document.removeEventListener('visibilitychange', onVisibilityChange);
    if (reason) {
      console.info(`[LiveStudyPoll] stopped: ${reason}`);
    }
  }

  async function poll() {
    if (inFlight || document.hidden) {
      return;
    }
    inFlight = true;
    let grownThisTick = 0;
    try {
      for (const StudyInstanceUID of studyInstanceUIDs) {
        // The data source caches the study metadata promise; drop it so this is a real re-query.
        dataSource.deleteStudyMetadataPromise?.(StudyInstanceUID);
        const seriesPromises = await dataSource.retrieve.series.metadata({
          StudyInstanceUID,
          filters,
          returnPromises: true,
        });
        // Non-lazy data sources store everything themselves and return a summary object.
        if (!Array.isArray(seriesPromises)) {
          console.info(`[LiveStudyPoll] ${StudyInstanceUID}: non-lazy data source, full re-fetch`);
          continue;
        }
        const fetched = [];
        for (const seriesPromise of seriesPromises) {
          const { SeriesInstanceUID, NumberOfSeriesRelatedInstances } =
            seriesPromise.metadata ?? {};
          const known =
            DicomMetadataStore.getSeries(StudyInstanceUID, SeriesInstanceUID)?.instances.length ??
            0;
          // ponytail: if the server omits NumberOfSeriesRelatedInstances we re-fetch every series
          // each poll; switch to QIDO instance search if that ever costs too much. (Verified
          // 2026-09-10 against production QIDO: Orthanc returns 00201209 in the default series
          // response, with or without an explicit includefield — the guarantee is Orthanc's
          // behaviour, not the spec.)
          if (pendingSeries.has(SeriesInstanceUID)) {
            continue;
          }
          if (!known || !(NumberOfSeriesRelatedInstances <= known)) {
            fetched.push(`${SeriesInstanceUID} (${known} -> ${NumberOfSeriesRelatedInstances})`);
            pendingSeries.add(SeriesInstanceUID);
            seriesPromise
              .start()
              .catch(error => {
                // Orthanc answers 409 when the series is being written at that instant; the next
                // tick still sees the count mismatch and retries, so this is expected, not a failure.
                if (error?.status === 409) {
                  console.info(
                    `[LiveStudyPoll] ${SeriesInstanceUID} mid-write (409), retrying next tick`
                  );
                  return;
                }
                console.warn('[LiveStudyPoll] series metadata fetch failed', error);
              })
              .finally(() => pendingSeries.delete(SeriesInstanceUID));
          }
        }
        grownThisTick += fetched.length;
        if (fetched.length) {
          console.info(
            `[LiveStudyPoll] ${StudyInstanceUID}: ${seriesPromises.length} series, ${fetched.length} new/grown`,
            fetched
          );
        }
      }
    } catch (error) {
      console.warn('[LiveStudyPoll] poll failed', error);
    } finally {
      inFlight = false;
    }

    if (grownThisTick > 0) {
      quietTicks = 0;
      setIdle(false);
      notifyArrival(grownThisTick);
    } else if (++quietTicks >= LIVE_POLL_MAX_QUIET_TICKS) {
      setIdle(true);
    }
  }

  // A hidden tab keeps no timer at all; restart on return instead of no-op ticks.
  function onVisibilityChange() {
    if (stopped) {
      return;
    }
    if (document.hidden) {
      clearInterval(timer);
      timer = undefined;
    } else if (!timer) {
      timer = setInterval(poll, currentInterval());
      // Coming back to the tab is a strong "is anything new?" signal.
      poll();
    }
  }

  // Don't compete with the initial load: the first tick waits until every series metadata request
  // from study open has settled, so the viewer starts exactly as fast as it did without polling.
  ready.then(() => {
    if (stopped) {
      return;
    }
    console.info(
      `[LiveStudyPoll] polling ${studyInstanceUIDs.length} study(ies) every ${pollMs}ms (idles to ${LIVE_POLL_IDLE_INTERVAL_MS}ms after ${LIVE_POLL_MAX_QUIET_TICKS} quiet ticks)`
    );
    document.addEventListener('visibilitychange', onVisibilityChange);
    if (!document.hidden) {
      timer = setInterval(poll, pollMs);
    }
  });
  return () => stop();
}
