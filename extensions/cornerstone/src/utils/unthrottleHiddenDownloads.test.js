import unthrottleHiddenDownloads from './unthrottleHiddenDownloads';

/**
 * jsdom's document.visibilityState is a read-only getter, so it is redefined
 * per test rather than assigned. Each test starts from a fresh pair of pool
 * stand-ins carrying the upstream default (`grabDelay = 0`), so an assertion
 * that a pool ends up at 0 is only meaningful alongside one that it reached
 * `undefined` first.
 */
function setVisibility(state) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
}

function newPools() {
  return [{ grabDelay: 0 }, { grabDelay: 0 }];
}

describe('unthrottleHiddenDownloads', () => {
  let listeners;
  let addEventListener;

  beforeEach(() => {
    listeners = [];
    addEventListener = document.addEventListener;
    document.addEventListener = (type, fn) => {
      if (type === 'visibilitychange') {
        listeners.push(fn);
      }
    };
    setVisibility('visible');
  });

  afterEach(() => {
    document.addEventListener = addEventListener;
    setVisibility('visible');
  });

  const fireVisibilityChange = () => listeners.forEach(fn => fn());

  it('clears grabDelay on every pool when the tab is hidden', () => {
    const pools = newPools();
    unthrottleHiddenDownloads(pools);

    setVisibility('hidden');
    fireVisibilityChange();

    // undefined, not 0: startAgain() branches on `grabDelay !== undefined`, so
    // 0 still schedules a setTimeout and still gets throttled.
    expect(pools.map(p => p.grabDelay)).toEqual([undefined, undefined]);
  });

  it('restores the timer-backed refill when the tab comes back', () => {
    const pools = newPools();
    unthrottleHiddenDownloads(pools);

    setVisibility('hidden');
    fireVisibilityChange();
    setVisibility('visible');
    fireVisibilityChange();

    expect(pools.map(p => p.grabDelay)).toEqual([0, 0]);
  });

  it('applies immediately to a tab that booted hidden and fires no transition', () => {
    setVisibility('hidden');
    const pools = newPools();

    unthrottleHiddenDownloads(pools);

    // No visibilitychange dispatched: a background-opened tab never fires one,
    // and that is the case this exists to fix.
    expect(pools.map(p => p.grabDelay)).toEqual([undefined, undefined]);
  });

  it('registers a visibilitychange listener', () => {
    unthrottleHiddenDownloads(newPools());

    expect(listeners).toHaveLength(1);
  });
});
