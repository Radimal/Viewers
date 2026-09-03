/**
 * Keeps image downloads running at full rate while the tab is hidden.
 *
 * The request pools refill their in-flight slots through a timer:
 * `RequestPoolManager.startAgain()` schedules `window.setTimeout(fn, grabDelay)`
 * whenever `grabDelay !== undefined`, and both pools ship with `grabDelay = 0`
 * — which is not `undefined`, so every refill goes through a timer.
 *
 * Chrome clamps timers in a hidden page to at least 1s. The requests themselves
 * are never throttled — only the refill is — so while hidden, one tick refills
 * every free slot and throughput becomes `prefetch` frames per second. Both
 * production clusters serve `prefetch: 8` (verified on the live
 * `/app-config.js`); the `|| 5` fallback in init.tsx is dead there, and the
 * `prefetch: 25` in `public/config/default.js` — same in `main-prod.js` and
 * `veg-prod.js` — is not what ships either, since the container entrypoint
 * overwrites `app-config.js` from the environment. Live diverges on every cap,
 * not just prefetch: `interaction` is 20 there against 100 in those files.
 *
 * NOT once per minute. Chrome's intensive-throttling bucket needs a chain count
 * of five, meaning a setTimeout scheduled from inside a timer callback's own
 * task. `startAgain()`'s timer is scheduled from `requestResult.finally(...)`, a
 * microtask of the network/worker task that resolved the image load, so the
 * chain never accumulates and the timer stays in the once-per-second bucket. An
 * earlier version of this comment claimed one wake-up per minute and overstated
 * the worst case roughly sixtyfold.
 *
 * SIZE THE WIN HONESTLY. Because a tick refills all free slots, hidden
 * throughput is `slots × min(1/L, 1)` for per-frame latency `L` — so at `L ≥ 1s`
 * the clamp is not the binding constraint and this change does nothing at all.
 * Measured 2026-09-02: 47.6% of flushes report a per-frame p50 at or above 1s,
 * the fleet p50 is 905ms and the p90 is 10.1s. The benefit is real below that
 * and largest for readers who are already fast; it is absent for the slow tail
 * the viewer-latency work is actually about.
 *
 * There is also no production evidence yet that hidden tabs load slower: the
 * `viewer_hidden` event does not exist in the project's taxonomy until the
 * visibility-telemetry work ships. The case for this change is code reading.
 *
 * Setting `grabDelay` to `undefined` makes `startAgain()` call `startGrabbing()`
 * synchronously, so there is no timer left for Chrome to throttle. Applied only
 * while hidden.
 *
 * What the delay actually buys is coalescing, not the sync path: `startAgain()`
 * guards on `!this.timeoutHandle`, so N concurrent completions collapse into one
 * refill. Without it every completion runs a full `startGrabbing()`. That is
 * cheap — four `sendRequests` and a small sort each — but it is O(N) where it
 * was O(1), and it is the real cost of this change.
 *
 * The synchronous request path (`syncImageCount`, a requestFn returning a
 * non-thenable) is a narrower risk than it looks: `addRequest` is typed
 * `requestFn: () => Promise<IImage | void>`, so it is reached only when a
 * request function throws synchronously — an unregistered scheme or an undefined
 * imageId. There the refill recurses through the queue on one stack, depth
 * roughly queue ÷ prefetch. It blocks that tab's main thread; it does not
 * overflow. With `grabDelay = 0` the timer breaks that chain, so this change
 * does make that case worse.
 *
 * Rendering is untouched and stays `requestAnimationFrame`-driven, which is
 * correct — a hidden tab has nothing to paint. This only changes how fast the
 * pixels are *ready* when the reader comes back.
 *
 * A prerendering document reports `visibilityState 'hidden'`, so this unthrottles
 * it too. Deliberate: warming a page the browser is preparing is the point of a
 * prerender. Stated because the visibility telemetry in `posthog.ts` and
 * `initViewTiming.ts` deliberately EXCLUDES prerendering, and three files
 * treating the same edge two ways should say which is which.
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

  // Captured, not hardcoded to 0. Both singletons set 0 today, but
  // RequestPoolManager's constructor default is 5, so restoring a literal would
  // silently pin any pool that later ships a deliberate pacing value — or any
  // third pool added here carrying the constructor default.
  const originals = pools.map(pool => pool.grabDelay);

  const applyGrabDelay = () => {
    const hidden = document.visibilityState === 'hidden';
    pools.forEach((pool, i) => {
      pool.grabDelay = hidden ? undefined : originals[i];
    });
  };

  document.addEventListener('visibilitychange', applyGrabDelay);

  // A tab opened in the background (ctrl-click, "open link in a background
  // tab") fires no visibilitychange, so the listener alone would leave the
  // throttled default in place for exactly the case this exists to fix.
  applyGrabDelay();
}
