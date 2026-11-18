import { createHash, webcrypto } from 'crypto';
import { TextEncoder } from 'util';
import { getConsultCoverage, orthancInstanceId } from './consultCoverage';
import { parseConsultCoverage } from './radimalCaseStatus';

// jsdom has no Web Crypto or TextEncoder; browsers do (https and localhost).
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
Object.assign(globalThis, { TextEncoder });

const instance = (series, sop) => ({
  PatientID: 'P1',
  StudyInstanceUID: '1.2.3',
  SeriesInstanceUID: series,
  SOPInstanceUID: sop,
});
const orthancId = ({ PatientID, StudyInstanceUID, SeriesInstanceUID, SOPInstanceUID }) =>
  createHash('sha1')
    .update(`${PatientID}|${StudyInstanceUID}|${SeriesInstanceUID}|${SOPInstanceUID}`)
    .digest('hex')
    .match(/.{8}/g)
    .join('-');

describe('orthancInstanceId', () => {
  it("is Orthanc's SHA-1 of the four UIDs in dashed groups of 8", async () => {
    const id = await orthancInstanceId(instance('1.2.3.4', '1.2.3.4.5'));
    expect(id).toMatch(/^([0-9a-f]{8}-){4}[0-9a-f]{8}$/);
    expect(id).toBe(orthancId(instance('1.2.3.4', '1.2.3.4.5')));
  });
});

describe('getConsultCoverage', () => {
  const series = (uid, ...sops) => ({
    displaySetInstanceUID: uid,
    instances: sops.map(sop => instance(uid, sop)),
  });
  const displaySets = [series('a', '1', '2'), series('b', '3', '4'), series('c', '5')];
  const consult = covered => ({
    completedAt: 1000,
    coveredInstanceIds: new Set(covered.map(([s, sop]) => orthancId(instance(s, sop)))),
  });

  it('covers a series only when Reporter had every image by the consult', async () => {
    // b/4 came later; c/5 is unknown to Reporter (arrived while open, or not recorded yet).
    const coverage = await getConsultCoverage(
      displaySets,
      consult([
        ['a', '1'],
        ['a', '2'],
        ['b', '3'],
      ])
    );
    expect([...coverage.covered]).toEqual(['a']);
    expect(coverage).toMatchObject({ completedAt: 1000, total: 3, after: 2 });
  });

  it('shows nothing when every series was covered, or there is no consult', async () => {
    const all = consult([
      ['a', '1'],
      ['a', '2'],
      ['b', '3'],
      ['b', '4'],
      ['c', '5'],
    ]);
    expect(await getConsultCoverage(displaySets, all)).toBe(null);
    expect(await getConsultCoverage(displaySets, null)).toBe(null);
  });
});

describe('parseConsultCoverage', () => {
  it("reads Reporter's consult_coverage", () => {
    expect(
      parseConsultCoverage({
        completed_at: '2026-11-02T10:00:00+00:00',
        covered_image_ids: ['x', 'y'],
      })
    ).toEqual({
      completedAt: Date.parse('2026-11-02T10:00:00Z'),
      coveredInstanceIds: new Set(['x', 'y']),
    });
  });

  it('reads completed_at without an offset as UTC and is null for odd replies', () => {
    expect(
      parseConsultCoverage({ completed_at: '2026-11-02T10:00:00', covered_image_ids: [] })
        .completedAt
    ).toBe(Date.parse('2026-11-02T10:00:00Z'));
    expect(parseConsultCoverage(null)).toBe(null);
    expect(parseConsultCoverage({ completed_at: null, covered_image_ids: [] })).toBe(null);
    expect(
      parseConsultCoverage({ completed_at: '2026-11-02T10:00:00Z', covered_image_ids: 'x' })
    ).toBe(null);
  });
});
