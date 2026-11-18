jest.mock('@ohif/core', () => ({
  utils: { orthancUtils: { reporterOriginFor: () => 'https://reporter.test' } },
}));

import { ensureCaseStatus, getLatestConsult, latestCompletedConsult } from './radimalCaseStatus';

const reply = covered => ({
  ok: true,
  json: () =>
    Promise.resolve({
      cases: [{ consultations: [{ s3_url: 'r.pdf', completed_at: '2026-11-02T10:00:00+00:00' }] }],
      consult_coverage: { completed_at: '2026-11-02T10:00:00+00:00', covered_series: covered },
    }),
});

describe('radimalCaseStatus', () => {
  it('looks the case up once and keeps a known status', async () => {
    global.fetch = jest.fn().mockResolvedValue(reply({ a: 3 }));
    expect(await ensureCaseStatus('1.2.3')).toBe(true);
    expect(await ensureCaseStatus('1.2.3')).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(getLatestConsult('1.2.3').coveredSeries).toEqual(new Map([['a', 3]]));
  });
});
