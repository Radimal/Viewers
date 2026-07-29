/**
 * Orthanc utility functions for generating UUIDs and handling downloads
 */

/**
 * Generates an Orthanc study UUID using SHA-1 hash
 * According to Orthanc docs: Studies are identified as the SHA-1 hash of the
 * concatenation of their PatientID tag (0010,0020) and their StudyInstanceUID tag (0020,000d)
 * with a pipe separator "|" between the concatenated DICOM tags.
 *
 * @param {string} patientId - The DICOM PatientID (0010,0020)
 * @param {string} studyInstanceUID - The DICOM StudyInstanceUID (0020,000d)
 * @returns {Promise<string>} The Orthanc study UUID (SHA-1 hash)
 */
export async function generateOrthancStudyUUID(patientId, studyInstanceUID) {
  if (!patientId || !studyInstanceUID) {
    throw new Error('Both patientId and studyInstanceUID are required');
  }

  const input = `${patientId}|${studyInstanceUID}`;

  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-1', data);

  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  const formattedUUID = [
    hashHex.slice(0, 8),
    hashHex.slice(8, 16),
    hashHex.slice(16, 24),
    hashHex.slice(24, 32),
    hashHex.slice(32, 40),
  ].join('-');

  return formattedUUID;
}

/** Five dash-separated 8-char lowercase hex groups, as Orthanc renders the SHA-1 above. */
export const ORTHANC_STUDY_ID_PATTERN = /^[0-9a-f]{8}(-[0-9a-f]{8}){4}$/;

export function isValidOrthancStudyId(studyId) {
  return typeof studyId === 'string' && ORTHANC_STUDY_ID_PATTERN.test(studyId);
}

/**
 * Orthanc's id is derivable from the study itself, so a `?studyId=` handed to us in a URL can be
 * checked rather than trusted. Returns null when we cannot derive one — crypto.subtle needs a
 * secure context, and an unavailable digest must not block a download.
 */
async function deriveStudyId(patientId, studyInstanceUID) {
  if (!patientId || !studyInstanceUID) {
    return null;
  }
  try {
    return await generateOrthancStudyUUID(patientId, studyInstanceUID);
  } catch (error) {
    console.warn('Could not derive Orthanc study id for verification:', error);
    return null;
  }
}

/**
 * Decide which Orthanc study id to download, refusing rather than guessing.
 *
 * The `studyId` param is unvalidated input: a truncated one (only the first of its five segments)
 * reached production, matched no case, and crashed the download endpoint. Because Orthanc derives
 * the id as SHA-1(PatientID|StudyInstanceUID), the URL's own patientId and StudyInstanceUIDs let us
 * recompute it and compare — the id is effectively self-certifying.
 *
 * - well-formed and matching, or nothing to compare against -> use it
 * - well-formed but contradicting the derived id -> refuse. One of the two is wrong and we cannot
 *   tell which, and guessing means possibly handing over another patient's study.
 * - malformed but derivable -> use the derived id, since that is provably the study named by the
 *   rest of the URL, and note the bad link.
 * - malformed and not derivable -> refuse with something the user can act on.
 */
export async function resolveDownloadStudyId({ studyId, patientId, studyInstanceUID }) {
  const derived = await deriveStudyId(patientId, studyInstanceUID);

  if (isValidOrthancStudyId(studyId)) {
    if (derived && derived !== studyId) {
      return {
        error:
          'This viewer link points at a different study than the one on screen. ' +
          'Reopen the case from Radimal to get a fresh link.',
        detail: `studyId ${studyId} does not match derived ${derived}`,
      };
    }
    return { studyId };
  }

  if (studyId) {
    if (derived) {
      console.warn(`Ignoring malformed studyId "${studyId}"; using derived ${derived}`);
      return { studyId: derived, recoveredFrom: studyId };
    }
    return {
      error:
        'This viewer link is incomplete, so the study to download cannot be identified. ' +
        'Reopen the case from Radimal to get a fresh link.',
      detail: `malformed studyId ${studyId} and nothing to derive from`,
    };
  }

  return derived ? { studyId: derived } : {};
}

/**
 * Downloads a study from the Orthanc server using the study UUID
 *
 * @param {string} orthancStudyUUID - The Orthanc study UUID
 * @param {string} baseUrl - The base URL of the Orthanc server (default: 'http://radimal-reporter.onrender.com')
 * @returns {Promise<void>}
 */
export async function downloadOrthancStudy(
  orthancStudyUUID,
  baseUrl = 'http://radimal-reporter.onrender.com',
  userId = null
) {
  if (!orthancStudyUUID) {
    throw new Error('Orthanc study UUID is required');
  }

  const params = new URLSearchParams({
    id: orthancStudyUUID,
    ids: '',
  });

  if (userId) {
    params.set('user_id', userId);
  }

  const downloadUrl = `${baseUrl}/orthanc/study/download?${params.toString()}`;

  console.log('Attempting download with:', { orthancStudyUUID, baseUrl, userId, downloadUrl });

  try {
    const response = await fetch(downloadUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        combine: [],
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    console.log('Server response:', data);

    if (!data.success) {
      throw new Error(data.error || 'Download failed');
    }

    if (data.urls && data.urls.length > 0) {
      for (let i = 0; i < data.urls.length; i++) {
        const downloadUrl = data.urls[i];

        const a = document.createElement('a');
        a.setAttribute('href', downloadUrl);
        a.setAttribute('download', '');
        a.click();

        if (i < data.urls.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    } else {
      throw new Error('No download URLs returned from server');
    }
  } catch (error) {
    console.error('Error downloading study:', error);
    throw error;
  }
}

/**
 * Downloads a study by PatientID and StudyInstanceUID
 * Combines UUID generation and download in one function
 *
 * @param {string} patientId - The DICOM PatientID (0010,0020)
 * @param {string} studyInstanceUID - The DICOM StudyInstanceUID (0020,000d)
 * @param {string} baseUrl - The base URL of the Orthanc server
 * @returns {Promise<void>}
 */
export async function downloadStudyByDICOMIds(patientId, studyInstanceUID, baseUrl) {
  const orthancUUID = await generateOrthancStudyUUID(patientId, studyInstanceUID);
  return downloadOrthancStudy(orthancUUID, baseUrl);
}
