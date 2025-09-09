export const InvalidationService = {
  async invalidatePath(studyInstanceUID) {
    try {
      function getReporterOrigin() {
        const origin = window.location.origin;

        if (origin === 'http://localhost:3000') {
          return 'http://localhost:5007';
        } else if (origin === 'https://viewer.stage-1.radimal.ai') {
          return 'https://reporter-staging.onrender.com';
        } else if (origin === 'https://view.radimal.ai') {
          return 'https://radimal-reporter.onrender.com';
        } else {
          return 'https://radimal-reporter.onrender.com';
        }
      }
      const baseUrl = getReporterOrigin() + '/cdn/invalidate';
      const body = {
        path: `/dicom-web/studies/${studyInstanceUID}/*`,
      };

      const response = await fetch(baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      return result;
    } catch (error) {
      console.error('Failed to invalidate path:', error);
      throw error;
    }
  },
};
