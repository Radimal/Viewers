import { dicomDateTimeToUtc, getConsultCoverage, instanceAcquiredAt } from './consultCoverage';
import { latestCompletedConsult } from './radimalCaseStatus';

const NY = 'America/New_York';

describe('dicomDateTimeToUtc', () => {
  it('reads scanner wall-clock time in the clinic timezone, across DST', () => {
    // 11:49:55 in New York: EDT (UTC-4) in October, EST (UTC-5) in December.
    expect(new Date(dicomDateTimeToUtc('20261030', '114955.585749', NY)).toISOString()).toBe(
      '2026-10-30T15:49:55.000Z'
    );
    expect(new Date(dicomDateTimeToUtc('20261215', '1149', NY)).toISOString()).toBe(
      '2026-12-15T16:49:00.000Z'
    );
    expect(
      new Date(dicomDateTimeToUtc('20261030', '114955', 'America/Los_Angeles')).toISOString()
    ).toBe('2026-10-30T18:49:55.000Z');
  });

  it("prefers the image's own UTC offset", () => {
    expect(new Date(dicomDateTimeToUtc('20261030', '114955', NY, '-0700')).toISOString()).toBe(
      '2026-10-30T18:49:55.000Z'
    );
  });

  it('returns null without a date or time, and survives an unknown zone', () => {
    expect(dicomDateTimeToUtc('', '114955', NY)).toBe(null);
    expect(dicomDateTimeToUtc('20261030', undefined, NY)).toBe(null);
    expect(dicomDateTimeToUtc('20261030', '114955', 'Not/AZone')).toBe(
      dicomDateTimeToUtc('20261030', '114955', NY)
    );
  });
});

describe('instanceAcquiredAt', () => {
  it('falls back from acquisition to content, series and study fields', () => {
    expect(instanceAcquiredAt({ AcquisitionDateTime: '20261030114955.5-0400' }, NY)).toBe(
      Date.parse('2026-10-30T15:49:55Z')
    );
    expect(instanceAcquiredAt({ SeriesDate: '20261030', ContentTime: '114955' }, NY)).toBe(
      Date.parse('2026-10-30T15:49:55Z')
    );
    expect(instanceAcquiredAt({}, NY)).toBe(null);
  });
});

describe('getConsultCoverage', () => {
  // Consult completed 12:12 PM New York time on Oct 30.
  const consult = { completedAt: Date.parse('2026-10-30T16:12:00Z'), timeZone: NY };
  const series = (uid, ...times) => ({
    displaySetInstanceUID: uid,
    instances: times.map(t => ({ AcquisitionDate: '20261030', AcquisitionTime: t })),
  });

  it('covers series acquired before the consult; a series with any later image is not', () => {
    const coverage = getConsultCoverage(
      [
        series('a', '1141'),
        series('b', '1150', '1205'),
        series('c', '1150', '1300'),
        series('d', '1400'),
      ],
      consult
    );
    expect([...coverage.covered]).toEqual(['a', 'b']);
    expect(coverage).toMatchObject({ total: 4, after: 2 });
  });

  it('shows nothing when every series was covered or there is no consult', () => {
    expect(getConsultCoverage([series('a', '1141')], consult)).toBe(null);
    expect(getConsultCoverage([series('a', '1400')], null)).toBe(null);
  });
});

describe('latestCompletedConsult', () => {
  it('takes the latest completed consult with its case timezone; ignores incomplete ones', () => {
    expect(
      latestCompletedConsult([
        {
          timezone: 'America/Chicago',
          consultations: [{ completed_at: '2026-10-30T16:12:00+00:00' }],
        },
        { consultations: [{ completed_at: null }, { completed_at: '2026-11-02T10:00:00Z' }] },
      ])
    ).toEqual({ completedAt: Date.parse('2026-11-02T10:00:00Z'), timeZone: NY });
    expect(latestCompletedConsult([{ consultations: [{ completed_at: null }] }])).toBe(null);
  });
});
