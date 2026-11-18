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
  const consult = (late, imageCount = 5) => ({
    completedAt: 1000,
    imageCount,
    lateInstanceIds: new Set(late.map(([s, sop]) => orthancId(instance(s, sop)))),
  });

  it('a series with any image received after the consult is not covered', async () => {
    const coverage = await getConsultCoverage(
      displaySets,
      consult([
        ['b', '4'],
        ['c', '5'],
      ]),
      5
    );
    expect([...coverage.covered]).toEqual(['a']);
    expect(coverage).toMatchObject({ completedAt: 1000, total: 3, after: 2 });
  });

  it("shows nothing when the viewer's image count differs from Reporter's", async () => {
    // A 6th image Reporter hasn't recorded (still arriving, or reduced out of the consult).
    expect(await getConsultCoverage(displaySets, consult([['c', '5']]), 6)).toBe(null);
  });

  it('shows nothing when nothing arrived after, or there is no consult', async () => {
    expect(await getConsultCoverage(displaySets, consult([]), 5)).toBe(null);
    expect(await getConsultCoverage(displaySets, consult([['z', '9']]), 5)).toBe(null);
    expect(await getConsultCoverage(displaySets, null, 5)).toBe(null);
  });
});

describe('parseConsultCoverage', () => {
  it("reads Reporter's consult_coverage", () => {
    expect(
      parseConsultCoverage({
        completed_at: '2026-11-02T10:00:00+00:00',
        image_count: 7,
        late_image_ids: ['x'],
      })
    ).toEqual({
      completedAt: Date.parse('2026-11-02T10:00:00Z'),
      imageCount: 7,
      lateInstanceIds: new Set(['x']),
    });
  });

  it('reads completed_at without an offset as UTC and is null for odd replies', () => {
    const ok = { completed_at: '2026-11-02T10:00:00', image_count: 1, late_image_ids: [] };
    expect(parseConsultCoverage(ok).completedAt).toBe(Date.parse('2026-11-02T10:00:00Z'));
    expect(parseConsultCoverage(null)).toBe(null);
    expect(parseConsultCoverage({ ...ok, completed_at: null })).toBe(null);
    expect(parseConsultCoverage({ ...ok, image_count: '1' })).toBe(null);
    expect(parseConsultCoverage({ ...ok, late_image_ids: 'x' })).toBe(null);
  });
});
