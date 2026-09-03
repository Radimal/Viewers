/**
 * Keeps image downloads running at full rate while the tab is hidden.
 *
 * The request pools refill their in-flight slots through a timer:
 * `RequestPoolManager.startAgain()` schedules `window.setTimeout(fn, grabDelay)`
 * whenever `grabDelay !== undefined`, and both pools ship with `grabDelay = 0`
 * — which is not `undefined`, so every refill goes through a timer.
 *
 * Chrome is documented to clamp timers in a hidden page to at least 1s — read
 * THE CLAMP'S REACH below before treating that as settled for this path. The
 * requests themselves are never throttled, only the refill, so where the clamp
 * does engage one tick refills every free slot and throughput falls to about
 * `prefetch` frames per second for any per-frame latency under 1s. Both
 * production clusters serve `prefetch: 8` (verified on the live
 * `/app-config.js` 2026-09-03); the `|| 5` fallback in init.tsx is dead there.
 * Nothing in `public/config/` is what ships: the container entrypoint rewrites
 * `app-config.js` from `$APP_CONFIG` on start, so the baked-in file is
 * overwritten before nginx serves it. Live diverges on every cap, not just
 * prefetch — 20 / 10 / 8 against those files' 100 / 75 / 25. Do not reach for
 * `main-prod.js` or `veg-prod.js` as the deployed values either; both open by
 * declaring themselves local-only benchmarking configs not for deploy, and
 * `main-prod.js` still carries a `REPLACE_ME` CloudFront host.
 *
 * THE CLAMP'S REACH ON THIS PATH IS NOT MEASURED. Chromium sends every
 * throttleable timer queue in a hidden page to a 1s wake-up budget pool
 * regardless of nesting, which is what the paragraph above assumes. But a
 * direct probe in Chrome 151 found an ISOLATED `setTimeout(fn, 0)` in a
 * genuinely hidden tab firing in 0-1ms across 25 samples, while a chained timer
 * in the same tab at the same moment clamped to ~1s. Neither experiment is this
 * code path: a saturated pool schedules refills back to back as frames land, and
 * nobody has measured whether the clamp engages under that load. Before
 * defending this change on throughput, run the loaded case — hide the tab, keep
 * ~20 fetches in flight through the refill, and compare completions per second
 * with `grabDelay` 0 against `undefined`.
 *
 * NOT once per minute. Chrome's intensive-throttling bucket needs a chain count
 * of five, meaning a setTimeout scheduled from inside a timer callback's own
 * task. `startAgain()`'s timer is scheduled from `requestResult.finally(...)`, a
 * microtask of the network/worker task that resolved the image load, so the
 * chain never accumulates and the timer stays in the once-per-second bucket. An
 * earlier version of this comment claimed one wake-up per minute and overstated
 * the worst case roughly sixtyfold.
 *
 * SIZE THE WIN HONESTLY. Because a tick refills all free slots, and wake-ups
 * land on 1s boundaries, a cycle lasts `ceil` of the per-frame latency `L` to
 * the next whole second. Hidden throughput is therefore `slots / ceil_1s(L)`,
 * against `slots / L` unthrottled — a ratio of `L / ceil_1s(L)`.
 *
 * NOT `slots × min(1/L, 1)`, which an earlier version of this comment used to
 * conclude the change "does nothing at all" once `L` reaches 1s. The two agree
 * only where `L` is a whole number of seconds. At `L = 1.01s` the throttled pool
 * runs at 8/2 against 8/1.01 — about 51% of full speed, not 100% — so the loss
 * is real through the whole 1-2s band and only decays as `ceil_1s(L)/L` above it.
 * At the fleet p90 near 10s it is about 1%.
 *
 * LABEL THE UNIT ON THE DENOMINATOR. Measured 2026-09-02, n = 2,894 flushes
 * carrying 63,645 frames:
 *
 *   per-frame p50   share of FLUSHES   share of FRAMES
 *   < 125ms                    8.9%             42.5%
 *   125ms - 1s                44.6%             44.4%
 *   >= 1s                     46.5%             13.1%
 *
 * Flushes are dominated by small ones — median 5 frames, mean 22 — so the two
 * columns tell opposite stories, and the frame column is the one that describes
 * bytes a reader waits on. An earlier version of this comment quoted the flush
 * column (as 47.6%) and then reasoned about it as though it were traffic,
 * concluding the benefit is "absent for the slow tail". Weighted by frames the
 * slow bucket is 13.1%, not 46.5%, and 42.5% of frames sit under 125ms where the
 * clamp would bind hardest. Fleet per-frame p50 is 868ms and p90 is 9.9s.
 *
 * So IF the premise above holds, this helps most of the frames actually
 * downloaded. What it does not do is fix the slow tail: a reader at 10s per
 * frame is not waiting on the refill.
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
 * That cost becomes observable once the flush-window telemetry lands: a
 * companion change adds `long_tasks` and `long_task_ms` per flush window to
 * `frame_download_stats`, so a hidden window that used to read as "the browser
 * deferred the work" can instead read as "the main thread was blocked". Same
 * work, relocated — not a new regression. Said here because it will look like
 * one on the dashboard.
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
