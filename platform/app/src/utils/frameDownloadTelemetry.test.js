import { startFrameDownloadTelemetry, stopFrameDownloadTelemetry } from './frameDownloadTelemetry';
import { capturePostHogEvent } from './posthog';

jest.mock('./posthog', () => ({
  capturePostHogEvent: jest.fn(),
}));

const FRAME_BASE =
  'https://veg-view.prod-1.radimal.ai/dicom-web/studies/1.2.3/series/4.5/instances/6.7/frames';

let observers;
let observeSpy;
let disconnectSpy;
let nowMs;

// Callbacks are registered by the entry type passed to observe(), because the
// module now runs two observers and "the last one constructed" is ambiguous.
class MockPerformanceObserver {
  constructor(cb) {
    this.observe = init => {
      observers[init.type] = cb;
      observeSpy(init);
    };
    this.disconnect = disconnectSpy;
  }
}

function setVisibility(state) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
}

function fireVisibilityChange() {
  document.dispatchEvent(new Event('visibilitychange'));
}

const frameEntry = (overrides = {}) => ({
  name: `${FRAME_BASE}/1`,
  duration: 100,
  startTime: 1000,
  responseStart: 1040,
  transferSize: 50000,
  ...overrides,
});

const emit = entries => observers.resource({ getEntries: () => entries });

const emitLongTasks = durations =>
  observers.longtask({ getEntries: () => durations.map(duration => ({ duration })) });

// performance.now() is driven explicitly rather than relying on fake timers to
// fake it, so window_ms and hidden_ms assertions are exact rather than
// approximate. Wall clock must advance before the timer fires, since the flush
// reads the clock from inside the interval callback.
const advance = ms => {
  nowMs += ms;
  jest.advanceTimersByTime(ms);
};

const flushInterval = () => advance(15000);

/** Restarts the module so a test can change what the environment supports. */
const restart = () => {
  stopFrameDownloadTelemetry();
  capturePostHogEvent.mockClear();
  startFrameDownloadTelemetry();
};

const propsOf = index => capturePostHogEvent.mock.calls[index][1];

describe('frameDownloadTelemetry', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    observers = {};
    observeSpy = jest.fn();
    disconnectSpy = jest.fn();
    nowMs = 1_000_000;
    performance.now = () => nowMs;
    delete MockPerformanceObserver.supportedEntryTypes;
    global.PerformanceObserver = MockPerformanceObserver;
    setVisibility('visible');
    capturePostHogEvent.mockClear();
    startFrameDownloadTelemetry();
  });

  afterEach(() => {
    stopFrameDownloadTelemetry();
    jest.useRealTimers();
    delete global.PerformanceObserver;
    setVisibility('visible');
  });

  it('observes buffered resource entries', () => {
    expect(observeSpy).toHaveBeenCalledWith({ type: 'resource', buffered: true });
  });

  it('aggregates frame downloads per study and emits stats on the interval flush', () => {
    emit([
      frameEntry({ duration: 50 }),
      frameEntry({ name: `${FRAME_BASE}/2`, duration: 150 }),
      frameEntry({ name: `${FRAME_BASE}/3`, duration: 1000 }),
    ]);
    flushInterval();

    expect(capturePostHogEvent).toHaveBeenCalledTimes(1);
    const [event, props] = capturePostHogEvent.mock.calls[0];
    expect(event).toBe('frame_download_stats');
    expect(props).toMatchObject({
      study_instance_uid: '1.2.3',
      flush_reason: 'interval',
      frames: 3,
      network_frames: 3,
      cached_frames: 0,
      p50_ms: 150,
      max_ms: 1000,
      p50_ttfb_ms: 40,
      network_bytes: 150000,
    });
  });

  it('ignores resources that are not dicom-web frame requests', () => {
    emit([frameEntry({ name: 'https://veg-view.prod-1.radimal.ai/app.js' })]);
    flushInterval();
    expect(capturePostHogEvent).not.toHaveBeenCalled();
  });

  it('counts transferSize 0 as a cache hit and excludes it from TTFB and bytes', () => {
    emit([frameEntry({ duration: 5, transferSize: 0 }), frameEntry({ duration: 200 })]);
    flushInterval();

    const [, props] = capturePostHogEvent.mock.calls[0];
    expect(props).toMatchObject({
      frames: 2,
      cached_frames: 1,
      network_frames: 1,
      network_bytes: 50000,
      p50_ttfb_ms: 40,
    });
  });

  it('counts entries without timing detail (responseStart 0) as opaque', () => {
    emit([frameEntry({ responseStart: 0, transferSize: 0 })]);
    flushInterval();

    const [, props] = capturePostHogEvent.mock.calls[0];
    expect(props).toMatchObject({
      frames: 1,
      opaque_frames: 1,
      cached_frames: 0,
      network_frames: 0,
      p50_ttfb_ms: null,
    });
  });

  it('emits separate events per study', () => {
    emit([
      frameEntry(),
      frameEntry({
        name: 'https://veg-view.prod-1.radimal.ai/dicom-web/studies/9.9.9/series/1/instances/2/frames/1',
      }),
    ]);
    flushInterval();

    expect(capturePostHogEvent).toHaveBeenCalledTimes(2);
    const studies = capturePostHogEvent.mock.calls.map(([, props]) => props.study_instance_uid);
    expect(studies.sort()).toEqual(['1.2.3', '9.9.9']);
  });

  it('clears pending stats after a flush so quiet intervals emit nothing', () => {
    emit([frameEntry()]);
    flushInterval();
    capturePostHogEvent.mockClear();

    flushInterval();
    expect(capturePostHogEvent).not.toHaveBeenCalled();
  });

  it('measures throughput over the wall clock, not the sum of concurrent durations', () => {
    // 20 frames x 13.25MB fetched concurrently over one HTTP/2 connection in 20s.
    // Each entry's duration spans the whole window, so summing them would
    // overcount elapsed time 20x and understate throughput by the same factor.
    const N = 20;
    const BYTES = 13_250_340;
    const WALL_MS = 20_000;
    emit(
      Array.from({ length: N }, (_, i) =>
        frameEntry({
          name: `${FRAME_BASE}/${i}`,
          startTime: 1000,
          duration: WALL_MS,
          responseStart: 1050,
          transferSize: BYTES,
        })
      )
    );
    flushInterval();

    const [, props] = capturePostHogEvent.mock.calls[0];
    expect(props.network_frames).toBe(N);
    expect(props.network_active_ms).toBe(WALL_MS);
    // bits / ms === kbit/s
    expect(props.network_kbps).toBe(Math.round((N * BYTES * 8) / WALL_MS));
  });

  it('excludes idle gaps between bursts from the active window', () => {
    // Two 100ms bursts separated by a 5s gap: 200ms active, not 5.2s.
    emit([
      frameEntry({ startTime: 1000, duration: 100, responseStart: 1010 }),
      frameEntry({ name: `${FRAME_BASE}/2`, startTime: 1050, duration: 50, responseStart: 1060 }),
      frameEntry({ name: `${FRAME_BASE}/3`, startTime: 6100, duration: 100, responseStart: 6110 }),
    ]);
    flushInterval();

    const [, props] = capturePostHogEvent.mock.calls[0];
    expect(props.network_active_ms).toBe(200);
  });

  it('reports null throughput when no frame had readable timing detail', () => {
    // The cross-origin/no-TAO case: responseStart 0 => opaque, no spans.
    emit([frameEntry({ responseStart: 0, transferSize: 0 })]);
    flushInterval();

    const [, props] = capturePostHogEvent.mock.calls[0];
    expect(props.opaque_frames).toBe(1);
    expect(props.network_kbps).toBeNull();
    expect(props.network_active_ms).toBe(0);
  });

  it('flushes pending stats on stop', () => {
    emit([frameEntry()]);
    stopFrameDownloadTelemetry();

    expect(capturePostHogEvent).toHaveBeenCalledTimes(1);
    expect(capturePostHogEvent.mock.calls[0][1].flush_reason).toBe('stop');
    expect(disconnectSpy).toHaveBeenCalled();
  });

  describe('flush-window accounting', () => {
    // One test per reachable cell of
    // {flush reason} x {visibility during the window} x {visibility at emit}.

    it('reports the wall clock actually elapsed, not the scheduled interval', () => {
      // A deferred timer is the only direct read available on background timer
      // throttling: the interval is scheduled for 15s, so anything longer is
      // time the browser withheld.
      emit([frameEntry()]);
      nowMs += 45_000;
      jest.advanceTimersByTime(15_000);

      expect(propsOf(0).window_ms).toBe(45_000);
    });

    it('reports hidden_ms 0 for a window that stayed visible', () => {
      emit([frameEntry()]);
      flushInterval();

      expect(propsOf(0).hidden_ms).toBe(0);
    });

    it('reports hidden_ms 0 on the flush triggered BY the hide', () => {
      // The window that just ended was the visible one. Reading
      // document.visibilityState at emit time would call this window hidden,
      // because the hide is what triggered the flush.
      emit([frameEntry()]);
      advance(6_000);
      setVisibility('hidden');
      fireVisibilityChange();

      expect(propsOf(0).flush_reason).toBe('hidden');
      expect(propsOf(0).hidden_ms).toBe(0);
      expect(propsOf(0).window_ms).toBe(6_000);
    });

    it('charges a fully hidden window entirely to hidden_ms', () => {
      setVisibility('hidden');
      fireVisibilityChange();
      capturePostHogEvent.mockClear();

      emit([frameEntry()]);
      flushInterval();

      expect(propsOf(0)).toMatchObject({ hidden_ms: 15_000, window_ms: 15_000 });
    });

    it('keeps charging hidden_ms across consecutive flushes in one hidden stretch', () => {
      // The stretch outlives the window. A flush that closed it instead of
      // re-basing it would report the first window hidden and every window
      // after it visible -- wrong in exactly the long-backgrounded case this
      // field exists for.
      setVisibility('hidden');
      fireVisibilityChange();
      capturePostHogEvent.mockClear();

      emit([frameEntry()]);
      flushInterval();
      emit([frameEntry()]);
      flushInterval();

      expect(propsOf(0)).toMatchObject({ hidden_ms: 15_000, window_ms: 15_000 });
      expect(propsOf(1)).toMatchObject({ hidden_ms: 15_000, window_ms: 15_000 });
    });

    it('accumulates a hidden stretch that ended inside the window', () => {
      // The flush at the hide clears the window, so the measured stretch is
      // hidden -> visible -> flush.
      setVisibility('hidden');
      fireVisibilityChange();
      advance(4_000);
      setVisibility('visible');
      fireVisibilityChange();
      advance(1_000);
      emit([frameEntry()]);
      capturePostHogEvent.mockClear();
      advance(10_000);
      jest.advanceTimersByTime(0);

      expect(propsOf(0)).toMatchObject({ hidden_ms: 4_000, window_ms: 15_000 });
    });

    it('charges a tab that booted hidden without ever firing visibilitychange', () => {
      // ctrl-click / "open link in a background tab" fires no transition at
      // all, so a listener-only implementation reads this window as visible --
      // the case hidden_ms most needs to catch.
      stopFrameDownloadTelemetry();
      setVisibility('hidden');
      capturePostHogEvent.mockClear();
      startFrameDownloadTelemetry();

      emit([frameEntry()]);
      flushInterval();

      expect(propsOf(0).hidden_ms).toBe(15_000);
    });

    it('resets the window on a flush that emitted nothing', () => {
      flushInterval(); // nothing pending
      emit([frameEntry()]);
      flushInterval();

      expect(capturePostHogEvent).toHaveBeenCalledTimes(1);
      expect(propsOf(0).window_ms).toBe(15_000);
    });

    it('reports identical window figures on every study in one flush', () => {
      // These four describe the flush, not the study, so a consumer that sums
      // them across the events of one flush double-counts.
      emit([
        frameEntry(),
        frameEntry({
          name: FRAME_BASE.replace('/studies/1.2.3/', '/studies/9.9.9/') + '/1',
        }),
      ]);
      flushInterval();

      expect(capturePostHogEvent).toHaveBeenCalledTimes(2);
      expect(propsOf(0).window_ms).toBe(propsOf(1).window_ms);
      expect(propsOf(0).hidden_ms).toBe(propsOf(1).hidden_ms);
    });
  });

  describe('long tasks', () => {
    const withLongTaskSupport = () => {
      MockPerformanceObserver.supportedEntryTypes = ['longtask'];
      restart();
    };

    it('counts long tasks and their duration within the window', () => {
      withLongTaskSupport();
      emit([frameEntry()]);
      emitLongTasks([120, 65.4]);
      flushInterval();

      expect(propsOf(0)).toMatchObject({ long_tasks: 2, long_task_ms: 185 });
    });

    it('resets the long-task counters per window', () => {
      withLongTaskSupport();
      emit([frameEntry()]);
      emitLongTasks([120]);
      flushInterval();
      emit([frameEntry()]);
      flushInterval();

      expect(propsOf(1)).toMatchObject({ long_tasks: 0, long_task_ms: 0 });
    });

    it('reports null, not zero, where the browser cannot measure long tasks', () => {
      // Zero would read as a quiet main thread on a browser that never looked.
      emit([frameEntry()]);
      flushInterval();

      expect(propsOf(0)).toMatchObject({ long_tasks: null, long_task_ms: null });
    });

    it('observes long tasks unbuffered, so application boot is excluded', () => {
      withLongTaskSupport();

      expect(observeSpy).toHaveBeenCalledWith({ type: 'longtask' });
    });
  });
});
