import metadataProvider from './MetadataProvider';
import DicomMetadataStore from '../services/DicomMetadataStore';

// Progeny IO sensors write ImagerPixelSpacing as "1.#INF\1.#INF"; NaN spacing
// left the viewport blank instead of falling back to 1mm.
describe('MetadataProvider imagePlaneModule pixel spacing', () => {
  let sop = 0;

  const planeFor = ImagerPixelSpacing => {
    sop += 1;
    const uids = { StudyInstanceUID: '1', SeriesInstanceUID: '2', SOPInstanceUID: `4.${sop}` };
    const imageId = `wadors:https://x/studies/1/series/2/instances/4.${sop}/frames/1`;
    DicomMetadataStore.addInstances(
      [{ ...uids, SOPClassUID: '1.2.840.10008.5.1.4.1.1.1.3', Rows: 918, Columns: 1287, ImagerPixelSpacing }],
      true
    );
    metadataProvider.addImageIdToUIDs(imageId, uids);
    return metadataProvider.get('imagePlaneModule', imageId);
  };

  it('falls back to 1 for non-finite spacing', () => {
    for (const value of [['1.#INF', '1.#INF'], [NaN, NaN], [0, 0], [null, null]]) {
      const plane = planeFor(value);
      expect([plane.rowPixelSpacing, plane.columnPixelSpacing]).toEqual([1, 1]);
      expect(plane.usingDefaultValues).toBe(true);
    }
  });

  it('keeps valid spacing', () => {
    const plane = planeFor([0.02, 0.02]);
    expect([plane.rowPixelSpacing, plane.columnPixelSpacing]).toEqual([0.02, 0.02]);
  });
});
