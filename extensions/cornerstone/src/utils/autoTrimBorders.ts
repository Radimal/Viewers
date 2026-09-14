import { cache } from '@cornerstonejs/core';
import { isStackViewportType } from './getLegacyViewportType';

/**
 * Radimal: crop away collimation borders on CR/DX by scanning the pixel
 * data for the content bounding box and setting a displayArea (crop by
 * zoom+pan, not a pixel crop). Returns false when the viewport/image is
 * not ready (caller may retry), true otherwise.
 *
 * cs3d's legacy setDisplayArea resets the camera internally, so
 * user-applied rotation/flip is saved and restored around it (a no-op on
 * the native lane, whose setViewState merge leaves them untouched).
 */
export function autoTrimBorders(viewport): boolean {
  if (!viewport || !isStackViewportType(viewport)) {
    return false;
  }

  const imageId = viewport.getCurrentImageId();
  if (!imageId) {
    return false;
  }

  const image = cache.getImage(imageId);
  if (!image) {
    return false;
  }

  const pixelData = image.getPixelData();
  const rows = image.rows;
  const columns = image.columns;

  if (!pixelData || !rows || !columns) {
    return false;
  }

  // MONOCHROME1 is inverted: black = high pixel values.
  const isInverted = image.photometricInterpretation === 'MONOCHROME1' || image.invert;

  const minVal = image.minPixelValue ?? 0;
  const maxVal = image.maxPixelValue ?? 255;
  const range = maxVal - minVal;
  const threshold = isInverted ? maxVal - range * 0.05 : minVal + range * 0.05;

  const isBackground = (val: number) => (isInverted ? val >= threshold : val <= threshold);

  const SAMPLE_STEP = 4;
  const MIN_BORDER_FRACTION = 0.02;
  // Require at least this fraction of sampled pixels per row/col to clear
  // the threshold, so lone noisy pixels don't promote a black row to
  // "content" and bloat the bbox.
  const MIN_CONTENT_PIXEL_FRACTION = 0.05;

  // RGB DICOMs store interleaved [R,G,B] bytes; read max(R,G,B) per pixel.
  const stride = pixelData.length >= rows * columns * 3 ? 3 : 1;

  const pixelLuma = (r: number, c: number) => {
    const base = (r * columns + c) * stride;
    if (stride === 1) {
      return pixelData[base];
    }
    const v0 = pixelData[base];
    const v1 = pixelData[base + 1];
    const v2 = pixelData[base + 2];
    return v0 > v1 ? (v0 > v2 ? v0 : v2) : v1 > v2 ? v1 : v2;
  };

  const isContentRow = (r: number) => {
    let count = 0;
    let sampled = 0;
    for (let c = 0; c < columns; c += SAMPLE_STEP) {
      sampled++;
      if (!isBackground(pixelLuma(r, c))) {
        count++;
      }
    }
    return count >= sampled * MIN_CONTENT_PIXEL_FRACTION;
  };

  const isContentCol = (c: number, rTop: number, rBottom: number) => {
    let count = 0;
    let sampled = 0;
    for (let r = rTop; r <= rBottom; r += SAMPLE_STEP) {
      sampled++;
      if (!isBackground(pixelLuma(r, c))) {
        count++;
      }
    }
    return count >= sampled * MIN_CONTENT_PIXEL_FRACTION;
  };

  // Every "trim complete" exit must leave the camera re-based to a
  // deterministic reference frame (setDisplayArea + storeAsInitialCamera),
  // even when there are no borders to trim. The driver snapshots the
  // post-command camera as the untouched baseline and re-applies the user's
  // manual zoom/pan delta on top of it; an exit that keeps the camera as-is
  // lets a presentation-restored user zoom be read as that baseline, so the
  // delta compounds on every revisit. The reset also clears a stale
  // options.displayArea left by a previous image's trim.
  const applyDisplayArea = displayArea => {
    // setDisplayArea resets the camera to the unrotated, unflipped fit
    // before applying the content zoom, so capture any persisted
    // rotation/flip and re-apply afterwards.
    const { flipHorizontal, flipVertical } = viewport.getCamera();
    const rotation = viewport.getViewPresentation?.()?.rotation ?? 0;

    viewport.setDisplayArea(displayArea);

    if (rotation || flipHorizontal || flipVertical) {
      // Re-apply without letting the transforms displace the freshly
      // centered view: setDisplayArea(storeAsInitialCamera) re-bases
      // initialCamera, after which cs3d's setRotation pan math shifts the
      // camera and flip() mirrors the focal point off the content center.
      // Pin the trim's pan across the re-apply.
      const trimPan = viewport.getPan?.();
      // Single call: flips are applied before rotation, matching the flipped
      // frame the rotation value was measured in.
      viewport.setViewPresentation({ rotation, flipHorizontal, flipVertical });
      if (trimPan && viewport.setPan) {
        viewport.setPan(trimPan);
      }
    }

    viewport.render();
    return true;
  };

  const fullImageDisplayArea = {
    storeAsInitialCamera: true,
    imageArea: [1, 1] as [number, number],
    imageCanvasPoint: {
      imagePoint: [0.5, 0.5] as [number, number],
      canvasPoint: [0.5, 0.5] as [number, number],
    },
  };

  let top = 0;
  for (let r = 0; r < rows; r++) {
    if (isContentRow(r)) {
      top = r;
      break;
    }
    if (r === rows - 1) {
      // Whole image is background; nothing to trim — still re-base.
      return applyDisplayArea(fullImageDisplayArea);
    }
  }

  let bottom = rows - 1;
  for (let r = rows - 1; r >= top; r--) {
    if (isContentRow(r)) {
      bottom = r;
      break;
    }
  }

  let left = 0;
  for (let c = 0; c < columns; c++) {
    if (isContentCol(c, top, bottom)) {
      left = c;
      break;
    }
  }

  let right = columns - 1;
  for (let c = columns - 1; c >= left; c--) {
    if (isContentCol(c, top, bottom)) {
      right = c;
      break;
    }
  }

  const topBorder = top / rows;
  const bottomBorder = (rows - 1 - bottom) / rows;
  const leftBorder = left / columns;
  const rightBorder = (columns - 1 - right) / columns;

  if (
    topBorder < MIN_BORDER_FRACTION &&
    bottomBorder < MIN_BORDER_FRACTION &&
    leftBorder < MIN_BORDER_FRACTION &&
    rightBorder < MIN_BORDER_FRACTION
  ) {
    return applyDisplayArea(fullImageDisplayArea);
  }

  const padRows = Math.round(rows * 0.01);
  const padCols = Math.round(columns * 0.01);
  top = Math.max(0, top - padRows);
  bottom = Math.min(rows - 1, bottom + padRows);
  left = Math.max(0, left - padCols);
  right = Math.min(columns - 1, right + padCols);

  const contentWidth = (right - left + 1) / columns;
  const contentHeight = (bottom - top + 1) / rows;
  const centerX = (left + right) / 2 / columns;
  const centerY = (top + bottom) / 2 / rows;

  return applyDisplayArea({
    storeAsInitialCamera: true,
    imageArea: [contentWidth, contentHeight] as [number, number],
    imageCanvasPoint: {
      imagePoint: [centerX, centerY] as [number, number],
      canvasPoint: [0.5, 0.5] as [number, number],
    },
  });
}
