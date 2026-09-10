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

    await expect(getImageSrcFromImageId(cornerstone, false, 'image-id')).resolves.toBe(
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

describe('getImageSrcFromImageId with rendered thumbnails', () => {
  const FRAME_ID =
    'wadors:https://cdn.example.com/dicom-web/studies/1.2.3/series/4.5.6/instances/7.8.9/frames/1';

  const cornerstoneSpy = () => ({
    metaData: { get: jest.fn() },
    utilities: { loadImageToCanvas: jest.fn(() => Promise.resolve()) },
  });

  it('returns the /rendered URL without touching cornerstone', async () => {
    const cornerstone = cornerstoneSpy();

    await expect(getImageSrcFromImageId(cornerstone, true, FRAME_ID)).resolves.toBe(
      'https://cdn.example.com/dicom-web/studies/1.2.3/series/4.5.6/instances/7.8.9/rendered?viewport=256,256'
    );

    // The whole point of the change: no full frame is fetched or decoded for a thumbnail.
    expect(cornerstone.utilities.loadImageToCanvas).not.toHaveBeenCalled();
    expect(cornerstone.metaData.get).not.toHaveBeenCalled();
  });

  it('falls back to the canvas path when the imageId is not a WADO-RS frame', async () => {
    const canvas = { toDataURL: jest.fn(() => 'data:image/png;base64,thumbnail') };
    const createElement = jest.spyOn(document, 'createElement').mockReturnValue(canvas);
    const cornerstone = cornerstoneSpy();

    await expect(
      getImageSrcFromImageId(cornerstone, true, 'dicomweb:https://cdn.example.com/wado?objectUID=7')
    ).resolves.toBe('data:image/png;base64,thumbnail');

    expect(cornerstone.utilities.loadImageToCanvas).toHaveBeenCalled();
    createElement.mockRestore();
  });

  it('keeps the canvas path when the flag is off, even for a frame imageId', async () => {
    const canvas = { toDataURL: jest.fn(() => 'data:image/png;base64,thumbnail') };
    const createElement = jest.spyOn(document, 'createElement').mockReturnValue(canvas);
    const cornerstone = cornerstoneSpy();

    await expect(getImageSrcFromImageId(cornerstone, false, FRAME_ID)).resolves.toBe(
      'data:image/png;base64,thumbnail'
    );

    expect(cornerstone.utilities.loadImageToCanvas).toHaveBeenCalled();
    createElement.mockRestore();
  });
});
