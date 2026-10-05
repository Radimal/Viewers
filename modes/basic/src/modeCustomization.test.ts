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

  it('pins at most 10 tools', () => {
    const tools = Array.from({ length: 12 }, (_, i) => `T${i}`);
    localStorage.setItem('pinnedToolbarTools', JSON.stringify(tools));
    const s = { primary: ['MoreTools'], MoreTools: [...tools] };
    applyPinnedTools(s);
    expect(s.primary).toEqual([...tools.slice(0, 10), 'MoreTools']);
    expect(s.MoreTools).toEqual(['T10', 'T11']);
  });

  it('leaves sections untouched with no or bad preference', () => {
    localStorage.setItem('pinnedToolbarTools', '{not json');
    const s = sections();
    applyPinnedTools(s);
    expect(s).toEqual(sections());
  });
});
