/**
 * True when a rejection reason is a raw network transport failure — an
 * XMLHttpRequest (cs3d's xhrRequest rejects with the XHR itself) or an object
 * exposing an HTTP status + responseURL — or a fetch body stream cut off mid-download
 * (cs3d's streaming frame loader leaves it unhandled; closing a viewer window mid-load
 * also raises it). Matched by the exact message each browser uses only for a cut-off
 * body. Safari isn't matched: its 'Load failed' also means the request never connected,
 * which must still escalate like Chrome's 'Failed to fetch'.
 *
 * The route error boundary must not blank the viewer over one of these:
 * Orthanc answers 504/409 for frames it is still writing (live study-populate
 * polls mid-ingest by design), and the request pool / next poll tick retries.
 */
const BODY_STREAM_CUT_OFF = new Set([
  'network error', // Chrome
  'Error in body stream', // Firefox
]);

export function isTransportRejection(reason: unknown): boolean {
  if (typeof XMLHttpRequest !== 'undefined' && reason instanceof XMLHttpRequest) {
    return true;
  }
  if (reason instanceof TypeError && BODY_STREAM_CUT_OFF.has(reason.message)) {
    return true;
  }
  const r = reason as { status?: unknown; responseURL?: unknown } | null;
  return typeof r?.status === 'number' && typeof r?.responseURL === 'string';
}

// cs3d's streaming frame loader (streamRequest.js) throws this for a non-200 frame and
// leaves it unhandled. Orthanc's intermittent 502s land here (about 4 reader sessions a day).
const FRAME_STATUS_ERROR = /^Couldn't retrieve \S+ got status \d+$/;

/**
 * True for a single image frame that came back with an HTTP error. Like a transport
 * failure, it must not raise the route's "Something went wrong" toast. Unlike one, it
 * still goes to Sentry (sentry.ts only drops isTransportRejection), because those
 * reports are our only signal when Orthanc starts failing frames.
 */
export function isFrameStatusError(reason: unknown): boolean {
  return reason instanceof Error && FRAME_STATUS_ERROR.test(reason.message);
}
