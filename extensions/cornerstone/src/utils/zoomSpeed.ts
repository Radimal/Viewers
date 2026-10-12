/**
 * Radimal: user-configurable zoom step (fraction per zoom step),
 * fork-compatible localStorage key 'zoomSpeed'. Default 0.1 (10%).
 */
export const ZOOM_SPEED_OPTIONS = [0.05, 0.1, 0.2, 0.3, 0.4];

export function getZoomSpeed(): number {
  try {
    const saved = parseFloat(localStorage.getItem('zoomSpeed'));
    return ZOOM_SPEED_OPTIONS.includes(saved) ? saved : 0.1;
  } catch (e) {
    return 0.1;
  }
}

export function setZoomSpeed(speed: number): void {
  try {
    localStorage.setItem('zoomSpeed', String(speed));
  } catch (e) {
    /* storage unavailable */
  }
}

/**
 * Wheel zoom toward the cursor instead of the image centre (3.10 zoomed
 * around the centre). Read on every wheel event, so no reload is needed.
 */
export function getZoomTowardCursor(): boolean {
  try {
    return localStorage.getItem('zoomTowardCursor') === 'true';
  } catch (e) {
    return false;
  }
}

/** scaleBy factor for a zoom step in the given direction. */
export function getZoomScaleFactor(direction: number): number {
  const speed = getZoomSpeed();
  return direction > 0 ? 1 - speed : 1 + speed;
}
