import { fixBulkDataURI } from './fixBulkDataURI';

const WADO_ROOT = 'https://d2l1pua5zb4iwp.cloudfront.net/dicom-web';
const config = (bulkDataURI = {}) => ({ wadoRoot: WADO_ROOT, bulkDataURI });
const instance = { StudyInstanceUID: 'S1', SeriesInstanceUID: 'SE1' };

describe('fixBulkDataURI absolute-URI re-rooting', () => {
  // The prod failure: Orthanc behind the proxy chain emitted its bulkdata
  // URIs with the wrong scheme AND host; the https page blocked the http
  // fetch as mixed content and palette-color images never rendered.
  it('re-roots a proxy-mangled http origin onto the wadoRoot', () => {
    const value = {
      BulkDataURI: 'http://viewer.prod-1.radimal.ai/dicom-web/studies/S1/series/SE1/instances/I1/bulk/00281201',
    };
    fixBulkDataURI(value, instance, config());
    expect(value.BulkDataURI).toBe(
      `${WADO_ROOT}/studies/S1/series/SE1/instances/I1/bulk/00281201`
    );
  });

  it('keeps an absolute URI already on the wadoRoot origin', () => {
    const original = `${WADO_ROOT}/studies/S1/series/SE1/instances/I1/bulk/00281201`;
    const value = { BulkDataURI: original };
    fixBulkDataURI(value, instance, config());
    expect(value.BulkDataURI).toBe(original);
  });

  it('leaves foreign absolute URIs with a different path root alone', () => {
    const original = 'https://other.example.com/other-api/bulk/1';
    const value = { BulkDataURI: original };
    fixBulkDataURI(value, instance, config());
    expect(value.BulkDataURI).toBe(original);
  });

  it('still resolves series-relative URIs', () => {
    const value = { BulkDataURI: 'instances/I1/bulk/00281201' };
    fixBulkDataURI(value, instance, config());
    expect(value.BulkDataURI).toBe(
      `${WADO_ROOT}/studies/S1/series/SE1/instances/I1/bulk/00281201`
    );
  });
});
