/**
 * @jest-environment jsdom
 */
import { isTransportRejection } from './isTransportRejection';

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

  it('does NOT swallow real errors', () => {
    expect(isTransportRejection(new Error('Invalid VOI LUT function'))).toBe(false);
    expect(isTransportRejection(undefined)).toBe(false);
    expect(isTransportRejection('request failed')).toBe(false);
  });
});
