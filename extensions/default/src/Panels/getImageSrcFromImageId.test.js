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

describe('getImageSrcFromImageId with rendered thumbnails', () => {
  const FRAME_ID =
    'wadors:https://cdn.example.com/dicom-web/studies/1.2.3/series/4.5.6/instances/7.8.9/frames/1';
  const RENDERED_URL =
    'https://cdn.example.com/dicom-web/studies/1.2.3/series/4.5.6/instances/7.8.9/frames/1/rendered?viewport=256,256';
  const RENDERED_DATA_URL = 'data:image/jpeg;base64,cmVuZGVyZWQ=';

  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    // jsdom ships no FileReader that can read a stub blob, so resolve the data URL directly.
    global.FileReader = function MockFileReader() {
      this.readAsDataURL = () => {
        this.result = RENDERED_DATA_URL;
        this.onload();
      };
    };
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const cornerstoneSpy = () => ({
    metaData: { get: jest.fn() },
    utilities: { loadImageToCanvas: jest.fn(() => Promise.resolve()) },
  });

  it('reads the /rendered URL once and never touches cornerstone', async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, blob: () => Promise.resolve({}) }));
    const cornerstone = cornerstoneSpy();

    await expect(getImageSrcFromImageId(cornerstone, FRAME_ID)).resolves.toBe(
      RENDERED_DATA_URL
    );

    // One request, not two: /dicom-web/* is Cache-Control: no-store, so a separate probe would
    // double Orthanc's render load rather than being served from cache.
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(RENDERED_URL);

    // The whole point of the change: no full frame is fetched or decoded for a thumbnail.
    expect(cornerstone.utilities.loadImageToCanvas).not.toHaveBeenCalled();
    expect(cornerstone.metaData.get).not.toHaveBeenCalled();
  });

  it('falls back to the canvas path on a non-ok rendered response', async () => {
    // A 404 or 415 from the origin must not strand the tile.
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: false, status: 404, blob: () => Promise.resolve({}) })
    );
    const canvas = { toDataURL: jest.fn(() => 'data:image/png;base64,thumbnail') };
    const createElement = jest.spyOn(document, 'createElement').mockReturnValue(canvas);
    const cornerstone = cornerstoneSpy();

    await expect(getImageSrcFromImageId(cornerstone, FRAME_ID)).resolves.toBe(
      'data:image/png;base64,thumbnail'
    );
    expect(cornerstone.utilities.loadImageToCanvas).toHaveBeenCalled();

    createElement.mockRestore();
  });

  it('falls back to the canvas path when the request itself fails', async () => {
    // A CORS or COEP block rejects rather than returning a response.
    global.fetch = jest.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    const canvas = { toDataURL: jest.fn(() => 'data:image/png;base64,thumbnail') };
    const createElement = jest.spyOn(document, 'createElement').mockReturnValue(canvas);
    const cornerstone = cornerstoneSpy();

    await expect(getImageSrcFromImageId(cornerstone, FRAME_ID)).resolves.toBe(
      'data:image/png;base64,thumbnail'
    );

    createElement.mockRestore();
  });

  it('rejects when the rendered request and the canvas fallback both fail', async () => {
    // Rejection has to survive the fallback, or the caller's thumbnail_load_failed never fires.
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: false, status: 500, blob: () => Promise.resolve({}) })
    );
    const canvas = { toDataURL: jest.fn() };
    const createElement = jest.spyOn(document, 'createElement').mockReturnValue(canvas);
    const cornerstone = {
      metaData: { get: jest.fn() },
      utilities: { loadImageToCanvas: jest.fn(() => Promise.reject(new Error('decode failed'))) },
    };

    await expect(getImageSrcFromImageId(cornerstone, FRAME_ID)).rejects.toThrow(
      'decode failed'
    );

    createElement.mockRestore();
  });

  it('falls back to the canvas path when the imageId is not a WADO-RS frame', async () => {
    global.fetch = jest.fn();
    const canvas = { toDataURL: jest.fn(() => 'data:image/png;base64,thumbnail') };
    const createElement = jest.spyOn(document, 'createElement').mockReturnValue(canvas);
    const cornerstone = cornerstoneSpy();

    await expect(
      getImageSrcFromImageId(cornerstone, 'dicomweb:https://cdn.example.com/wado?objectUID=7')
    ).resolves.toBe('data:image/png;base64,thumbnail');

    expect(global.fetch).not.toHaveBeenCalled();
    expect(cornerstone.utilities.loadImageToCanvas).toHaveBeenCalled();
    createElement.mockRestore();
  });

  it('takes the rendered path for every frame imageId, with no opt-in', async () => {
    // Ungated on purpose: the only config key available is written by the deployment rather than
    // by this repo, so a gate would have put the fix behind an infrastructure change.
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, blob: () => Promise.resolve({}) }));
    const cornerstone = cornerstoneSpy();

    await expect(getImageSrcFromImageId(cornerstone, FRAME_ID)).resolves.toBe(RENDERED_DATA_URL);

    expect(global.fetch).toHaveBeenCalledWith(RENDERED_URL);
    expect(cornerstone.utilities.loadImageToCanvas).not.toHaveBeenCalled();
  });
});
