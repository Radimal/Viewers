/**
 *
 * @param {string[]} primaryStudyInstanceUIDs
 * @param {object[]} studyDisplayList
 * @param {string} studyDisplayList.studyInstanceUid
 * @param {string} studyDisplayList.date
 * @param {string} studyDisplayList.description
 * @param {string} studyDisplayList.modalities
 * @param {number} studyDisplayList.numInstances
 * @param {object[]} displaySets
 * @param {number} recentTimeframe - The number of milliseconds to consider a study recent
 * @returns tabs - The prop object expected by the StudyBrowser component
 */

export function createStudyBrowserTabs(
  primaryStudyInstanceUIDs,
  studyDisplayList,
  displaySets,
  recentTimeframeMS = 31536000000
) {
  const primaryStudies = [];
  const allStudies = [];
  const patientStudies = [];

  studyDisplayList.forEach(study => {
    const displaySetsForStudy = displaySets
      .filter(ds => ds.StudyInstanceUID === study.studyInstanceUid)
      .map(ds => ({
        ...ds,
        birthDate: study.birthDate,
        institutionName: study.institutionName,
        patientName: study.patientName,
      }));
    const tabStudy = Object.assign({}, study, { displaySets: displaySetsForStudy });

    if (primaryStudyInstanceUIDs.includes(study.studyInstanceUid)) {
      primaryStudies.push(tabStudy);
    }
    allStudies.push(tabStudy);
  });

  const normalize = val => {
    if (val === undefined || val === null || val === '') {
      return '';
    }
    if (typeof val === 'object' && val.Alphabetic) {
      return String(val.Alphabetic).trim().toLowerCase();
    }
    return String(val).trim().toLowerCase();
  };

  allStudies.forEach(study => {
    // Primary studies should always appear in patientStudies
    const isPrimaryStudy = primaryStudyInstanceUIDs.includes(study.studyInstanceUid);

    const matchesPrimaryPatient = primaryStudies.some(p => {
      // If patientName is available on both, use it as the primary match criteria
      const studyName = normalize(study.patientName);
      const primaryName = normalize(p.patientName);

      if (studyName && primaryName) {
        return studyName === primaryName;
      }

      // Fallback: match on institution and birthDate if names aren't available
      return (
        normalize(study.institutionName) === normalize(p.institutionName) &&
        normalize(study.birthDate) === normalize(p.birthDate)
      );
    });

    if (isPrimaryStudy || matchesPrimaryPatient) {
      patientStudies.push(study);
    }
  });

  const primaryStudiesTimestamps = primaryStudies
    .filter(study => study.date)
    .map(study => new Date(study.date).getTime());

  const recentStudies =
    primaryStudiesTimestamps.length > 0
      ? patientStudies.filter(study => {
          const oldestPrimaryTimeStamp = Math.min(...primaryStudiesTimestamps);

          if (!study.date) {
            return false;
          }
          const studyTimeStamp = new Date(study.date).getTime();
          return oldestPrimaryTimeStamp - studyTimeStamp < recentTimeframeMS;
        })
      : [];
  // Newest first, considering both date and time
  const _byDateTime = (studyA, studyB) => {
    const dateA = Date.parse(studyA.date) || 0;
    const dateB = Date.parse(studyB.date) || 0;

    if (dateA !== dateB) {
      return dateB - dateA;
    }

    // When dates are the same, compare by StudyTime (DICOM format: HHmmss or HHmmss.SSS)
    const timeA = studyA.time || '';
    const timeB = studyB.time || '';
    return timeB.localeCompare(timeA);
  };
  const tabs = [
    {
      name: 'primary',
      label: 'Primary',
      studies: primaryStudies.sort(_byDateTime),
    },
    {
      name: 'recent',
      label: 'Recent',
      studies: recentStudies.sort(_byDateTime),
    },
    {
      name: 'all',
      label: 'All',
      studies: patientStudies.sort(_byDateTime),
    },
  ];

  return tabs;
}
