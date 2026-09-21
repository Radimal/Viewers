/**
 * True when a rejection reason is a raw network transport failure — an
 * XMLHttpRequest (cs3d's xhrRequest rejects with the XHR itself) or an object
 * exposing an HTTP status + responseURL.
 *
 * The route error boundary must not blank the viewer over one of these:
 * Orthanc answers 504/409 for frames it is still writing (live study-populate
 * polls mid-ingest by design), and the request pool / next poll tick retries.
 */
export function isTransportRejection(reason: unknown): boolean {
  if (typeof XMLHttpRequest !== 'undefined' && reason instanceof XMLHttpRequest) {
    return true;
  }
  const r = reason as { status?: unknown; responseURL?: unknown } | null;
  return typeof r?.status === 'number' && typeof r?.responseURL === 'string';
}
