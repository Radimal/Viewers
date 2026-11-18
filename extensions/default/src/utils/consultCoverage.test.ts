import { getConsultCoverage } from './consultCoverage';
import { parseConsultCoverage } from './radimalCaseStatus';

describe('getConsultCoverage', () => {
  const series = (uid, SeriesInstanceUID = uid) => ({
    displaySetInstanceUID: uid,
    SeriesInstanceUID,
  });
  const displaySets = [series('a'), series('b'), series('c')];
  // Images the viewer holds per series (all instances, as Orthanc counts them).
  const held = { a: 2, b: 3, c: 1 };
  const imagesInSeries = uid => held[uid];
  const consult = (covered, images = []) => ({
    completedAt: 1000,
    coveredSeries: new Map(covered),
    coveredImages: new Map(images.map(([uid, sops]) => [uid, new Set(sops)])),
  });

  it('outlines only listed series the viewer has no more images of', () => {
    const coverage = getConsultCoverage(
      displaySets,
      consult([
        ['a', 2],
        ['b', 2], // b grew after the reply
      ]),
      imagesInSeries
    );
    expect([...coverage.covered]).toEqual(['a']);
    expect(coverage).toMatchObject({ completedAt: 1000, total: 3, after: 2 });
  });

  it('outlines every display set of a covered series', () => {
    const split = [series('a1', 'a'), series('a2', 'a'), series('c')];
    expect([...getConsultCoverage(split, consult([['a', 2]]), imagesInSeries).covered]).toEqual([
      'a1',
      'a2',
    ]);
  });

  it('judges an X-ray thumbnail by its own image when its series grew', () => {
    const xray = (uid, sop) => ({
      displaySetInstanceUID: uid,
      SeriesInstanceUID: 'x',
      instances: [{ SOPInstanceUID: sop }],
    });
    const thumbs = [xray('v1', 'sop-1'), xray('v2', 'sop-2'), xray('v3', 'sop-3')];
    // The series grew (not in coveredSeries); Reporter had sop-1 and sop-2 by the consult.
    const coverage = getConsultCoverage(thumbs, consult([], [['x', ['sop-1', 'sop-2']]]), () => 3);
    expect([...coverage.covered]).toEqual(['v1', 'v2']);
    expect(coverage).toMatchObject({ total: 3, after: 1 });
  });

  it('shows nothing when every series was covered, or there is no consult', () => {
    const all = consult([
      ['a', 2],
      ['b', 3],
      ['c', 1],
    ]);
    expect(getConsultCoverage(displaySets, all, imagesInSeries)).toBe(null);
    expect(getConsultCoverage(displaySets, null, imagesInSeries)).toBe(null);
  });
});

describe('parseConsultCoverage', () => {
  it("reads Reporter's consult_coverage", () => {
    expect(
      parseConsultCoverage({
        completed_at: '2026-11-02T10:00:00+00:00',
        covered_series: { x: 7, y: 'bad' },
      })
    ).toEqual({
      completedAt: Date.parse('2026-11-02T10:00:00Z'),
      coveredSeries: new Map([['x', 7]]),
      coveredImages: new Map(),
    });
    expect(
      parseConsultCoverage({
        completed_at: '2026-11-02T10:00:00Z',
        covered_series: {},
        covered_images: { x: ['a'], y: 'bad' },
      }).coveredImages
    ).toEqual(new Map([['x', new Set(['a'])]]));
  });

  it('reads completed_at without an offset as UTC and is null for odd replies', () => {
    const ok = { completed_at: '2026-11-02T10:00:00', covered_series: {} };
    expect(parseConsultCoverage(ok).completedAt).toBe(Date.parse('2026-11-02T10:00:00Z'));
    expect(parseConsultCoverage(null)).toBe(null);
    expect(parseConsultCoverage({ ...ok, completed_at: null })).toBe(null);
    expect(parseConsultCoverage({ ...ok, covered_series: null })).toBe(null);
  });
});
