const RETRY_ATTEMPTS = 2;
const RETRY_BACKOFF_MS = 2000;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function dispatchTelemetry(event, detail) {
  try {
    window.dispatchEvent(
      new CustomEvent('radimal:image-load-telemetry', { detail: { event, ...detail } })
    );
  } catch {
    // Telemetry must never break thumbnail loading.
  }
}

function loadToDataUrl(cornerstone, imageId) {
  const canvas = document.createElement('canvas');
  return cornerstone.utilities
    .loadImageToCanvas({ canvas, imageId, thumbnail: true })
    .then(() => canvas.toDataURL());
}

/**
 * Renders a thumbnail data URL for an imageId, retrying transient failures.
 * Callers store the resolved data URL in the study browser's thumbnail map;
 * before retries existed, a single failed request meant a permanently blank
 * thumbnail for the whole session.
 *
 * @param {*} cornerstone
 * @param {*} imageId
 */
async function getImageSrcFromImageId(cornerstone, imageId) {
  const startTime = Date.now();
  let lastError;

  for (let attempt = 0; attempt <= RETRY_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await sleep(RETRY_BACKOFF_MS * Math.pow(2, attempt - 1));
    }
    try {
      const dataUrl = await loadToDataUrl(cornerstone, imageId);
      if (attempt > 0) {
        dispatchTelemetry('thumbnail_load_recovered', {
          imageId,
          attempts: attempt,
          durationMs: Date.now() - startTime,
        });
      }
      return dataUrl;
    } catch (error) {
      lastError = error;
      const duration = Date.now() - startTime;
      console.error(
        '❌ Thumbnail load failed:',
        imageId,
        error?.message || error,
        `(attempt ${attempt + 1}/${RETRY_ATTEMPTS + 1}, ${duration}ms)`
      );
    }
  }

  dispatchTelemetry('thumbnail_load_failed', {
    imageId,
    attempts: RETRY_ATTEMPTS,
    durationMs: Date.now() - startTime,
    message: lastError?.message,
  });
  throw lastError;
}

export default getImageSrcFromImageId;
