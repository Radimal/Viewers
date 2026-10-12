import { ZoomTool } from '@cornerstonejs/tools';
import { getEnabledElement } from '@cornerstonejs/core';
import { getZoomSpeed, getZoomTowardCursor } from '../utils/zoomSpeed';

/**
 * Radimal: cs3d's Zoom tool with 3.10's wheel feel. Each wheel notch scales
 * by 3.75% × the Zoom Speed preference (0.5x–4x), around the image centre
 * unless "Zoom toward cursor" is on. Drag and pinch zoom are unchanged.
 * Registered under the stock 'Zoom' name so bindings, toolbar and hotkeys
 * need no changes.
 */
class WheelZoomTool extends ZoomTool {
  mouseWheelCallback(evt) {
    const { element, wheel, points } = evt.detail;
    const viewport = getEnabledElement(element)?.viewport as any;
    const camera = viewport?.getCamera?.();
    if (!camera?.parallelScale) {
      // e.g. next-generation viewports: cs3d's own wheel zoom
      return super.mouseWheelCallback(evt);
    }

    // 3.10: 0.0375 × (zoomSpeed / 0.1); scrolling down zooms out.
    const step = 0.375 * getZoomSpeed() * (this.configuration.invert ? -1 : 1);
    const ratio = wheel.direction > 0 ? 1 - step : 1 + step;
    const updated: Record<string, unknown> = { parallelScale: camera.parallelScale / ratio };

    if (getZoomTowardCursor() && points?.world) {
      // Keep the world point under the cursor fixed on screen.
      const shift = camera.focalPoint.map((f, i) => (points.world[i] - f) * (1 - 1 / ratio));
      updated.focalPoint = camera.focalPoint.map((f, i) => f + shift[i]);
      updated.position = camera.position.map((p, i) => p + shift[i]);
    }

    viewport.setCamera(updated);
    viewport.render();
  }
}

export default WheelZoomTool;
