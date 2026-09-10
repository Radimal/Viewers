import { utils } from '@ohif/core';

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
    // MONOCHROME1 CPU-rendering branch below rather than reimplementing it.
    if (renderedUrl) {
      return Promise.resolve(renderedUrl);
    }
  }

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
export default getImageSrcFromImageId;
