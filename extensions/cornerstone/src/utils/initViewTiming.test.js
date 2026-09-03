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
// Mutable so a test can make the modality lookup resolve; with both arms
// hardwired to undefined, `modality` was unobservable and a constant passed.
const mockCs = { imageId: undefined, modality: undefined };
jest.mock(
  '@cornerstonejs/core',
  () => ({
    EVENTS: { IMAGE_RENDERED: 'IMAGE_RENDERED' },
    getEnabledElement: () =>
      mockCs.imageId ? { viewport: { getCurrentImageId: () => mockCs.imageId } } : undefined,
    metaData: { get: () => (mockCs.modality ? { modality: mockCs.modality } : undefined) },
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

  it('keeps a sample from a prerendering page, which reports hidden while rendering', () => {
    Object.defineProperty(document, 'prerendering', { value: true, configurable: true });
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    try {
      expect(wasHiddenDuringWindow(performance.now())).toBe(false);
    } finally {
      delete document.prerendering;
    }
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
  const renderWith = async ({
    flipVisibility,
    secondRender = false,
    beforeRender,
    prerenderThenActivate = false,
  }) => {
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

      if (prerenderThenActivate) {
        // The document is prerendering when the study timer starts: hidden
        // throughout, but rendering normally.
        Object.defineProperty(document, 'prerendering', { value: true, configurable: true });
        Object.defineProperty(document, 'visibilityState', {
          value: 'hidden',
          configurable: true,
        });
      }

      // startedAt must predate the visibility flips below, exactly as a real
      // study-open timer predates the reader switching tabs.
      log.timeStartedAt = { studyToFirstImage: performance.now() };

      element = document.createElement('div');
      initViewTiming({ element });

      if (prerenderThenActivate) {
        Object.defineProperty(document, 'prerendering', { value: false, configurable: true });
        setVisibility('visible');
      }

      if (flipVisibility) {
        setVisibility('hidden');
        setVisibility('visible');
      }
      await tick();
      if (beforeRender) {
        beforeRender();
      }

      element.dispatchEvent(
        new CustomEvent('IMAGE_RENDERED', {
          detail: { viewportStatus: 'render', element },
        })
      );

      if (secondRender) {
        // Same module instance, second study: this is what in-app navigation
        // looks like to the module, and the only way switch_type can read
        // anything but 'reload'.
        const second = document.createElement('div');
        initViewTiming({ element: second });
        second.dispatchEvent(
          new CustomEvent('IMAGE_RENDERED', {
            detail: { viewportStatus: 'render', element: second },
          })
        );
      }
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

  it('still flags a window that spanned prerender then activation', async () => {
    // The contract stated in initViewTiming's own comment, previously unpinned:
    // the guard covers a paint that COMPLETES during the prerender, and a
    // window spanning prerender -> activation stays flagged because the
    // activation fires visibilitychange and the interval clause stamps it.
    // A mutant prerender-guarding that listener survived the whole suite.
    const captured = await renderWith({ flipVisibility: false, prerenderThenActivate: true });
    expect(captured).toHaveLength(1);
    expect(document.visibilityState).toBe('visible');
    expect(captured[0][1].hidden_during_load).toBe(true);
  });

  it('reports the rendered modality and the cluster it came from', async () => {
    // Both were unobservable: the modality mock returned undefined on every
    // path, so a constant passed, and cluster had no assertion at all. cluster
    // is what every veg-vs-prod split groups on, including this PR's own.
    mockCs.imageId = 'wadors:https://example/frames/1';
    mockCs.modality = 'US';
    try {
      const [[, props]] = await renderWith({ flipVisibility: false });
      expect(props.modality).toBe('US');
      expect(props.cluster).toBe('localhost');
    } finally {
      mockCs.imageId = undefined;
      mockCs.modality = undefined;
    }
  });

  it('measures ms as exactly first-paint minus study-open', async () => {
    // Asserted EXACTLY, against a driven clock. A range assertion pins only the
    // clock source: dropping `- startedAt` (making ms mean "since page load"),
    // halving it, or adding a constant all stay inside a plausible band and
    // would keep every tile rendering a confident number for a different
    // quantity. Measured 2026-09-02: 9 of the 16 saved insights read
    // properties.ms directly, so that is who reads the wrong number.
    const real = performance.now.bind(performance);
    const clock = { t: 5_000 };
    performance.now = () => clock.t;
    try {
      const captured = await renderWith({
        flipVisibility: false,
        beforeRender: () => {
          clock.t = 8_250;
        },
      });
      expect(captured[0][1].ms).toBe(3_250);
    } finally {
      performance.now = real;
    }
  });

  it('reports switch_type reload for the first study of a page load', async () => {
    const [[, props]] = await renderWith({ flipVisibility: false });
    expect(props.switch_type).toBe('reload');
  });

  it('reports switch_type in_app for a second study in the same page load', async () => {
    // Reading the latch after setting it would report in_app for every sample,
    // and the reload/in_app split would read 100% in_app with no error.
    const captured = await renderWith({ flipVisibility: false, secondRender: true });
    expect(captured).toHaveLength(2);
    expect(captured[0][1].switch_type).toBe('reload');
    expect(captured[1][1].switch_type).toBe('in_app');
  });
});
