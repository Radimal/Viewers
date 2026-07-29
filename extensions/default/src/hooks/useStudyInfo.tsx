import { useState, useEffect } from 'react';

type StudyInfo = { PatientID: string; StudyInstanceUID: string };

/**
 * The StudyInstanceUID this viewer was asked to display. It drives retrieval, so it is by
 * definition the case on screen — unlike anything derived from load order.
 */
export const requestedStudyInstanceUID = (): string =>
  new URLSearchParams(window.location.search).get('StudyInstanceUIDs')?.split(',')[0] || '';

const studyInstanceUidOf = (displaySet: any): string =>
  (displaySet?.instances?.[0] || displaySet?.instance)?.StudyInstanceUID ||
  displaySet?.StudyInstanceUID ||
  '';

/**
 * Identity of the study being read, chosen deliberately rather than by array position.
 *
 * getActiveDisplaySets() returns ONE flat array holding every loaded study, in arrival order and
 * re-sortable from the study browser. So `[0]` is not "the current study": expanding a prior study
 * in the left panel, or changing the browser's sort, can put another patient's series first. That
 * matters because consumers act on this identity — cache invalidation purges a CDN path built from
 * it, and the download can fall back to deriving an Orthanc study id from it — so a wrong value
 * here means acting on the wrong study while reporting success.
 *
 * The requested UID is reported even before its metadata arrives, since it is correct on its own and
 * cache invalidation needs nothing else. PatientID stays empty until a display set provably
 * belonging to that study is loaded, so no caller can derive an identity from another study's
 * patient.
 */
export function selectStudyInfo(displaySets: any[], requested: string): StudyInfo {
  const available = displaySets || [];
  const displaySet = requested
    ? available.find(ds => studyInstanceUidOf(ds) === requested)
    : available[0];
  const instance = displaySet?.instances?.[0] || displaySet?.instance;

  return {
    StudyInstanceUID: requested || studyInstanceUidOf(available[0]),
    PatientID: instance?.PatientID || displaySet?.PatientID || '',
  };
}

/**
 * Current study information (StudyInstanceUID and PatientID) for the case being read.
 *
 * DISPLAY_SETS_ADDED alone keeps this current: selection is by UID, so re-sorting the display-set
 * array cannot change the answer, and the only thing that can is the matching study's metadata
 * arriving.
 */
function useStudyInfo(servicesManager: AppTypes.ServicesManager) {
  const { displaySetService } = servicesManager.services;

  const [studyInfo, setStudyInfo] = useState<StudyInfo>({ PatientID: '', StudyInstanceUID: '' });

  useEffect(() => {
    const updateStudyInfo = () => {
      const next = selectStudyInfo(
        displaySetService.getActiveDisplaySets(),
        requestedStudyInstanceUID()
      );
      setStudyInfo(prev =>
        prev.PatientID === next.PatientID && prev.StudyInstanceUID === next.StudyInstanceUID
          ? prev
          : next
      );
    };

    const subscription = displaySetService.subscribe(
      displaySetService.EVENTS.DISPLAY_SETS_ADDED,
      updateStudyInfo
    );

    updateStudyInfo();

    return () => subscription.unsubscribe();
  }, [displaySetService]);

  return { studyInfo };
}

export default useStudyInfo;
