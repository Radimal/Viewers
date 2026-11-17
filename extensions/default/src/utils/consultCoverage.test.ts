import { createHash, webcrypto } from 'crypto';
import { TextEncoder } from 'util';
import { getConsultCoverage, orthancInstanceId } from './consultCoverage';
import { latestCompletedConsult } from './radimalCaseStatus';

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
  const consult = late => ({
    completedAt: 1000,
    lateInstanceIds: new Set(late.map(([s, sop]) => orthancId(instance(s, sop)))),
  });

  it('a series with any image received after the consult is not covered', async () => {
    const coverage = await getConsultCoverage(
      displaySets,
      consult([
        ['b', '4'],
        ['c', '5'],
      ])
    );
    expect([...coverage.covered]).toEqual(['a']);
    expect(coverage).toMatchObject({ completedAt: 1000, total: 3, after: 2 });
  });

  it('shows nothing when nothing arrived after, or there is no consult', async () => {
    expect(await getConsultCoverage(displaySets, consult([]))).toBe(null);
    expect(await getConsultCoverage(displaySets, consult([['z', '9']]))).toBe(null);
    expect(await getConsultCoverage(displaySets, null)).toBe(null);
  });
});

describe('latestCompletedConsult', () => {
  it("takes the latest completed_at and every case's late images", () => {
    const consult = latestCompletedConsult([
      {
        consultations: [{ completed_at: '2026-10-30T16:12:00+00:00' }],
        images_after_consult: ['x'],
      },
      {
        consultations: [{ completed_at: null }, { completed_at: '2026-11-02T10:00:00Z' }],
        images_after_consult: ['y'],
      },
    ]);
    expect(consult.completedAt).toBe(Date.parse('2026-11-02T10:00:00Z'));
    expect([...consult.lateInstanceIds]).toEqual(['x', 'y']);
  });

  it('is null without a completed consult', () => {
    expect(latestCompletedConsult([{ consultations: [{ completed_at: null }] }])).toBe(null);
    expect(latestCompletedConsult(undefined)).toBe(null);
  });
});
