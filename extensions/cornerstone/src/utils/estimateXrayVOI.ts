import { cache, imageLoader, metaData } from '@cornerstonejs/core';

/**
 * Radimal: pixel-percentile VOI for CR/DX images that ship no usable
 * WindowCenter/WindowWidth metadata (2nd/98th percentile window).
 */
export async function estimateXrayVOI(imageId: string) {
  let image = cache.getImage(imageId);
  if (!image) {
    image = await imageLoader.loadImage(imageId);
  }

  const pixelData = image?.getPixelData?.();
  if (!pixelData?.length) {
    return null;
  }

  // Typed-array copy sorts numerically without boxing ~9M values.
  const sorted = pixelData.slice().sort();
  const lower = sorted[Math.floor(sorted.length * 0.02)];
  const upper = sorted[Math.min(Math.ceil(sorted.length * 0.98), sorted.length - 1)];

  if (upper <= lower) {
    return null;
  }

  return { windowCenter: (lower + upper) / 2, windowWidth: upper - lower };
}

/** True when the instance metadata already defines a usable VOI. */
export function hasMetadataVOI(imageId: string): boolean {
  const voiLutModule = metaData.get('voiLutModule', imageId);
  const { windowCenter, windowWidth } = voiLutModule ?? {};
  const center = Array.isArray(windowCenter) ? windowCenter[0] : windowCenter;
  const width = Array.isArray(windowWidth) ? windowWidth[0] : windowWidth;
  return center != null && width != null && Number(width) > 0;
}
