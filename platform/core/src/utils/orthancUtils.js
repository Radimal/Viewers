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

  const downloadUrl = `${baseUrl}/orthanc/study/download?id=${orthancStudyUUID}${userId ? `&user_id=${userId}` : ''}`;

  console.log('Attempting download with:', { orthancStudyUUID, baseUrl, userId, downloadUrl });

  try {
    const response = await fetch(downloadUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        combine: null,
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
        a.href = downloadUrl;
        a.target = '_blank';
        a.download = `study-${orthancStudyUUID}-${i + 1}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

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
