// Guards the wiring inside _initPostHogUnsafe against the REAL posthog-js, so
// the SDK behaviour under test (a synchronous `loaded` callback) is the SDK's
// own and not a mock's guess at it.
const KEY = 'phc_test_key_0000000000000000000000';
const HOST = 'http://127.0.0.1:1';

// initPostHog no-ops unless NODE_ENV is production; isProductionBuild() reads it
// at call time, so setting it around the call is enough.
const withEnv = async (overrides, fn) => {
  const prev = {};
  Object.keys(overrides).forEach(k => {
    prev[k] = process.env[k];
    if (overrides[k] === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = overrides[k];
    }
  });
  try {
    return await fn();
  } finally {
    Object.keys(prev).forEach(k => {
      if (prev[k] === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = prev[k];
      }
    });
  }
};

/**
 * Runs a full init in a fresh module registry and returns the recorded calls as
 * [name, properties, appSuperPropertyAtCaptureTime].
 *
 * `register` calls through so get_property() reflects real persistence;
 * `capture` is stubbed, and snapshots `app` at the moment of the call. That
 * snapshot is the actual invariant: whatever the ordering inside `loaded`,
 * viewer_loaded must see app already registered.
 */
const initFresh = ({ visibilityState = 'visible', commitHash } = {}) =>
  withEnv(
    { NODE_ENV: 'production', ...(commitHash === undefined ? {} : { COMMIT_HASH: commitHash }) },
    async () => {
      Object.defineProperty(document, 'visibilityState', {
        value: visibilityState,
        configurable: true,
      });
      const calls = [];
      await jest.isolateModulesAsync(async () => {
        const posthog = (await import('posthog-js')).default;
        const { initPostHog } = await import('./posthog');
        const realRegister = posthog.register.bind(posthog);
        jest.spyOn(posthog, 'register').mockImplementation(p => {
          calls.push(['register', p]);
          return realRegister(p);
        });
        jest
          .spyOn(posthog, 'capture')
          .mockImplementation((n, p) => calls.push([n, p, posthog.get_property('app')]));
        initPostHog({ apiKey: KEY, apiHost: HOST });
      });
      return calls;
    }
  );

const viewerLoaded = calls => calls.find(c => c[0] === 'viewer_loaded');

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

  afterEach(() => jest.restoreAllMocks());

  it('has app=viewer registered by the time viewer_loaded is captured', async () => {
    const calls = await initFresh();
    const event = viewerLoaded(calls);
    expect(event).toBeDefined();
    expect(event[2]).toBe('viewer');
  });

  it('puts build identity on the event itself, not only in super properties', async () => {
    const event = viewerLoaded(await initFresh());
    expect(event[1]).toHaveProperty('build_commit');
    expect(event[1]).toHaveProperty('build_time');
  });

  // webpack.base.js reads commit.txt without trimming, unlike webpack.pwa.js,
  // so /version.json and the bundle would otherwise disagree by a newline.
  it('trims the baked commit hash', async () => {
    const event = viewerLoaded(await initFresh({ commitHash: '  abc123def\n' }));
    expect(event[1].build_commit).toBe('abc123def');
  });

  it('falls back to the local sentinel when no commit is baked in', async () => {
    const event = viewerLoaded(await initFresh({ commitHash: '   ' }));
    expect(event[1].build_commit).toBe('local');
  });

  it('reports hidden_at_load from the visibility state at bundle eval', async () => {
    expect(viewerLoaded(await initFresh({ visibilityState: 'visible' }))[1].hidden_at_load).toBe(
      false
    );
    expect(viewerLoaded(await initFresh({ visibilityState: 'hidden' }))[1].hidden_at_load).toBe(
      true
    );
  });
});
