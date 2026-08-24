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

/** scaleBy factor for a zoom step in the given direction. */
export function getZoomScaleFactor(direction: number): number {
  const speed = getZoomSpeed();
  return direction > 0 ? 1 - speed : 1 + speed;
}
