export const InvalidationService = {
  async invalidatePath(studyInstanceUID) {
    try {
      const baseUrl = 'http://radimal-reporter.onrender.com/cdn/invalidate';
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
