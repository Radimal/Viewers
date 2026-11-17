jest.mock('@ohif/core', () => ({
  utils: { orthancUtils: { reporterOriginFor: () => 'https://reporter.test' } },
}));

import {
  ensureCaseStatus,
  getLatestConsult,
  latestCompletedConsult,
  refreshCaseStatus,
} from './radimalCaseStatus';

const reply = late => ({
  ok: true,
  json: () =>
    Promise.resolve({
      cases: [
        {
          consultations: [{ s3_url: 'r.pdf', completed_at: '2026-11-02T10:00:00+00:00' }],
          images_after_consult: late,
        },
      ],
    }),
});

describe('radimalCaseStatus', () => {
  it('refresh re-reads the late-image list that ensure caches', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(reply(['a']))
      .mockResolvedValueOnce(reply(['a', 'b']));

    expect(await ensureCaseStatus('1.2.3')).toBe(true);
    await ensureCaseStatus('1.2.3');
    expect(global.fetch).toHaveBeenCalledTimes(1);

    await refreshCaseStatus('1.2.3');
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect([...getLatestConsult('1.2.3').lateInstanceIds]).toEqual(['a', 'b']);
  });

  it('reads completed_at without an offset as UTC and tolerates odd replies', () => {
    expect(
      latestCompletedConsult([{ consultations: [{ completed_at: '2026-11-02T10:00:00' }] }])
        .completedAt
    ).toBe(Date.parse('2026-11-02T10:00:00Z'));
    expect(
      latestCompletedConsult([
        {
          consultations: [null, { completed_at: '2026-11-02T10:00:00Z' }],
          images_after_consult: 'x',
        },
        null,
      ])
    ).toEqual({ completedAt: Date.parse('2026-11-02T10:00:00Z'), lateInstanceIds: new Set() });
    expect(latestCompletedConsult({ not: 'an array' })).toBe(null);
  });
});
