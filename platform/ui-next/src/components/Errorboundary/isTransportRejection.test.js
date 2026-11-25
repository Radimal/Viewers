/**
 * @jest-environment jsdom
 */
import { isFrameStatusError, isTransportRejection } from './isTransportRejection';

// The route error boundary must not blank the viewer over a failed image /
// bulkdata request: Orthanc answers 504/409 for frames it is still writing
// (live study-populate polls mid-ingest by design) and cs3d rejects with the
// raw XHR, which the retry machinery already handles.
describe('isTransportRejection', () => {
  it('recognizes a raw XMLHttpRequest reason (cs3d transport failure)', () => {
    expect(isTransportRejection(new XMLHttpRequest())).toBe(true);
  });

  it('recognizes an XHR-shaped object (status + responseURL)', () => {
    expect(isTransportRejection({ status: 504, responseURL: 'https://x/frames/1' })).toBe(true);
  });

  it("recognizes a fetch stream cut off mid-download (Chrome's TypeError: network error)", () => {
    expect(isTransportRejection(new TypeError('network error'))).toBe(true);
    expect(isTransportRejection(new TypeError('Error in body stream'))).toBe(true); // Firefox
  });

  it('does NOT swallow real errors', () => {
    expect(isTransportRejection(new TypeError('Failed to fetch'))).toBe(false);
    // Safari uses 'Load failed' for a request that never connected too, so it escalates.
    expect(isTransportRejection(new TypeError('Load failed'))).toBe(false);
    expect(
      isTransportRejection(new TypeError("Cannot read properties of undefined (reading 'x')"))
    ).toBe(false);
    expect(isTransportRejection(new Error('Invalid VOI LUT function'))).toBe(false);
    expect(isTransportRejection(undefined)).toBe(false);
    expect(isTransportRejection('request failed')).toBe(false);
  });
});

describe('isFrameStatusError', () => {
  const frameError = status =>
    new Error(
      `Couldn't retrieve https://cdn.example/dicom-web/studies/1/series/2/instances/3/frames/1 got status ${status}`
    );

  it('recognizes a frame that came back with an HTTP error (no toast)', () => {
    expect(isFrameStatusError(frameError(502))).toBe(true);
    expect(isFrameStatusError(frameError(404))).toBe(true);
  });

  it('is not a transport rejection, so Sentry still reports it', () => {
    expect(isTransportRejection(frameError(502))).toBe(false);
  });

  it('does not match other errors', () => {
    expect(isFrameStatusError(new Error('Invalid VOI LUT function'))).toBe(false);
    expect(isFrameStatusError(new TypeError('network error'))).toBe(false);
    expect(isFrameStatusError("Couldn't retrieve x got status 502")).toBe(false);
  });
});
