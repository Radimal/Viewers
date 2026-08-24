import {
  attachStallWatchdog,
  createImageLoadFailureRetrier,
  inspectFrameResponse,
  RADIMAL_IMAGE_LOAD_TELEMETRY_EVENT,
} from './imageLoadRecovery';
import { imageLoader, getRenderingEngines, metaData } from '@cornerstonejs/core';

jest.mock(
  '@cornerstonejs/core',
  () => ({
    imageLoader: {
      loadAndCacheImage: jest.fn(),
    },
    getRenderingEngines: jest.fn(() => []),
    metaData: {
      get: jest.fn(),
    },
  }),
  { virtual: true }
);

const IMAGE_ID = 'wadors:https://example.com/dicom-web/studies/1.2.3/series/4.5.6/instances/7.8.9/frames/1';

function collectTelemetry() {
  const events = [];
  const listener = evt => events.push(evt.detail);
  window.addEventListener(RADIMAL_IMAGE_LOAD_TELEMETRY_EVENT, listener);
  return {
    events,
    stop: () => window.removeEventListener(RADIMAL_IMAGE_LOAD_TELEMETRY_EVENT, listener),
  };
}

function makeFakeXhr() {
  const listeners = {};
  return {
    addEventListener: jest.fn((type, fn) => {
      listeners[type] = listeners[type] || [];
      listeners[type].push(fn);
    }),
    removeEventListener: jest.fn((type, fn) => {
      listeners[type] = (listeners[type] || []).filter(f => f !== fn);
    }),
    abort: jest.fn(),
    emit: (type, event) => (listeners[type] || []).forEach(fn => fn(event)),
  };
}

describe('createImageLoadFailureRetrier', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    imageLoader.loadAndCacheImage.mockReset();
    getRenderingEngines.mockReset().mockReturnValue([]);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('retries a failed load and reports recovery', async () => {
    const telemetry = collectTelemetry();
    imageLoader.loadAndCacheImage.mockResolvedValueOnce({});
    const handle = createImageLoadFailureRetrier({ retryAttempts: 2, backoffMs: 100 });

    handle({ imageId: IMAGE_ID, error: new Error('network') });
    await jest.advanceTimersByTimeAsync(100);

    expect(imageLoader.loadAndCacheImage).toHaveBeenCalledTimes(1);
    expect(imageLoader.loadAndCacheImage).toHaveBeenCalledWith(IMAGE_ID);
    expect(telemetry.events).toEqual([
      expect.objectContaining({ event: 'image_load_recovered', imageId: IMAGE_ID, attempts: 1 }),
    ]);
    telemetry.stop();
  });

  it('repaints a stack viewport currently showing the recovered image', async () => {
    imageLoader.loadAndCacheImage.mockResolvedValueOnce({});
    const setImageIdIndex = jest.fn();
    getRenderingEngines.mockReturnValue([
      {
        getViewports: () => [
          {
            getCurrentImageId: () => IMAGE_ID,
            getCurrentImageIdIndex: () => 3,
            setImageIdIndex,
          },
          {
            getCurrentImageId: () => 'wadors:other',
            getCurrentImageIdIndex: () => 0,
            setImageIdIndex: jest.fn(),
          },
        ],
      },
    ]);
    const handle = createImageLoadFailureRetrier({ retryAttempts: 1, backoffMs: 50 });

    handle({ imageId: IMAGE_ID, error: new Error('network') });
    await jest.advanceTimersByTimeAsync(50);

    expect(setImageIdIndex).toHaveBeenCalledWith(3);
  });

  it('reports terminal failure after exhausting retries and backs off further events', async () => {
    const telemetry = collectTelemetry();
    imageLoader.loadAndCacheImage.mockRejectedValue(new Error('still down'));
    const handle = createImageLoadFailureRetrier({ retryAttempts: 2, backoffMs: 100 });

    handle({ imageId: IMAGE_ID, error: new Error('network') });
    // attempt 1 after 100ms, attempt 2 after another 200ms
    await jest.advanceTimersByTimeAsync(300);

    expect(imageLoader.loadAndCacheImage).toHaveBeenCalledTimes(2);
    expect(telemetry.events).toEqual([
      expect.objectContaining({ event: 'image_load_failed', imageId: IMAGE_ID, attempts: 2 }),
    ]);

    // Immediately repeated failure events do not restart the cycle.
    handle({ imageId: IMAGE_ID, error: new Error('network') });
    await jest.advanceTimersByTimeAsync(300);
    expect(imageLoader.loadAndCacheImage).toHaveBeenCalledTimes(2);
    telemetry.stop();
  });

  it('does not retry permanent HTTP failures', async () => {
    const telemetry = collectTelemetry();
    const handle = createImageLoadFailureRetrier({ retryAttempts: 2, backoffMs: 100 });

    handle({ imageId: IMAGE_ID, error: { status: 404 } });
    await jest.advanceTimersByTimeAsync(1000);

    expect(imageLoader.loadAndCacheImage).not.toHaveBeenCalled();
    expect(telemetry.events).toEqual([
      expect.objectContaining({ event: 'image_load_failed', imageId: IMAGE_ID, attempts: 0, status: 404 }),
    ]);
    telemetry.stop();
  });

  it('ignores concurrent failure events for an imageId already being retried', async () => {
    imageLoader.loadAndCacheImage.mockResolvedValue({});
    const handle = createImageLoadFailureRetrier({ retryAttempts: 2, backoffMs: 100 });

    handle({ imageId: IMAGE_ID, error: new Error('network') });
    handle({ imageId: IMAGE_ID, error: new Error('network') });
    await jest.advanceTimersByTimeAsync(100);

    expect(imageLoader.loadAndCacheImage).toHaveBeenCalledTimes(1);
  });
});

describe('attachStallWatchdog', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('aborts a stalled request and reports it', () => {
    const telemetry = collectTelemetry();
    const xhr = makeFakeXhr();
    attachStallWatchdog(xhr, IMAGE_ID, { stallTimeoutMs: 10000, maxDurationMs: 0 });

    jest.advanceTimersByTime(5000);
    xhr.emit('progress', { loaded: 1000 });
    jest.advanceTimersByTime(11000);

    expect(xhr.abort).toHaveBeenCalledTimes(1);
    expect(telemetry.events).toEqual([
      expect.objectContaining({
        event: 'image_load_stall_aborted',
        imageId: IMAGE_ID,
        reason: 'stalled',
        loadedBytes: 1000,
      }),
    ]);
    telemetry.stop();
  });

  it('aborts a request exceeding the max duration even with steady progress', () => {
    const telemetry = collectTelemetry();
    const xhr = makeFakeXhr();
    attachStallWatchdog(xhr, IMAGE_ID, { stallTimeoutMs: 60000, maxDurationMs: 20000 });

    for (let i = 0; i < 5; i++) {
      jest.advanceTimersByTime(5000);
      xhr.emit('progress', { loaded: (i + 1) * 1000 });
    }

    expect(xhr.abort).toHaveBeenCalledTimes(1);
    expect(telemetry.events).toEqual([
      expect.objectContaining({ event: 'image_load_stall_aborted', reason: 'max_duration' }),
    ]);
    telemetry.stop();
  });

  it('stops watching once the request finishes', () => {
    const xhr = makeFakeXhr();
    attachStallWatchdog(xhr, IMAGE_ID, { stallTimeoutMs: 10000, maxDurationMs: 0 });

    jest.advanceTimersByTime(5000);
    xhr.emit('loadend', {});
    jest.advanceTimersByTime(60000);

    expect(xhr.abort).not.toHaveBeenCalled();
  });

  it('does nothing when disabled', () => {
    const xhr = makeFakeXhr();
    attachStallWatchdog(xhr, IMAGE_ID, { stallTimeoutMs: 0, maxDurationMs: 0 });
    expect(xhr.addEventListener).not.toHaveBeenCalled();
  });
});

describe('inspectFrameResponse', () => {
  const ascii = str => Array.from(str, c => c.charCodeAt(0));

  const multipartBody = payload => {
    const head = ascii('--BOUNDARY\r\nContent-Type: application/octet-stream\r\n\r\n');
    const tail = ascii('\r\n--BOUNDARY--');
    return Uint8Array.from([...head, ...payload, ...tail]).buffer;
  };

  const fakeXhr = (body, headers, status = 200) => ({
    status,
    response: body,
    getResponseHeader: name => headers[name.toLowerCase()] ?? null,
  });

  const rawHeaders = length => ({
    'content-length': String(length),
    'content-type':
      'multipart/related; type="application/octet-stream; transfer-syntax=1.2.840.10008.1.2.1"; boundary=BOUNDARY',
  });

  beforeEach(() => {
    metaData.get.mockReset().mockImplementation(type => {
      if (type === 'imagePixelModule') {
        return { bitsAllocated: 16, samplesPerPixel: 1 };
      }
      if (type === 'imagePlaneModule') {
        return { rows: 10, columns: 10 };
      }
      return undefined;
    });
  });

  it('emits nothing for a healthy declared-raw frame of the expected size', () => {
    const telemetry = collectTelemetry();
    const body = multipartBody(new Array(200).fill(0x41)); // 10x10x16bit = 200 bytes
    inspectFrameResponse(fakeXhr(body, rawHeaders(body.byteLength)), IMAGE_ID);
    expect(telemetry.events).toEqual([]);
    telemetry.stop();
  });

  it('reports a truncated declared-raw payload as raw_size_mismatch', () => {
    const telemetry = collectTelemetry();
    const body = multipartBody(new Array(120).fill(0x41)); // 120 of 200 expected bytes
    inspectFrameResponse(fakeXhr(body, rawHeaders(body.byteLength)), IMAGE_ID);
    expect(telemetry.events).toEqual([
      expect.objectContaining({
        event: 'frame_integrity_mismatch',
        imageId: IMAGE_ID,
        reasons: ['raw_size_mismatch'],
        payloadBytes: 120,
        expectedRawBytes: 200,
      }),
    ]);
    telemetry.stop();
  });

  it('reports a JPEG codestream under a raw label as syntax_mismatch', () => {
    const telemetry = collectTelemetry();
    const jpeg = [0xff, 0xd8, 0xff, 0xe0, ...new Array(120).fill(0), 0xff, 0xd9];
    const body = multipartBody(jpeg);
    inspectFrameResponse(fakeXhr(body, rawHeaders(body.byteLength)), IMAGE_ID);
    expect(telemetry.events).toEqual([
      expect.objectContaining({
        event: 'frame_integrity_mismatch',
        reasons: ['syntax_mismatch', 'raw_size_mismatch'],
      }),
    ]);
    telemetry.stop();
  });

  it('reports a body shorter than Content-Length as length_mismatch', () => {
    const telemetry = collectTelemetry();
    const body = multipartBody(new Array(200).fill(0x41));
    inspectFrameResponse(fakeXhr(body, rawHeaders(body.byteLength + 5000)), IMAGE_ID);
    expect(telemetry.events).toEqual([
      expect.objectContaining({
        event: 'frame_integrity_mismatch',
        reasons: ['length_mismatch'],
      }),
    ]);
    telemetry.stop();
  });

  it('skips raw-size checks for compressed transfer syntaxes', () => {
    const telemetry = collectTelemetry();
    const jpeg = [0xff, 0xd8, 0xff, 0xe0, ...new Array(120).fill(0), 0xff, 0xd9];
    const body = multipartBody(jpeg);
    const headers = {
      'content-length': String(body.byteLength),
      'content-type':
        'multipart/related; type="image/jpeg; transfer-syntax=1.2.840.10008.1.2.4.70"; boundary=BOUNDARY',
    };
    inspectFrameResponse(fakeXhr(body, headers), IMAGE_ID);
    expect(telemetry.events).toEqual([]);
    telemetry.stop();
  });

  it('ignores non-2xx responses and missing pixel metadata', () => {
    const telemetry = collectTelemetry();
    const body = multipartBody(new Array(120).fill(0x41));
    inspectFrameResponse(fakeXhr(body, rawHeaders(body.byteLength), 404), IMAGE_ID);
    metaData.get.mockReturnValue(undefined);
    inspectFrameResponse(fakeXhr(body, rawHeaders(body.byteLength)), IMAGE_ID);
    expect(telemetry.events).toEqual([]);
    telemetry.stop();
  });
});

