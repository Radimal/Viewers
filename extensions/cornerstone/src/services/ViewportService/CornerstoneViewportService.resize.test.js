import CornerstoneViewportService from './CornerstoneViewportService';

// resize() keeps each camera. Re-applying rotation turned MPR images on every resize,
// because a volume's getRotation() reads tilted crosshairs as a rotation.
describe('performResize', () => {
  it('re-applies pan/zoom/flip but not rotation', () => {
    const renderingEngine = { resize: jest.fn(), render: jest.fn() };
    const service = {
      renderingEngine,
      getRenderingEngine: () => ({ getViewports: () => [{ id: 'mpr' }] }),
      _getPositionPresentation: () => ({
        viewReference: { sliceIndex: 4 },
        viewPresentation: { zoom: 2, flipHorizontal: true, rotation: 30 },
      }),
      beforeResizePositionPresentations: new Map(),
      setPresentations: jest.fn(),
    };

    CornerstoneViewportService.prototype.performResize.call(service);

    expect(service.setPresentations).toHaveBeenCalledWith('mpr', {
      positionPresentation: {
        viewReference: {},
        viewPresentation: { zoom: 2, flipHorizontal: true },
      },
    });
  });
});
