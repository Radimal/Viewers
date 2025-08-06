import { useState, useEffect } from 'react';

/**
 * Custom hook to get current study information including StudyInstanceUID and PatientID
 * @param servicesManager - OHIF services manager
 * @returns Object containing studyInfo with PatientID and StudyInstanceUID
 */
function useStudyInfo(servicesManager: AppTypes.ServicesManager) {
  const { displaySetService } = servicesManager.services;

  const [studyInfo, setStudyInfo] = useState({
    PatientID: '',
    StudyInstanceUID: '',
  });

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
    } else if (displaySet) {
      setStudyInfo({
        PatientID: displaySet.PatientID || '',
        StudyInstanceUID: displaySet.StudyInstanceUID || '',
      });
    }
  };

  useEffect(() => {
    const subscription = displaySetService.subscribe(
      displaySetService.EVENTS.DISPLAY_SETS_ADDED,
      () => updateStudyInfo()
    );

    updateStudyInfo();

    return () => subscription.unsubscribe();
  }, [displaySetService]);

  return { studyInfo };
}

export default useStudyInfo;