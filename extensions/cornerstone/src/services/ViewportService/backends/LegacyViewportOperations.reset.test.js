import { legacyViewportOperations } from './LegacyViewportOperations';

// Reset must recreate the LUT for inverted (MONOCHROME1) images: cs3d's
// resetProperties restores pre-invert transfer function nodes while the
// invert flag stays true, so without the recreate the image flips visually.
describe('legacy reset MONOCHROME1 LUT repair', () => {
  const makeViewport = invert => ({
    resetProperties: jest.fn(),
    resetCamera: jest.fn(),
    getProperties: jest.fn(() => ({ invert, voiRange: { lower: 10, upper: 90 } })),
    setVOI: jest.fn(),
  });

  it('recreates the LUT when the reset state is inverted', () => {
    const vp = makeViewport(true);
    legacyViewportOperations.reset(vp);
    expect(vp.resetProperties).toHaveBeenCalled();
    expect(vp.setVOI).toHaveBeenCalledWith(
      { lower: 10, upper: 90 },
      { forceRecreateLUTFunction: true }
    );
    expect(vp.resetCamera).toHaveBeenCalled();
  });

  it('leaves non-inverted images alone', () => {
    const vp = makeViewport(false);
    legacyViewportOperations.reset(vp);
    expect(vp.setVOI).not.toHaveBeenCalled();
    expect(vp.resetCamera).toHaveBeenCalled();
  });
});
