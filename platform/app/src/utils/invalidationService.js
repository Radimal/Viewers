export const InvalidationService = {
  async invalidatePath(studyInstanceUID) {
    try {
      const response = await fetch(`/api/invalidate/${encodeURIComponent(studyInstanceUID)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
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
