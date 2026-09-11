import { utils } from '@ohif/core';

/**
 * Download the frame through cornerstone and shrink it onto a canvas. The historic path.
 */
function canvasThumbnail(cornerstone, imageId) {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    const startTime = Date.now();
    const imagePixelModule = cornerstone.metaData.get('imagePixelModule', imageId);
    const useCPURendering =
      imagePixelModule?.photometricInterpretation === 'MONOCHROME1';

    cornerstone.utilities
      .loadImageToCanvas({ canvas, imageId, thumbnail: true, useCPURendering })
      .then(imageId => {
        resolve(canvas.toDataURL());
      })
      .catch(error => {
        const duration = Date.now() - startTime;
        console.error('❌ Thumbnail load failed:', imageId, error.message || error, `(${duration}ms)`);
        reject(error);
      });
  });
}

/**
 * Read the origin-rendered thumbnail once and hand back a data URL.
 *
 * Deliberately not `<img src={renderedUrl}>` with the URL resolved straight through. Checking the
 * response before the <img> requests it — a probe Image, a HEAD — only costs nothing if the browser
 * may reuse it, and at the time of writing the rendered path inherits the `no-store` that the
 * DICOMweb origin sends on non-frame paths, so it would be a second round trip per thumbnail and
 * double the render load on Orthanc. That CPU is the stated risk of moving the downscale to the
 * origin at all. Reading the bytes once is correct either way, so this does not need revisiting if
 * that caching changes; check the response headers rather than trusting this sentence.
 *
 * A data URL rather than an object URL because the caller keeps these in a map for the life of the
 * panel and never revokes; `canvas.toDataURL()` on the path below has the same shape, so this frees
 * with the map entry instead of pinning a blob until the document unloads.
 */
function renderedThumbnail(renderedUrl) {
  return fetch(renderedUrl)
    .then(response => {
      if (!response.ok) {
        throw new Error(`rendered thumbnail ${response.status}`);
      }
      return response.blob();
    })
    .then(
      blob =>
        new Promise((resolve, reject) => {
          const reader = new FileReader();

          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        })
    );
}

/**
 * @param {*} cornerstone
 * @param {boolean} renderedThumbnails - when true, ask the origin for a downscaled JPEG instead of
 *   downloading and decoding the full frame. See `renderedThumbnailUrlFor`.
 * @param {*} imageId
 */
function getImageSrcFromImageId(cornerstone, renderedThumbnails, imageId) {
  if (renderedThumbnails) {
    const renderedUrl = utils.orthancUtils.renderedThumbnailUrlFor(imageId);

    // The origin applies the photometric interpretation, so this path also sidesteps the
    // MONOCHROME1 CPU-rendering branch in canvasThumbnail rather than reimplementing it.
    //
    // Falls back rather than resolving the URL unconditionally: an unrejectable promise silently
    // disables the caller's catch, and with it the thumbnail_load_failed telemetry, so a 404, a 401
    // or a CORS/COEP block would show a broken tile and report nothing.
    if (renderedUrl) {
      return renderedThumbnail(renderedUrl).catch(() => canvasThumbnail(cornerstone, imageId));
    }
  }

  return canvasThumbnail(cornerstone, imageId);
}

export default getImageSrcFromImageId;
