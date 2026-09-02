/**
 * Keeps image downloads running at full rate while the tab is hidden.
 *
 * The request pools refill their in-flight slots through a timer:
 * `RequestPoolManager.startAgain()` schedules `window.setTimeout(fn, grabDelay)`
 * whenever `grabDelay !== undefined`, and both pools ship with `grabDelay = 0`
 * — which is not `undefined`, so every refill goes through a timer.
 *
 * Chrome clamps timers in a hidden page to at least 1s, and after roughly five
 * minutes hidden it batches chained timers to one wake-up per minute
 * (exempting only tabs playing audio or running WebRTC). The requests
 * themselves are never throttled — only the refill is — so a backgrounded
 * viewer's throughput floors at `maxNumRequests` per tick: 5 prefetch frames
 * per second, and potentially 5 per *minute* once intensive throttling starts.
 *
 * That is the wrong default for this product. Radiologists work multi-window,
 * and the moments nobody is looking at the viewer are exactly the moments the
 * next case should be getting ready.
 *
 * Setting `grabDelay` to `undefined` makes `startAgain()` call `startGrabbing()`
 * synchronously, so there is no timer left for Chrome to throttle. Applied only
 * while hidden: on the synchronous request path (`syncImageCount` — a request
 * function that returns a non-thenable) that recursion runs once per request
 * rather than yielding, which is presumably why the delay exists at all.
 *
 * Rendering is untouched and stays `requestAnimationFrame`-driven, which is
 * correct — a hidden tab has nothing to paint. This only changes how fast the
 * pixels are *ready* when the reader comes back.
 *
 * ponytail: one listener and two assignments, no scheduler of our own. If the
 * synchronous refill ever shows up as main-thread jank, the upgrade is a
 * MessageChannel-based refill — a task, so it yields, and postMessage is not
 * throttled in hidden pages.
 */

/**
 * `grabDelay` is declared `number` upstream but read as `number | undefined`
 * (`startAgain` branches on `!== undefined`), so the pools are taken as
 * optional-valued here rather than casting `undefined` to `number` at the
 * assignment.
 */
type GrabDelayPool = { grabDelay?: number };

export default function unthrottleHiddenDownloads(pools: GrabDelayPool[]): void {
  if (typeof document === 'undefined') {
    return;
  }

  const applyGrabDelay = () => {
    const grabDelay = document.visibilityState === 'hidden' ? undefined : 0;
    pools.forEach(pool => {
      pool.grabDelay = grabDelay;
    });
  };

  document.addEventListener('visibilitychange', applyGrabDelay);

  // A tab opened in the background (ctrl-click, "open link in a background
  // tab") fires no visibilitychange, so the listener alone would leave the
  // throttled default in place for exactly the case this exists to fix.
  applyGrabDelay();
}
