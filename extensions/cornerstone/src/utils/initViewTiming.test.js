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
    secondViewportSameStudy = false,
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
      // The real log.timeEnd sets timingKeys[key] = false, which is what stops
      // a SECOND viewport of the same study from emitting a duplicate. Stubbing
      // it to a no-op leaves the flag true forever and makes that guard
      // unobservable -- deleting the guard passed the whole suite. Opt into the
      // real behaviour where the guard is the thing under test.
      log.timeEnd = secondViewportSameStudy
        ? key => {
            log.timingKeys[key] = false;
          }
        : () => {};

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

      // A two-viewport hanging protocol enables BOTH viewports before either
      // paints, so both attach a listener while the timing keys are still true.
      // Attaching the second one AFTER the first render instead makes
      // initViewTiming early-return on IMAGE_TIMING_KEYS and no listener is
      // ever added -- which tests nothing.
      let secondViewport;
      if (secondViewportSameStudy) {
        secondViewport = document.createElement('div');
        initViewTiming({ element: secondViewport });
      }

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

      if (secondViewportSameStudy) {
        // Second viewport of the SAME study paints. Its listener is already
        // attached, so the only thing standing between this and a duplicate
        // event is the timingKeys guard in captureFirstImageRendered -- the
        // per-element removeEventListener cannot help, this is a different
        // element.
        secondViewport.dispatchEvent(
          new CustomEvent('IMAGE_RENDERED', {
            detail: { viewportStatus: 'render', element: secondViewport },
          })
        );
      }

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
    // Every case in this block is about first_image_rendered, and several assert
    // on the array's LENGTH to pin "once per study, not once per viewport". The
    // same paint now also emits all_images_rendered, so returning both would
    // make those length assertions count two different events and pass or fail
    // for the wrong reason. Filtering here keeps them exact; all_images_rendered
    // has its own describe block below with its own harness.
    return captured.filter(([name]) => name === 'first_image_rendered');
  };

  it('flags a load interrupted by a hidden stretch, even though the paint was visible', async () => {
    const captured = await renderWith({ flipVisibility: true });
    expect(captured).toHaveLength(1);
    expect(captured[0][0]).toBe('first_image_rendered');
    // The paint itself was visible -- renderWith ends on setVisibility('visible')
    // -- so this pins that the flag survives a hidden stretch that already
    // CLOSED, not merely that the tab is hidden at capture time.
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
    // Prerender-guarding the visibilitychange listener still survives this
    // test -- renderWith clears `prerendering` before the activation, so the
    // guard is never reached. initViewTiming's own comment says the same. This
    // case pins the flag, not that mutant; do not read it as killing one.
    const captured = await renderWith({ flipVisibility: false, prerenderThenActivate: true });
    expect(captured).toHaveLength(1);
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
      // jsdom's default URL has no port, so host === hostname here and this
      // cannot catch that specific substitution -- it rules out href/pathname
      // only. A port would be needed to pin `host`, and setting one in jsdom
      // moves every other URL-derived assertion in this file.
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
      // ms_since_navigation_start is deliberately NOT asserted here any more.
      // capturePostHogEvent stamps it on every event, which is downstream of the
      // bridge this test spies on, so it never reaches these props. It is pinned
      // for the whole event surface in platform/app/src/utils/posthog.test.js.
      expect(captured[0][1].ms_since_navigation_start).toBeUndefined();
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

  it('emits once per study, not once per viewport of that study', async () => {
    // The timingKeys guard in captureFirstImageRendered is the ONLY thing that
    // stops this. A second viewport of one study gets its own element and its
    // own listener, so the per-element removeEventListener is irrelevant here;
    // it only prevents a repeat on the SAME element. An earlier version of this
    // test dispatched twice on one element and therefore pinned nothing -- both
    // guards could be deleted individually with the suite still green.
    //
    // Worth pinning because a duplicate would be silent: an extra
    // first_image_rendered tagged switch_type 'in_app' inflates the in_app
    // share and double-counts renders in the never-render anti-join.
    //
    // Requires the real log.timeEnd semantics; the shared harness stubs it to a
    // no-op, which is why secondViewportSameStudy opts back in.
    const captured = await renderWith({
      flipVisibility: false,
      secondViewportSameStudy: true,
    });
    expect(captured).toHaveLength(1);
    expect(captured[0][1].switch_type).toBe('reload');
  });
});

// first_image_rendered answers "when did something appear". Nothing answered
// "when was the layout finished", which is the question a reader actually asks
// and the one frame_download_stats cannot answer: its 15s flush interval is
// several times larger than the value being measured.
describe('all_images_rendered', () => {
  const render = async ({ viewports = 1, secondStudy = false } = {}) => {
    const captured = [];
    await jest.isolateModulesAsync(async () => {
      const { log, Enums } = await import('@ohif/core');
      Enums.TimingEnum = {
        STUDY_TO_FIRST_IMAGE: 'studyToFirstImage',
        DISPLAY_SETS_TO_FIRST_IMAGE: 'displaySetsToFirstImage',
        DISPLAY_SETS_TO_ALL_IMAGES: 'displaySetsToAllImages',
        SCRIPT_TO_VIEW: 'scriptToView',
      };
      log.timingKeys = { studyToFirstImage: true };
      // Real semantics: timeEnd clears timingKeys but leaves timeStartedAt, which
      // is precisely what captureAllImagesRendered relies on to read the start
      // instant after the first-image timer has already been stopped.
      log.timeEnd = key => {
        log.timingKeys[key] = false;
      };
      log.timeStartedAt = { studyToFirstImage: performance.now() };

      const initViewTiming = (await import('./initViewTiming')).default;
      window.__capturePostHogEvent = (name, props) => captured.push([name, props]);
      setVisibility('visible');
      await tick();

      // Every viewport of a study is enabled before any of them paints, so all
      // listeners attach while the timing keys are still true.
      const elements = Array.from({ length: viewports }, () => document.createElement('div'));
      elements.forEach(element => initViewTiming({ element }));
      elements.forEach(element =>
        element.dispatchEvent(
          new CustomEvent('IMAGE_RENDERED', { detail: { viewportStatus: 'render', element } })
        )
      );

      if (secondStudy) {
        log.timingKeys = { studyToFirstImage: true };
        log.timeStartedAt = { studyToFirstImage: performance.now() };
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

  it('fires once, after the last viewport of the study has painted', async () => {
    const captured = await render({ viewports: 3 });
    const all = captured.filter(([name]) => name === 'all_images_rendered');
    expect(all).toHaveLength(1);
    // Ordering is the assertion: firing on the FIRST paint instead of the last
    // would still produce exactly one event, and would still look correct.
    expect(captured.map(([name]) => name)).toEqual(['first_image_rendered', 'all_images_rendered']);
  });

  it('reports the viewport count, which viewportsWaiting cannot supply', async () => {
    // viewportsWaiting is decremented to zero to trigger this event, so reading
    // it here yields 0 for every layout. Asserted at 3 rather than "truthy": a
    // regression to viewportsWaiting gives 0 and a regression to a hardcoded 1
    // gives 1, and both must fail.
    const [[, props]] = (await render({ viewports: 3 })).filter(
      ([name]) => name === 'all_images_rendered'
    );
    expect(props.viewports).toBe(3);
  });

  it('reports switch_type reload for the first study, not in_app', async () => {
    // hasCapturedFirstImageThisPageLoad is already true by the time this event
    // fires, so reading that latch directly labels the very first study of a
    // page load 'in_app'. The latched-per-study copy is what prevents it.
    const [[, props]] = (await render({ viewports: 2 })).filter(
      ([name]) => name === 'all_images_rendered'
    );
    expect(props.switch_type).toBe('reload');
  });

  it('reports in_app for a second study in the same page load', async () => {
    const all = (await render({ secondStudy: true })).filter(
      ([name]) => name === 'all_images_rendered'
    );
    expect(all.map(([, props]) => props.switch_type)).toEqual(['reload', 'in_app']);
  });

  it('does not fire while a viewport is still outstanding', async () => {
    // A study whose second viewport never paints is the stuck-viewer case. The
    // absence of this event is the signal; manufacturing one would erase it.
    const captured = [];
    await jest.isolateModulesAsync(async () => {
      const { log, Enums } = await import('@ohif/core');
      Enums.TimingEnum = {
        STUDY_TO_FIRST_IMAGE: 'studyToFirstImage',
        DISPLAY_SETS_TO_FIRST_IMAGE: 'displaySetsToFirstImage',
        DISPLAY_SETS_TO_ALL_IMAGES: 'displaySetsToAllImages',
        SCRIPT_TO_VIEW: 'scriptToView',
      };
      log.timingKeys = { studyToFirstImage: true };
      log.timeEnd = key => {
        log.timingKeys[key] = false;
      };
      log.timeStartedAt = { studyToFirstImage: performance.now() };
      const initViewTiming = (await import('./initViewTiming')).default;
      window.__capturePostHogEvent = (name, props) => captured.push([name, props]);
      setVisibility('visible');
      await tick();

      const painted = document.createElement('div');
      const stuck = document.createElement('div');
      initViewTiming({ element: painted });
      initViewTiming({ element: stuck });
      painted.dispatchEvent(
        new CustomEvent('IMAGE_RENDERED', {
          detail: { viewportStatus: 'render', element: painted },
        })
      );
    });
    delete window.__capturePostHogEvent;
    expect(captured.map(([name]) => name)).toEqual(['first_image_rendered']);
  });

  it('flags a study whose load overlapped a hidden tab', async () => {
    const captured = [];
    await jest.isolateModulesAsync(async () => {
      const { log, Enums } = await import('@ohif/core');
      Enums.TimingEnum = {
        STUDY_TO_FIRST_IMAGE: 'studyToFirstImage',
        DISPLAY_SETS_TO_FIRST_IMAGE: 'displaySetsToFirstImage',
        DISPLAY_SETS_TO_ALL_IMAGES: 'displaySetsToAllImages',
        SCRIPT_TO_VIEW: 'scriptToView',
      };
      log.timingKeys = { studyToFirstImage: true };
      log.timeEnd = key => {
        log.timingKeys[key] = false;
      };
      const initViewTiming = (await import('./initViewTiming')).default;
      window.__capturePostHogEvent = (name, props) => captured.push([name, props]);
      setVisibility('visible');
      await tick();
      log.timeStartedAt = { studyToFirstImage: performance.now() };

      const element = document.createElement('div');
      initViewTiming({ element });
      // Backgrounded mid-load and refocused before the paint: the paint itself
      // is visible, so a "hidden right now" check would call this clean.
      setVisibility('hidden');
      setVisibility('visible');
      await tick();
      element.dispatchEvent(
        new CustomEvent('IMAGE_RENDERED', { detail: { viewportStatus: 'render', element } })
      );
    });
    delete window.__capturePostHogEvent;
    const [[, props]] = captured.filter(([name]) => name === 'all_images_rendered');
    expect(props.hidden_during_load).toBe(true);
  });
});
