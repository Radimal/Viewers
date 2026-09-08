import getSopClassHandlerModule from './getSopClassHandlerModule';

const extensionManager = {
  getModuleEntry: () => ({
    exports: { getDynamicVolumeInfo: () => ({ isDynamicVolume: false, timePoints: [] }) },
  }),
};

const CT_IMAGE_STORAGE = '1.2.840.10008.5.1.4.1.1.2';
const instance = (n, extra = {}) => ({
  SOPClassUID: CT_IMAGE_STORAGE,
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
    const [stackHandler] = getSopClassHandlerModule({ extensionManager, appConfig: {} });
    const [ds] = stackHandler.getDisplaySetsFromSeries([instance(2), instance(1)]);
    expect(ds.numImageFrames).toBe(2);

    const multiframe = instance(9, { NumberOfFrames: 30 });
    expect(ds.addInstances([instance(3), multiframe])).toBe(ds);
    expect(ds.images.map(i => i.InstanceNumber)).toEqual([1, 2, 3]);
    expect(ds.instances).toBe(ds.images);
    expect(ds.numImageFrames).toBe(3);

    // Nothing stackable: caller must fall back to creating new display sets.
    expect(ds.addInstances([multiframe])).toBeUndefined();
    expect(ds.numImageFrames).toBe(3);
  });
});
