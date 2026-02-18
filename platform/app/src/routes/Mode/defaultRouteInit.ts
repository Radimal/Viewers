import getStudies from './studiesList';
import { DicomMetadataStore, log } from '@ohif/core';
import isSeriesFilterUsed from '../../utils/isSeriesFilterUsed';

import { utils, Enums } from '@ohif/core';

const { sortingCriteria, getSplitParam } = utils;

/**
 * Check if an error from dicomweb-client indicates a duplicate/conflicting study
 * in Orthanc (same StudyInstanceUID with different PatientIDs).
 */
function isDuplicateStudyError(error: any): boolean {
  const details = error?.response?.Details;
  if (typeof details === 'string') {
    return /Multiple Series found/i.test(details);
  }
  return false;
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
  { servicesManager, studyInstanceUIDs, dataSource, filters, appConfig }: withAppTypes,
  hangingProtocolId,
  stageIndex
) {
  const { displaySetService, hangingProtocolService, uiNotificationService, customizationService } =
    servicesManager.services;
  /**
   * Function to apply the hanging protocol when the minimum number of display sets were
   * received or all display sets retrieval were completed
   * @returns
   */
  function applyHangingProtocol() {
    const displaySets = displaySetService.getActiveDisplaySets();

    if (!displaySets || !displaySets.length) {
      return;
    }

    // Gets the studies list to use
    const studies = getStudies(studyInstanceUIDs, displaySets);

    // study being displayed, and is thus the "active" study.
    const activeStudy = studies[0];

    // run the hanging protocol matching on the displaySets with the predefined
    // hanging protocol in the mode configuration
    hangingProtocolService.run({ studies, activeStudy, displaySets }, hangingProtocolId, {
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
      sortCriteria:
        customizationService.get('sortingCriteria') ||
        sortingCriteria.seriesSortCriteria.seriesInfoSortingCriteria,
    })
  );

  // log the error if this fails, otherwise it's so difficult to tell what went wrong...
  allRetrieves.forEach(retrieve => {
    retrieve.catch(error => {
      console.error(error);
      uiNotificationService.show(
        isDuplicateStudyError(error)
          ? {
              title: 'Study Load Error',
              message:
                'This study may be a duplicate and could not be loaded. Please download the study using the download button in the top right of the viewer instead.',
              type: 'error',
              autoClose: false,
            }
          : {
              title: 'Study Load Error',
              message: 'Failed to load study metadata. Please try refreshing the page.',
              type: 'error',
              autoClose: false,
            }
      );
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

  await Promise.allSettled(allRetrieves).then(async promises => {
    log.timeEnd(Enums.TimingEnum.STUDY_TO_DISPLAY_SETS);
    log.time(Enums.TimingEnum.DISPLAY_SETS_TO_FIRST_IMAGE);
    log.time(Enums.TimingEnum.DISPLAY_SETS_TO_ALL_IMAGES);

    const allPromises = [];
    const remainingPromises = [];

    function startRemainingPromises(remainingPromises) {
      remainingPromises.forEach(p => p.forEach(p => p.start()));
    }

    promises.forEach(promise => {
      const retrieveSeriesMetadataPromise = promise.value;
      if (!Array.isArray(retrieveSeriesMetadataPromise)) {
        return;
      }

      if (displaySetFromUrl) {
        const requiredSeriesPromises = retrieveSeriesMetadataPromise.map(promise =>
          promise.start()
        );
        allPromises.push(Promise.allSettled(requiredSeriesPromises));
      } else {
        const { requiredSeries, remaining } = hangingProtocolService.filterSeriesRequiredForRun(
          hangingProtocolId,
          retrieveSeriesMetadataPromise
        );
        const requiredSeriesPromises = requiredSeries.map(promise => promise.start());
        allPromises.push(Promise.allSettled(requiredSeriesPromises));
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
        uiNotificationService.show({
          title: 'Study Load Error',
          message:
            'This study may be a duplicate and could not be loaded. Please download the study using the download button in the top right of the viewer instead.',
          type: 'error',
          autoClose: false,
        });
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

  return unsubscriptions;
}
