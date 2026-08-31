// Guards the wiring inside _initPostHogUnsafe against the REAL posthog-js, so
// the SDK behaviour under test (a synchronous `loaded` callback) is the SDK's
// own and not a mock's guess at it.
const KEY = 'phc_test_key_0000000000000000000000';
const HOST = 'http://127.0.0.1:1';

const setVisibility = state => {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
};

// initPostHog no-ops unless NODE_ENV is production; isProductionBuild() reads it
// at call time, so setting it around the call is enough. COMMIT_HASH/BUILD_TIME
// are DefinePlugin substitutions in a real build and simply absent under jest,
// so the tests that care about them inject values here.
const withEnv = async (overrides, fn) => {
  const prev = {};
  const apply = (k, v) => (v === undefined ? delete process.env[k] : (process.env[k] = v));
  Object.keys(overrides).forEach(k => {
    prev[k] = process.env[k];
    apply(k, overrides[k]);
  });
  try {
    return await fn();
  } finally {
    Object.keys(prev).forEach(k => apply(k, prev[k]));
  }
};

/**
 * Runs a full init in a fresh module registry.
 *
 * Returns the module under test plus the recorded calls as
 * [name, properties, appSuperPropertyAtCaptureTime]. `register` calls through so
 * get_property() reflects real persistence; `capture` is stubbed and snapshots
 * `app` at the moment of the call, which is the actual invariant — whatever the
 * ordering inside `loaded`, viewer_loaded must see app already registered.
 *
 * `hideAfterEval` backgrounds the tab AFTER module eval but BEFORE init, which
 * is what separates a bundle-eval snapshot from a read at capture time.
 */
const initFresh = ({
  visibilityState = 'visible',
  commitHash,
  hideAfterEval = false,
  visibleAgainBeforeInit = false,
} = {}) =>
  withEnv(
    { NODE_ENV: 'production', ...(commitHash === undefined ? {} : { COMMIT_HASH: commitHash }) },
    async () => {
      Object.defineProperty(document, 'visibilityState', {
        value: visibilityState,
        configurable: true,
      });
      const calls = [];
      let mod;
      await jest.isolateModulesAsync(async () => {
        const posthog = (await import('posthog-js')).default;
        mod = await import('./posthog');
        // discarded instances from earlier cases, whose visibilitychange
        // listeners are still attached to the shared jsdom document, and they
        // would then reach the real posthog.capture during later tests.
        const realRegister = posthog.register.bind(posthog);
        posthog.register = p => {
          calls.push(['register', p]);
          return realRegister(p);
        };
        posthog.capture = (n, p) => calls.push([n, p, posthog.get_property('app')]);
        if (hideAfterEval) {
          setVisibility('hidden');
          if (visibleAgainBeforeInit) {
            setVisibility('visible');
          }
        }
        mod.initPostHog({ apiKey: KEY, apiHost: HOST });
      });
      return { calls, mod };
    }
  );

const viewerLoaded = ({ calls }) => calls.find(c => c[0] === 'viewer_loaded');

describe('_initPostHogUnsafe wiring', () => {
  // Every case must look like a FIRST visit. posthog persists super properties
  // in localStorage + cookies, which jsdom shares across the whole file, so
  // without this a later case inherits an earlier one's `app` and an ordering
  // regression passes unnoticed — the exact way the real bug hid in production.
  beforeEach(() => {
    localStorage.clear();
    document.cookie.split(';').forEach(c => {
      document.cookie = `${c.split('=')[0].trim()}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
    });
  });

  afterEach(() => {
    // jsdom's document is shared file-wide; don't leave it hidden for whatever
    // test gets appended after this suite.
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });

  it('has app=viewer registered by the time viewer_loaded is captured', async () => {
    const event = viewerLoaded(await initFresh());
    expect(event).toBeDefined();
    expect(event[2]).toBe('viewer');
  });

  it('attaches build identity to every event through the shared helper', async () => {
    const { mod, calls } = await initFresh({ commitHash: 'abc123def' });
    mod.capturePostHogEvent('some_extension_event', { unrelated: 1 });
    const event = calls.find(c => c[0] === 'some_extension_event');
    expect(event[1]).toEqual({
      build_commit: 'abc123def',
      build_time: null,
      unrelated: 1,
    });
  });

  // webpack.base.js reads commit.txt without trimming, unlike webpack.pwa.js,
  // so /version.json and the bundle would otherwise disagree by a newline.
  it('trims the baked commit hash', async () => {
    const event = viewerLoaded(await initFresh({ commitHash: '  abc123def\n' }));
    expect(event[1].build_commit).toBe('abc123def');
  });

  it.each(['', '   ', 'local', 'dev'])(
    'collapses the non-deploy commit %p into one bucket',
    async commitHash => {
      const event = viewerLoaded(await initFresh({ commitHash }));
      expect(event[1].build_commit).toBe('local');
    }
  );

  it('reports hidden_at_boot from the visibility state at bundle eval', async () => {
    expect(viewerLoaded(await initFresh({ visibilityState: 'visible' }))[1].hidden_at_boot).toBe(
      false
    );
    expect(viewerLoaded(await initFresh({ visibilityState: 'hidden' }))[1].hidden_at_boot).toBe(
      true
    );
  });

  // Distinguishes the snapshot from a read at capture time and from a latch:
  // both of those would report true here.
  it('does not flag a tab backgrounded after bundle eval', async () => {
    const event = viewerLoaded(
      await initFresh({ visibilityState: 'visible', hideAfterEval: true })
    );
    expect(event[1].hidden_at_boot).toBe(false);
  });

  describe('viewer_hidden', () => {
    const hiddenEvents = calls => calls.filter(c => c[0] === 'viewer_hidden');

    it('fires once when the tab is first backgrounded, with ms_since_navigation_start', async () => {
      const { calls } = await initFresh();
      setVisibility('hidden');
      const events = hiddenEvents(calls);
      expect(events).toHaveLength(1);
      // Strictly greater than zero: >= 0 also passes for a hardcoded 0 or a
      // never-assigned counter, which is the realistic regression here.
      expect(events[0][1].ms_since_navigation_start).toBeGreaterThan(0);
      // Routed through the shared helper, so build identity rides along.
      expect(events[0][1]).toHaveProperty('build_commit');
    });

    it('does not fire when the tab merely becomes visible', async () => {
      const { calls } = await initFresh();
      setVisibility('visible');
      expect(hiddenEvents(calls)).toHaveLength(0);
    });

    // The listener is armed at module eval but PostHog is not ready until the
    // App.tsx mount effect. A hide in that gap must not consume the one shot,
    // or the session reads foreground on hidden_at_boot AND viewer_hidden.
    // The listener is armed at module eval but PostHog is not ready until the
    // App.tsx mount effect. visibilitychange fires only on transitions, so a
    // reader who backgrounds in that gap and never comes back would otherwise
    // emit nothing at all — reading foreground on hidden_at_boot AND on
    // viewer_hidden. init re-reads live visibility to recover it.
    it('recovers a tab hidden before PostHog was ready, with no second transition', async () => {
      const { calls } = await initFresh({ hideAfterEval: true });
      expect(hiddenEvents(calls)).toHaveLength(1);
    });

    // Pins the isReady() check to its remaining job. If it were dropped, this
    // pre-init hide would unsubscribe the listener while the event itself was
    // still being no-ope'd, and the reader's real backgrounding later in the
    // session would go unrecorded.
    it('stays armed when a pre-init hide ended before PostHog was ready', async () => {
      const { calls } = await initFresh({ hideAfterEval: true, visibleAgainBeforeInit: true });
      expect(hiddenEvents(calls)).toHaveLength(0);
      setVisibility('hidden');
      expect(hiddenEvents(calls)).toHaveLength(1);
    });

    it('does not double-fire when that tab is later backgrounded again', async () => {
      const { calls } = await initFresh({ hideAfterEval: true });
      setVisibility('visible');
      setVisibility('hidden');
      expect(hiddenEvents(calls)).toHaveLength(1);
    });

    // A viewer left open all day would otherwise emit one of these per tab
    // switch; only the first backgrounding answers the never-render query.
    it('does not fire again on later backgroundings', async () => {
      const { calls } = await initFresh();
      setVisibility('hidden');
      setVisibility('visible');
      setVisibility('hidden');
      expect(hiddenEvents(calls)).toHaveLength(1);
    });
  });
});
