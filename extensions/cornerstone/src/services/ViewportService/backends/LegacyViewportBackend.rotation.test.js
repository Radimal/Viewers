import { LegacyViewportBackend } from './LegacyViewportBackend';

// Resize, layout changes and series swaps re-apply this presentation. A volume's
// rotation is really its crosshair tilt, so re-applying it turned MPR images on resize.
describe('position presentation rotation', () => {
  const backend = new LegacyViewportBackend({});
  const viewportInfo = { getViewportType: () => 'x' };
  const presentationFor = type => {
    const vp = {
      type,
      getViewReference: () => ({}),
      getViewPresentation: jest.fn(() => ({})),
    };
    backend.getPositionPresentation(vp, viewportInfo, 'vp1');
    return vp.getViewPresentation.mock.calls[0][0];
  };

  it('keeps rotation and flips for stack images', () => {
    expect(presentationFor('stack')).toMatchObject({
      rotation: true,
      flipHorizontal: true,
      flipVertical: true,
    });
  });

  it('leaves rotation out for MPR, keeping flips', () => {
    expect(presentationFor('orthographic')).toMatchObject({
      rotation: false,
      flipHorizontal: true,
      flipVertical: true,
    });
  });
});
