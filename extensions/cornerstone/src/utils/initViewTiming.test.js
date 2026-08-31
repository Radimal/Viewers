// Virtual factory mocks: the workspace packages aren't resolvable from this
// extension under jest, and the real @cornerstonejs/core (wasm/vtk.js) would
// not load under jsdom anyway. This test only exercises the visibility gate.
jest.mock(
  '@ohif/core',
  () => ({
    log: { timingKeys: {}, timeStartedAt: {}, timeEnd: () => {} },
    Enums: { TimingEnum: {} },
  }),
  { virtual: true }
);
jest.mock(
  '@cornerstonejs/core',
  () => ({
    EVENTS: { IMAGE_RENDERED: 'IMAGE_RENDERED' },
    getEnabledElement: () => undefined,
    metaData: { get: () => undefined },
  }),
  { virtual: true }
);

import { wasHiddenDuringWindow } from './initViewTiming';

function setVisibility(state) {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

const tick = () => new Promise(resolve => setTimeout(resolve, 5));

describe('wasHiddenDuringWindow', () => {
  beforeEach(() => {
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    });
  });

  it('keeps a sample from a tab that stayed visible', () => {
    expect(wasHiddenDuringWindow(performance.now())).toBe(false);
  });

  it('flags a sample while the tab is still hidden', () => {
    setVisibility('hidden');
    expect(wasHiddenDuringWindow(performance.now())).toBe(true);
  });

  it('flags a sample whose window was interrupted by a hidden stretch', () => {
    const startedAt = performance.now();
    setVisibility('hidden');
    setVisibility('visible');
    expect(wasHiddenDuringWindow(startedAt)).toBe(true);
  });

  it('keeps a sample opened after an earlier hidden stretch ended', async () => {
    setVisibility('hidden');
    setVisibility('visible');
    await tick();
    expect(wasHiddenDuringWindow(performance.now())).toBe(false);
  });
});
