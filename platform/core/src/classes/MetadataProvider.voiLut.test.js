import metadataProvider from './MetadataProvider';
import DicomMetadataStore from '../services/DicomMetadataStore';

// cs3d 3.x throws 'Invalid VOI LUT function' for values outside its enum;
// the provider must hand cornerstone only LINEAR / LINEAR_EXACT / SIGMOID
// or undefined (which falls back to LINEAR).
describe('MetadataProvider voiLutModule VOILUTFunction normalization', () => {
  // DicomMetadataStore dedupes by SOPInstanceUID, so each case gets its own.
  let sop = 0;

  const voiFor = VOILUTFunction => {
    sop += 1;
    const uids = {
      StudyInstanceUID: '1',
      SeriesInstanceUID: '2',
      SOPInstanceUID: `3.${sop}`,
    };
    const imageId = `wadors:https://x/studies/1/series/2/instances/3.${sop}/frames/1`;
    DicomMetadataStore.addInstances(
      [
        {
          ...uids,
          WindowCenter: 40,
          WindowWidth: 400,
          ...(VOILUTFunction !== undefined && { VOILUTFunction }),
        },
      ],
      true
    );
    metadataProvider.addImageIdToUIDs(imageId, uids);
    return metadataProvider.get('voiLutModule', imageId);
  };

  it('passes valid values through', () => {
    expect(voiFor('SIGMOID').voiLUTFunction).toBe('SIGMOID');
    expect(voiFor('LINEAR_EXACT').voiLUTFunction).toBe('LINEAR_EXACT');
  });

  it('normalizes padded/lowercase values', () => {
    expect(voiFor('SIGMOID ').voiLUTFunction).toBe('SIGMOID');
    expect(voiFor('linear').voiLUTFunction).toBe('LINEAR');
  });

  it('drops unknown values instead of crashing the render', () => {
    expect(voiFor('SIGMOID_1').voiLUTFunction).toBeUndefined();
    expect(voiFor('').voiLUTFunction).toBeUndefined();
    expect(voiFor(undefined).voiLUTFunction).toBeUndefined();
  });

  it('still returns window values alongside a dropped function', () => {
    const voi = voiFor('BOGUS');
    expect(voi.windowCenter).toEqual([40]);
    expect(voi.windowWidth).toEqual([400]);
  });
});
