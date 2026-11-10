import DisplaySetService from '@ohif/core/src/services/DisplaySetService/DisplaySetService';
import getSopClassHandlerModule from './getSopClassHandlerModule';

// 3.13 harness: addStackInstances re-sorts via customizationService and
// re-derives imageIds through the active data source.
const extensionManager = {
  getModuleEntry: () => ({
    exports: { getDynamicVolumeInfo: () => ({ isDynamicVolume: false, timePoints: [] }) },
  }),
  getActiveDataSource: () => [
    {
      getImageIdsForDisplaySet: ds => ds.images.map(i => i.imageId),
      retrieve: {},
    },
  ],
};

const servicesManager = {
  services: {
    customizationService: {
      getCustomization: () => ({ sortFunctions: {}, defaultSortFunctionName: undefined }),
    },
  },
};

const CT_IMAGE_STORAGE = '1.2.840.10008.5.1.4.1.1.2';
const instance = (n, extra = {}) => ({
  SOPClassUID: CT_IMAGE_STORAGE,
  ImagePositionPatient: [0, 0, n],
  SOPInstanceUID: `sop${n}`,
  InstanceNumber: n,
  Modality: 'CT',
  Rows: 512,
  Columns: 512,
  SeriesInstanceUID: 'series1',
  StudyInstanceUID: 'study1',
  imageId: `wadors:${n}`,
  ...extra,
});

describe('stack display set addInstances (live acquisition)', () => {
  it('grows the existing display set with new stackable images and rejects the rest', () => {
    const { getSopClassHandlerModule: getModule } = getSopClassHandlerModule;
    const sopModule = (getModule ?? getSopClassHandlerModule)({
      extensionManager,
      servicesManager,
      appConfig: {},
    });
    const [stackHandler] = sopModule;
    const [ds] = stackHandler.getDisplaySetsFromSeries([instance(2), instance(1)]);
    expect(ds.numImageFrames).toBe(2);

    const multiframe = instance(9, { NumberOfFrames: 30 });
    expect(ds.addInstances([instance(3), multiframe])).toBe(ds);
    expect(ds.images.map(i => i.InstanceNumber)).toEqual([1, 2, 3]);
    expect(ds.numImageFrames).toBe(3);

    // Nothing stackable: caller must fall back to creating new display sets.
    expect(ds.addInstances([multiframe])).toBeUndefined();
    expect(ds.numImageFrames).toBe(3);
  });
});

describe('lossy copies of images in the same series', () => {
  const { getSopClassHandlerModule: getModule } = getSopClassHandlerModule;
  const [stackHandler] = (getModule ?? getSopClassHandlerModule)({
    extensionManager,
    servicesManager,
    appConfig: {},
  });
  const lossyCopyOf = n =>
    instance(n, {
      SOPInstanceUID: `lossy${n}`,
      LossyImageCompression: '01',
      SourceImageSequence: [{ ReferencedSOPInstanceUID: `sop${n}` }],
    });

  it('drops a lossy copy when its original is in the series', () => {
    const [ds] = stackHandler.getDisplaySetsFromSeries([
      instance(1),
      lossyCopyOf(1),
      instance(2),
      lossyCopyOf(2),
    ]);
    expect(ds.images.map(i => i.SOPInstanceUID)).toEqual(['sop1', 'sop2']);
  });

  it('drops a lossy copy of a radiograph, which has no image position', () => {
    const dx = { Modality: 'DX', ImagePositionPatient: undefined };
    const displaySets = stackHandler.getDisplaySetsFromSeries([
      instance(1, dx),
      { ...lossyCopyOf(1), ...dx },
      { ...lossyCopyOf(2), ...dx }, // original never arrived: kept
    ]);
    expect(displaySets.map(ds => ds.images[0].SOPInstanceUID)).toEqual(['sop1', 'lossy2']);
  });

  // Anything that is not provably the same picture must stay visible.
  it.each([
    ['a different size', { Rows: 256 }],
    ['a different acquisition time', { AcquisitionTime: '120001' }],
    ['a different window', { WindowCenter: 40 }],
    ['a different pixel spacing', { PixelSpacing: [0.5, 0.5] }],
    ['a position its source lacks', { ImagePositionPatient: [0, 0, 1] }],
    ['no source reference', { SourceImageSequence: undefined }],
    ['a source outside the series', { SourceImageSequence: [{ ReferencedSOPInstanceUID: 'x' }] }],
    [
      'more than one source',
      {
        SourceImageSequence: [
          { ReferencedSOPInstanceUID: 'sop1' },
          { ReferencedSOPInstanceUID: 'sop2' },
        ],
      },
    ],
    ['no lossy flag', { LossyImageCompression: '00' }],
  ])('keeps a radiograph derived image with %s', (_name, change) => {
    const dx = { Modality: 'DX', ImagePositionPatient: undefined };
    const displaySets = stackHandler.getDisplaySetsFromSeries([
      instance(1, dx),
      instance(2, dx),
      { ...lossyCopyOf(1), ...dx, ...change },
    ]);
    expect(displaySets).toHaveLength(3);
  });

  it('keeps lossy derived images at a different position than their source', () => {
    const derived = instance(3, {
      SOPInstanceUID: 'derived3',
      LossyImageCompression: '01',
      SourceImageSequence: [{ ReferencedSOPInstanceUID: 'sop1' }],
    });
    const [ds] = stackHandler.getDisplaySetsFromSeries([instance(1), instance(2), derived]);
    expect(ds.images.map(i => i.SOPInstanceUID)).toEqual(['sop1', 'sop2', 'derived3']);
  });

  it('keeps a lossy derived image at the same position with a different instance number', () => {
    const derived = { ...lossyCopyOf(1), SOPInstanceUID: 'kernel1', InstanceNumber: 101 };
    const [ds] = stackHandler.getDisplaySetsFromSeries([instance(1), derived]);
    expect(ds.numImageFrames).toBe(2);
  });

  it('never drops both images when two lossy images point at each other', () => {
    const a = {
      ...lossyCopyOf(1),
      SOPInstanceUID: 'a',
      SourceImageSequence: [{ ReferencedSOPInstanceUID: 'b' }],
    };
    const b = {
      ...lossyCopyOf(1),
      SOPInstanceUID: 'b',
      SourceImageSequence: [{ ReferencedSOPInstanceUID: 'a' }],
    };
    const [ds] = stackHandler.getDisplaySetsFromSeries([a, b]);
    expect(ds.numImageFrames).toBe(2);
  });

  it('keeps lossy images without their original, and drops them once it arrives', () => {
    const [ds] = stackHandler.getDisplaySetsFromSeries([lossyCopyOf(1), lossyCopyOf(2)]);
    expect(ds.numImageFrames).toBe(2);

    ds.addInstances([instance(1)]);
    expect(ds.images.map(i => i.SOPInstanceUID)).toEqual(['sop1', 'lossy2']);
    expect(ds.numImageFrames).toBe(2);
  });
});

describe('live updates of a series with lossy copies', () => {
  it('re-sending the whole series adds no lossy-only display set', () => {
    const { getSopClassHandlerModule: getModule } = getSopClassHandlerModule;
    const [stackHandler] = (getModule ?? getSopClassHandlerModule)({
      extensionManager,
      servicesManager,
      appConfig: {},
    });
    const service = new DisplaySetService();
    service.init({ getModuleEntry: () => stackHandler }, [
      '@ohif/extension-default.sopClassHandlerModule.stack',
    ]);
    const inSeries = (n, extra = {}) => instance(n, { SeriesInstanceUID: 'live-series', ...extra });
    const lossyCopy = n =>
      inSeries(n, {
        SOPInstanceUID: `lossy${n}`,
        LossyImageCompression: '01',
        SourceImageSequence: [{ ReferencedSOPInstanceUID: `sop${n}` }],
      });

    const series = [inSeries(1), lossyCopy(1), inSeries(2), lossyCopy(2)];
    service.makeDisplaySets(series);
    // DicomMetadataStore re-sends the full series on every poll tick.
    service.makeDisplaySets([...series, inSeries(3), lossyCopy(3)]);

    const displaySets = service.getActiveDisplaySets();
    expect(displaySets).toHaveLength(1);
    expect(displaySets[0].images.map(i => i.SOPInstanceUID)).toEqual(['sop1', 'sop2', 'sop3']);
  });
});
