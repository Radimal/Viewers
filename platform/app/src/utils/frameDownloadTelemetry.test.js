import { startFrameDownloadTelemetry, stopFrameDownloadTelemetry } from './frameDownloadTelemetry';
import { capturePostHogEvent } from './posthog';

jest.mock('./posthog', () => ({
  capturePostHogEvent: jest.fn(),
}));

const FRAME_BASE =
  'https://veg-view.prod-1.radimal.ai/dicom-web/studies/1.2.3/series/4.5/instances/6.7/frames';

let observerCallback;
let observeSpy;
let disconnectSpy;

class MockPerformanceObserver {
  constructor(cb) {
    observerCallback = cb;
    this.observe = observeSpy;
    this.disconnect = disconnectSpy;
  }
}

const frameEntry = (overrides = {}) => ({
  name: `${FRAME_BASE}/1`,
  duration: 100,
  startTime: 1000,
  responseStart: 1040,
  transferSize: 50000,
  ...overrides,
});

const emit = entries => observerCallback({ getEntries: () => entries });

const flushInterval = () => jest.advanceTimersByTime(15000);

describe('frameDownloadTelemetry', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    observeSpy = jest.fn();
    disconnectSpy = jest.fn();
    global.PerformanceObserver = MockPerformanceObserver;
    capturePostHogEvent.mockClear();
    startFrameDownloadTelemetry();
  });

  afterEach(() => {
    stopFrameDownloadTelemetry();
    jest.useRealTimers();
    delete global.PerformanceObserver;
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

  it('flushes pending stats on stop', () => {
    emit([frameEntry()]);
    stopFrameDownloadTelemetry();

    expect(capturePostHogEvent).toHaveBeenCalledTimes(1);
    expect(capturePostHogEvent.mock.calls[0][1].flush_reason).toBe('stop');
    expect(disconnectSpy).toHaveBeenCalled();
  });
});
