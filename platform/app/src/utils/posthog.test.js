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
// performance.now() readings driven by the tests below, so
// ms_since_navigation_start can be asserted as a value rather than a range.
const HIDE_AT_MS = 4321;
const ACTIVATE_AT_MS = 8765;

const initFresh = ({
  visibilityState = 'visible',
  commitHash,
  buildTime,
  hideAfterEval = false,
  visibleAgainBeforeInit = false,
  prerendering = false,
  activateIntoBackground = false,
} = {}) =>
  withEnv(
    {
      NODE_ENV: 'production',
      ...(commitHash === undefined ? {} : { COMMIT_HASH: commitHash }),
      ...(buildTime === undefined ? {} : { BUILD_TIME: buildTime }),
    },
    async () => {
      Object.defineProperty(document, 'visibilityState', {
        value: visibilityState,
        configurable: true,
      });
      if (prerendering) {
        Object.defineProperty(document, 'prerendering', { value: true, configurable: true });
      } else {
        delete document.prerendering;
      }
      const calls = [];
      let mod;
      await jest.isolateModulesAsync(async () => {
        const posthog = (await import('posthog-js')).default;
        mod = await import('./posthog');
        // Plain assignment rather than jest.spyOn: restoreAllMocks would re-arm
        // the discarded instances from earlier cases, whose visibilitychange
        // listeners are still attached to the shared jsdom document, and they
        // would then reach the REAL posthog.capture — XHRs and retry timers
        // inside unrelated tests. With nothing to restore they stay stubbed and
        // push into their own orphaned calls array, which is harmless.
        const realRegister = posthog.register.bind(posthog);
        posthog.register = p => {
          calls.push(['register', p]);
          return realRegister(p);
        };
        posthog.capture = (n, p) => calls.push([n, p, posthog.get_property('app')]);
        if (hideAfterEval) {
          // Clock pinned so the latched timestamp is an exact value downstream.
          // Left live, the only thing a test can say about it is a range, and a
          // range survives a hardcoded constant, a halved reading and a fixed
          // offset — none of which the pre-init latch may do, since it is the
          // sole discriminator between a throttled background tab and a reader
          // who gave up.
          const realNow = performance.now.bind(performance);
          performance.now = () => HIDE_AT_MS;
          try {
            setVisibility('hidden');
          } finally {
            performance.now = realNow;
          }
        }

        // Independent of hideAfterEval, so it also composes with
        // visibilityState: 'hidden' — a tab hidden from navigation start that
        // the reader returns to before the App.tsx mount effect.
        if (visibleAgainBeforeInit) {
          setVisibility('visible');
        }
        mod.initPostHog({ apiKey: KEY, apiHost: HOST });
        // AFTER init, deliberately. Fired before it, the flush at the end of
        // posthog's `loaded` re-reads visibility and catches the tab anyway, so
        // the assertion would pass with no listener registered at all — it would
        // pin the flush, not the listener under test.
        if (activateIntoBackground) {
          Object.defineProperty(document, 'prerendering', {
            value: false,
            configurable: true,
          });
          const realNow = performance.now.bind(performance);
          performance.now = () => ACTIVATE_AT_MS;
          try {
            document.dispatchEvent(new Event('prerenderingchange'));
          } finally {
            performance.now = realNow;
          }
        }
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
    delete document.prerendering;
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
  it('reports the baked build time when one is present', async () => {
    const event = viewerLoaded(await initFresh({ buildTime: '2026-08-31T12:00:00Z' }));
    expect(event[1].build_time).toBe('2026-08-31T12:00:00Z');
  });

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

  it('does not treat a prerendering page as a backgrounded tab', async () => {
    // A prerendering page reports visibilityState 'hidden' for the whole
    // prerender while rendering normally, so the bare visibilityState read puts
    // a page the reader activates and views instantly into the boot-hidden
    // cohort — the cohort these two signals exist to size.
    const result = await initFresh({ visibilityState: 'hidden', prerendering: true });
    expect(viewerLoaded(result)[1].hidden_at_boot).toBe(false);
    expect(result.calls.filter(c => c[0] === 'viewer_hidden')).toHaveLength(0);
  });

  it('still catches a prerender activated into a background tab', async () => {
    // hidden -> hidden fires no visibilitychange, so without the
    // prerenderingchange listener the guard above converts the old false
    // positive into a false negative: a genuinely backgrounded tab recorded as
    // never hidden, which is the cohort viewer_hidden exists to size.
    const { calls } = await initFresh({
      visibilityState: 'hidden',
      prerendering: true,
      activateIntoBackground: true,
    });
    const hidden = calls.filter(c => c[0] === 'viewer_hidden');
    expect(hidden).toHaveLength(1);
    // Not `>= 0`: that is the assertion round 6 recorded as unfalsifiable, and
    // re-adding it here was a regression. The activation runs after init, so
    // the latch reads the live clock.
    expect(hidden[0][1].ms_since_navigation_start).toBe(ACTIVATE_AT_MS);
    // Still not a boot-hidden tab: it was prerendering when the bundle ran.
    expect(viewerLoaded({ calls })[1].hidden_at_boot).toBe(false);
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
      const realNow = performance.now.bind(performance);
      performance.now = () => HIDE_AT_MS;
      try {
        setVisibility('hidden');
      } finally {
        performance.now = realNow;
      }
      const events = hiddenEvents(calls);
      expect(events).toHaveLength(1);
      // Asserted EXACTLY against a driven clock. A range does not pin this: a
      // hardcoded constant, a halved reading and a fixed offset all sit inside
      // any plausible band, and this value is the sole discriminator between
      // "throttled background tab" and "reader gave up" -- so a halved reading
      // silently moves sessions across whatever threshold the analysis picks.
      // Same defect class as first_image_rendered's ms, pinned the same way.
      expect(events[0][1].ms_since_navigation_start).toBe(HIDE_AT_MS);
      // Routed through the shared helper, so build identity rides along.
      expect(events[0][1]).toHaveProperty('build_commit');
      // app is a super property; if this event were emitted before register,
      // every dashboard filtering app = viewer would silently drop it — and it
      // would drop it for the background-tab cohort specifically.
      expect(events[0][2]).toBe('viewer');
    });

    it('does not re-emit on a prerenderingchange after the hide already fired', async () => {
      // captureFirstHide unsubscribes from visibilitychange but NOT from
      // prerenderingchange, so the hideReported flag -- not the unsubscribe --
      // is what makes this one-shot. Without the flag this fires twice.
      const { calls } = await initFresh({ hideAfterEval: true });
      expect(hiddenEvents(calls)).toHaveLength(1);

      Object.defineProperty(document, 'prerendering', { value: false, configurable: true });
      document.dispatchEvent(new Event('prerenderingchange'));

      expect(hiddenEvents(calls)).toHaveLength(1);
    });

    it('does not fire when the tab merely becomes visible', async () => {
      const { calls } = await initFresh();
      setVisibility('visible');
      expect(hiddenEvents(calls)).toHaveLength(0);
    });

    // The listener is armed at module eval but PostHog is not ready until the
    // App.tsx mount effect. visibilitychange fires only on transitions, so a
    // reader who backgrounds in that gap and never comes back would otherwise
    // emit nothing at all — reading foreground on hidden_at_boot AND on
    // viewer_hidden. init re-reads live visibility to recover it.
    it('recovers a tab hidden before PostHog was ready, with no second transition', async () => {
      const { calls } = await initFresh({ hideAfterEval: true });
      expect(hiddenEvents(calls)).toHaveLength(1);
    });

    // The blind spot this closes: a reader who backgrounds during bundle
    // download and returns before the App.tsx mount effect. The listener cannot
    // report it (PostHog is not loaded) and visibilitychange never fires again
    // for that hide, so before the latch this session read foreground on
    // hidden_at_boot, on viewer_hidden, and on hidden_during_load — while
    // having been throttled through the longest stretch of the load.
    it('reports a pre-init hide that ended before PostHog was ready', async () => {
      const { calls } = await initFresh({ hideAfterEval: true, visibleAgainBeforeInit: true });
      const events = hiddenEvents(calls);
      expect(events).toHaveLength(1);
      // The latched timestamp, not the time of the flush at init. Exact, not a
      // range: the flush happens later than HIDE_AT_MS on any live clock, so a
      // range wide enough to admit both cannot tell them apart.
      expect(events[0][1].ms_since_navigation_start).toBe(HIDE_AT_MS);
    });

    // A ctrl-clicked / "open in background tab" case link is hidden from
    // navigation start and fires NO visibilitychange, so the only latch left is
    // the flush at init — which would stamp bundle-eval + mount time. In a
    // throttled background tab that is the inflated number this event exists to
    // explain, so the analysis query ("early hide = throttled, late hide = the
    // reader gave up") would file the most-throttled sessions under "gave up".
    // Seeded from HIDDEN_AT_BOOT instead: hidden since navigation start is 0.
    it('stamps a tab hidden from navigation start at 0, not at init time', async () => {
      const { calls } = await initFresh({ visibilityState: 'hidden' });
      const events = hiddenEvents(calls);
      expect(events).toHaveLength(1);
      expect(events[0][1].ms_since_navigation_start).toBe(0);
      // The FLUSH path's own ordering guard. The assertion above on the
      // listener path cannot cover this one: there `register` ran long before.
      // Here the flush is a sibling statement of `register` inside `loaded`, so
      // moving it above `register` silently drops `app` from every viewer_hidden
      // in the boot-hidden cohort — exactly the cohort this event measures —
      // and every dashboard filtering app = viewer loses them. Verified to
      // survive the whole suite without this line.
      expect(events[0][2]).toBe('viewer');
    });

    // Same root cause, second symptom: the first transition is hidden→visible,
    // so the live-visibility latch never fires and the flush at init sees
    // 'visible'. Without the seed this session emits no viewer_hidden at all,
    // and the session-level anti-join reads it as never hidden.
    it('reports a tab hidden at boot that came back before PostHog was ready', async () => {
      const { calls } = await initFresh({
        visibilityState: 'hidden',
        visibleAgainBeforeInit: true,
      });
      const events = hiddenEvents(calls);
      expect(events).toHaveLength(1);
      expect(events[0][1].ms_since_navigation_start).toBe(0);
    });

    it('does not report that hide a second time when the reader backgrounds again', async () => {
      const { calls } = await initFresh({ hideAfterEval: true, visibleAgainBeforeInit: true });
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
