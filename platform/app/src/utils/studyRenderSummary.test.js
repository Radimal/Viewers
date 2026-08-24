import { mergedBusyMs, median } from './studyRenderSummary';

describe('studyRenderSummary helpers', () => {
  it('mergedBusyMs unions overlapping request intervals', () => {
    expect(mergedBusyMs([])).toBe(0);
    expect(mergedBusyMs([{ start: 0, end: 100 }])).toBe(100);
    // Overlap collapses; the gap is excluded.
    expect(
      mergedBusyMs([
        { start: 0, end: 100 },
        { start: 50, end: 150 },
        { start: 300, end: 400 },
      ])
    ).toBe(250);
    // Contained interval adds nothing; unsorted input is fine.
    expect(
      mergedBusyMs([
        { start: 200, end: 210 },
        { start: 0, end: 100 },
        { start: 20, end: 80 },
      ])
    ).toBe(110);
  });

  it('median handles empty, odd, and even inputs', () => {
    expect(median([])).toBeNull();
    expect(median([7])).toBe(7);
    expect(median([9, 1, 5])).toBe(5);
    expect(median([1, 2, 3, 100])).toBe(3); // (2+3)/2 rounded
  });
});
