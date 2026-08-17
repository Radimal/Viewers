import { useState, useEffect } from 'react';
import { useSystem } from '@ohif/core';

/**
 * Radimal: current study identity (StudyInstanceUID + PatientID) for the
 * header's Download Study / Reload Study actions. Follows the 3.13 hook
 * idiom (useSystem, no servicesManager argument — the fork's version
 * predates useSystem).
 */
function useStudyInfo() {
  const { servicesManager } = useSystem();
  const { displaySetService } = servicesManager.services;

  const [studyInfo, setStudyInfo] = useState({
    PatientID: '',
    StudyInstanceUID: '',
  });

  useEffect(() => {
    const updateStudyInfo = () => {
      const displaySets = displaySetService.getActiveDisplaySets();
      const displaySet = displaySets[0];

      if (!displaySet) {
        return;
      }

      const instance = displaySet?.instances?.[0] || displaySet?.instance;

      if (instance) {
        setStudyInfo({
          PatientID: instance.PatientID || '',
          StudyInstanceUID: instance.StudyInstanceUID || '',
        });
      } else {
        setStudyInfo({
          PatientID: displaySet.PatientID || '',
          StudyInstanceUID: displaySet.StudyInstanceUID || '',
        });
      }
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
