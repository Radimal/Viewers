import {
  applyWheelPreferences,
  getScrollWheelTool,
  getScrollWheelInversion,
} from './wheelPreferences';

const WHEEL = 524288; // cs3d 5 Enums.MouseBindings.Wheel

function makeTools() {
  return [
    { toolName: 'WindowLevel', bindings: [{ mouseButton: 1 }] },
    { toolName: 'Zoom', bindings: [{ mouseButton: 2 }, { numTouchPoints: 2 }] },
    { toolName: 'StackScroll', bindings: [{ mouseButton: WHEEL }, { numTouchPoints: 3 }] },
  ];
}

describe('wheelPreferences', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('defaults to StackScroll, no inversion', () => {
    expect(getScrollWheelTool()).toBe('StackScroll');
    expect(getScrollWheelInversion()).toBe(false);

    const tools = makeTools();
    applyWheelPreferences(tools, WHEEL);
    expect(tools.find(t => t.toolName === 'StackScroll').bindings).toContainEqual({
      mouseButton: WHEEL,
    });
    expect(tools.find(t => t.toolName === 'Zoom').configuration).toBeUndefined();
  });

  it('moves the wheel binding to Zoom when preferred', () => {
    localStorage.setItem('scrollWheelTool', 'Zoom');

    const tools = makeTools();
    applyWheelPreferences(tools, WHEEL);

    const stackScroll = tools.find(t => t.toolName === 'StackScroll');
    const zoom = tools.find(t => t.toolName === 'Zoom');
    expect(stackScroll.bindings).toEqual([{ numTouchPoints: 3 }]);
    expect(zoom.bindings).toContainEqual({ mouseButton: WHEEL });
    // touch bindings retained
    expect(zoom.bindings).toContainEqual({ numTouchPoints: 2 });
  });

  it('sets invert configuration on the wheel tool', () => {
    localStorage.setItem('invertScrollWheel', 'true');

    const tools = makeTools();
    applyWheelPreferences(tools, WHEEL);
    expect(tools.find(t => t.toolName === 'StackScroll').configuration).toEqual({ invert: true });

    localStorage.setItem('scrollWheelTool', 'Zoom');
    const tools2 = makeTools();
    applyWheelPreferences(tools2, WHEEL);
    expect(tools2.find(t => t.toolName === 'Zoom').configuration).toEqual({ invert: true });
    expect(tools2.find(t => t.toolName === 'StackScroll').configuration).toBeUndefined();
  });

  it('ignores invalid stored values and missing wheelButton', () => {
    localStorage.setItem('scrollWheelTool', 'Nonsense');
    expect(getScrollWheelTool()).toBe('StackScroll');

    const tools = makeTools();
    expect(applyWheelPreferences(tools, undefined)).toBe(tools);
  });
});
