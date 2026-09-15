/**
 * Radimal: teardown holder for effects whose cleanup functions arrive
 * asynchronously (Mode.tsx gets its route unsubscriptions from a promise).
 *
 * The race this closes: React can run the effect's cleanup BEFORE the promise
 * resolves — a reader opening the next study before the current one finishes
 * loading. A plain `let unsubscriptions` is still undefined at that point, so
 * nothing is cancelled and the resolved teardowns (the live study poll above
 * all) keep running forever. With this holder, arming after disposal fires
 * the teardowns immediately.
 */
export function createDeferredTeardown() {
  let disposed = false;
  let teardowns: Array<() => void> | null = null;

  const run = () => {
    const fns = teardowns;
    teardowns = null;
    fns?.forEach(fn => {
      try {
        fn();
      } catch (e) {
        console.error('teardown failed', e);
      }
    });
  };

  return {
    /** Hand over the teardown functions; runs them at once if already disposed. */
    arm(fns: Array<() => void>) {
      teardowns = fns;
      if (disposed) {
        run();
      }
    },
    /** Mark disposed and run anything already armed. */
    dispose() {
      disposed = true;
      run();
    },
    get isDisposed() {
      return disposed;
    },
  };
}
