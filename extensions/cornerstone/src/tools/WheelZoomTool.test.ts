const mockViewport = {
  camera: null as any,
  getCamera() {
    return this.camera;
  },
  setCamera(update) {
    this.camera = { ...this.camera, ...update };
  },
  render: jest.fn(),
};

jest.mock('@cornerstonejs/tools', () => ({
  ZoomTool: class {
    configuration = { invert: false };
  },
}));
jest.mock('@cornerstonejs/core', () => ({
  getEnabledElement: () => ({ viewport: mockViewport }),
}));

import WheelZoomTool from './WheelZoomTool';

const wheel = (direction, world = [10, 0, 0]) => ({
  detail: { element: {}, wheel: { direction }, points: { world } },
});

beforeEach(() => {
  localStorage.clear();
  mockViewport.camera = { parallelScale: 100, focalPoint: [0, 0, 0], position: [0, 0, 50] };
});

it('zooms in 3.75% per notch around the centre by default (3.10 feel)', () => {
  new WheelZoomTool().mouseWheelCallback(wheel(-1));

  expect(mockViewport.camera.parallelScale).toBeCloseTo(100 / 1.0375);
  expect(mockViewport.camera.focalPoint).toEqual([0, 0, 0]);
});

it('scales the step with Zoom Speed; scrolling down zooms out', () => {
  localStorage.setItem('zoomSpeed', '0.4'); // 4x

  new WheelZoomTool().mouseWheelCallback(wheel(1));

  expect(mockViewport.camera.parallelScale).toBeCloseTo(100 / (1 - 0.15));
});

it('keeps the point under the cursor fixed when Zoom Toward Cursor is on', () => {
  localStorage.setItem('zoomTowardCursor', 'true');

  new WheelZoomTool().mouseWheelCallback(wheel(-1, [10, 0, 0]));

  // cursor at x=10 sat 10/100 of the half-height from centre; it must stay there
  const { parallelScale, focalPoint, position } = mockViewport.camera;
  expect((10 - focalPoint[0]) / parallelScale).toBeCloseTo(10 / 100);
  expect(position[0]).toBeCloseTo(focalPoint[0]);
});
