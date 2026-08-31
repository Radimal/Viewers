import { wasHiddenDuringWindow } from './initViewTiming';
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

// The predicate above is pure and well covered, but nothing pinned its CALL
// SITE, which is where the interesting regression lives: passing
// performance.now() instead of startedAt collapses wasHiddenDuringWindow to
// "hidden right now", so a tab backgrounded during load and refocused before
// the paint reports false — clean for exactly the samples the flag exists to
// exclude, leaving the multi-hour outliers in the percentile tiles.
describe('hidden_during_load on the emitted event', () => {
  // Fresh registry per case: IMAGE_TIMING_KEYS, viewportsWaiting and
  // hasCapturedFirstImageThisPageLoad are all module state, and the module's
  // own visibilitychange listener must be the one under test.
  const renderWith = async ({ flipVisibility }) => {
    const captured = [];
    let element;
    await jest.isolateModulesAsync(async () => {
      // Importing the mock first inside the isolate gets the same instance the
      // module under test will receive, so configuring it here takes effect.
      const { log, Enums } = await import('@ohif/core');
      Enums.TimingEnum = {
        STUDY_TO_FIRST_IMAGE: 'studyToFirstImage',
        DISPLAY_SETS_TO_FIRST_IMAGE: 'displaySetsToFirstImage',
        DISPLAY_SETS_TO_ALL_IMAGES: 'displaySetsToAllImages',
        SCRIPT_TO_VIEW: 'scriptToView',
      };
      log.timingKeys = { studyToFirstImage: true };
      log.timeEnd = () => {};

      const initViewTiming = (await import('./initViewTiming')).default;
      window.__capturePostHogEvent = (name, props) => captured.push([name, props]);

      // Explicit, not inherited: a prior case may have left the document hidden,
      // and this helper's whole point is controlling the visibility timeline.
      // Done BEFORE stamping startedAt, so this reset is not itself a flip
      // inside the measured window.
      setVisibility('visible');
      await tick();

      // startedAt must predate the visibility flips below, exactly as a real
      // study-open timer predates the reader switching tabs.
      log.timeStartedAt = { studyToFirstImage: performance.now() };

      element = document.createElement('div');
      initViewTiming({ element });

      if (flipVisibility) {
        setVisibility('hidden');
        setVisibility('visible');
      }
      await tick();

      element.dispatchEvent(
        new CustomEvent('IMAGE_RENDERED', {
          detail: { viewportStatus: 'render', element },
        })
      );
    });
    delete window.__capturePostHogEvent;
    return captured;
  };

  it('flags a load interrupted by a hidden stretch, even though the paint was visible', async () => {
    const captured = await renderWith({ flipVisibility: true });
    expect(captured).toHaveLength(1);
    expect(captured[0][0]).toBe('first_image_rendered');
    expect(document.visibilityState).toBe('visible');
    expect(captured[0][1].hidden_during_load).toBe(true);
  });

  it('does not flag a load that stayed visible throughout', async () => {
    const captured = await renderWith({ flipVisibility: false });
    expect(captured).toHaveLength(1);
    expect(captured[0][1].hidden_during_load).toBe(false);
  });
});
