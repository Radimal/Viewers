/**
 * @param {*} cornerstone
 * @param {*} imageId
 */
function getImageSrcFromImageId(cornerstone, imageId) {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    const imagePixelModule = cornerstone.metaData.get('imagePixelModule', imageId);
    const useCPURendering =
      imagePixelModule?.photometricInterpretation === 'MONOCHROME1';

    cornerstone.utilities
      .loadImageToCanvas({ canvas, imageId, thumbnail: true, useCPURendering })
      .then(imageId => {
        resolve(canvas.toDataURL());
      })
      .catch(reject);
  });
}

export default getImageSrcFromImageId;
