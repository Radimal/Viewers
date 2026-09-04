/**
 * @param {*} cornerstone
 * @param {*} imageId
 */
function getImageSrcFromImageId(cornerstone, imageId) {
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
