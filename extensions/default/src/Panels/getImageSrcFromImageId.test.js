import getImageSrcFromImageId from './getImageSrcFromImageId';

describe('getImageSrcFromImageId', () => {
  let createElement;
  let canvas;

  beforeEach(() => {
    canvas = { toDataURL: jest.fn(() => 'data:image/png;base64,thumbnail') };
    createElement = jest.spyOn(document, 'createElement').mockReturnValue(canvas);
  });

  afterEach(() => {
    createElement.mockRestore();
  });

  it.each([
    [true, 'MONOCHROME1'],
    [false, 'MONOCHROME2'],
    [false, undefined],
  ])('uses CPU rendering=%s for %s images', async (expected, photometricInterpretation) => {
    const loadImageToCanvas = jest.fn(() => Promise.resolve());
    const cornerstone = {
      metaData: {
        get: jest.fn(() =>
          photometricInterpretation ? { photometricInterpretation } : undefined
        ),
      },
      utilities: { loadImageToCanvas },
    };

    await expect(getImageSrcFromImageId(cornerstone, 'image-id')).resolves.toBe(
      'data:image/png;base64,thumbnail'
    );

    expect(cornerstone.metaData.get).toHaveBeenCalledWith('imagePixelModule', 'image-id');
    expect(loadImageToCanvas).toHaveBeenCalledWith({
      canvas,
      imageId: 'image-id',
      thumbnail: true,
      useCPURendering: expected,
    });
  });
});
