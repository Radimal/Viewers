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
 * Deliberately not `<img src={renderedUrl}>` with the URL resolved straight through: an image
 * element gives no way to tell a 404, a 401 or a CORS/COEP block apart from a decode failure, and
 * both the fallback and the telemetry below depend on knowing. `response.ok` is an explicit check,
 * and reading it here is one request whatever the caching posture happens to be.
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
 * @param {*} imageId
 */
function getImageSrcFromImageId(cornerstone, imageId) {
  const renderedUrl = utils.orthancUtils.renderedThumbnailUrlFor(imageId);

  // Deliberately not gated on a config key. The only candidate was `thumbnailRendering`, which the
  // app reads from the config its deployment writes at container start rather than from anything
  // in this repo — so a gate would have made shipping this depend on an infrastructure change
  // instead of a viewer release. Turning it off is a rollback.
  //
  // The origin applies the photometric interpretation, so this path also sidesteps the MONOCHROME1
  // CPU-rendering branch in canvasThumbnail rather than reimplementing it. That is the one
  // difference the fallback cannot catch, because it renders rather than fails.
  //
  // Falls back rather than resolving the URL unconditionally: an unrejectable promise silently
  // disables the caller's catch, and with it the thumbnail_load_failed telemetry, so a 404, a 401
  // or a CORS/COEP block would show a broken tile and report nothing. Any failure lands back on the
  // full-frame path, so the worst case is the behaviour this replaces.
  if (renderedUrl) {
    return renderedThumbnail(renderedUrl).catch(() => canvasThumbnail(cornerstone, imageId));
  }

  return canvasThumbnail(cornerstone, imageId);
}

export default getImageSrcFromImageId;
