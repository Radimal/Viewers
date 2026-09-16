import metadataProvider from './MetadataProvider';
import DicomMetadataStore from '../services/DicomMetadataStore';

// cs3d 3.x throws 'Invalid VOI LUT function' from BOTH the stack path
// (createImage indexes the value as an array: 'LINEAR' -> 'L') and the volume
// path (scalar) — the shapes are mutually exclusive, so the provider must not
// emit the field at all; both paths then default to LINEAR (3.10 parity).
describe('MetadataProvider voiLutModule VOILUTFunction', () => {
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

  it('never emits voiLUTFunction, whatever the tag holds', () => {
    for (const value of ['LINEAR', 'SIGMOID', 'LINEAR_EXACT', 'SIGMOID ', 'BOGUS', '', undefined]) {
      expect(voiFor(value).voiLUTFunction).toBeUndefined();
    }
  });

  it('still returns window values', () => {
    const voi = voiFor('LINEAR');
    expect(voi.windowCenter).toEqual([40]);
    expect(voi.windowWidth).toEqual([400]);
  });
});
