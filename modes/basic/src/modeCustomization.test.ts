import { applyPinnedTools } from './modeCustomization';

describe('applyPinnedTools', () => {
  const sections = () => ({
    primary: ['Zoom', 'MoreTools'],
    MoreTools: ['Reset', 'CalibrationLine'],
    MeasurementTools: ['Length'],
  });

  afterEach(() => localStorage.clear());

  it('moves pinned tools from their dropdown to before MoreTools', () => {
    localStorage.setItem('pinnedToolbarTools', JSON.stringify(['CalibrationLine', 'Bogus']));
    const s = sections();
    applyPinnedTools(s);
    expect(s.primary).toEqual(['Zoom', 'CalibrationLine', 'MoreTools']);
    expect(s.MoreTools).toEqual(['Reset']);
    expect(s.MeasurementTools).toEqual(['Length']);
  });

  it('leaves sections untouched with no or bad preference', () => {
    localStorage.setItem('pinnedToolbarTools', '{not json');
    const s = sections();
    applyPinnedTools(s);
    expect(s).toEqual(sections());
  });
});
