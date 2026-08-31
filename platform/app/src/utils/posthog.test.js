// Guards the wiring inside _initPostHogUnsafe, using the real posthog-js so the
// synchronous-`loaded` behaviour under test is the SDK's actual behaviour and
// not a mock's guess at it.
const KEY = 'phc_test_key_0000000000000000000000';
const HOST = 'http://127.0.0.1:1';

// initPostHog no-ops unless NODE_ENV is production; isProductionBuild() reads it
// at call time, so setting it here is enough.
const withProdEnv = async fn => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    return await fn();
  } finally {
    process.env.NODE_ENV = prev;
  }
};

// Fresh module registry per case: posthog-js refuses to re-init, and the
// hidden_at_load snapshot is taken once at module eval.
const initFresh = (visibilityState = 'visible') =>
  withProdEnv(async () => {
    Object.defineProperty(document, 'visibilityState', {
      value: visibilityState,
      configurable: true,
    });
    const calls = [];
    await jest.isolateModulesAsync(async () => {
      const posthog = (await import('posthog-js')).default;
      const { initPostHog } = await import('./posthog');
      jest.spyOn(posthog, 'register').mockImplementation(p => calls.push(['register', p]));
      jest.spyOn(posthog, 'capture').mockImplementation((n, p) => calls.push([n, p]));
      initPostHog({ apiKey: KEY, apiHost: HOST });
    });
    return calls;
  });

describe('_initPostHogUnsafe wiring', () => {
  // Regression guard: posthog invokes `loaded` synchronously from inside
  // init(), so registering after init() returns leaves viewer_loaded without
  // `app`. That is invisible for returning users (super property is already in
  // localStorage) and only breaks first visits, so nothing but an ordering
  // assertion catches it.
  it('registers app=viewer before capturing viewer_loaded', async () => {
    const calls = await initFresh();
    // posthog-js registers its own super properties ($initialization_time), so
    // match on ours specifically rather than on the first register call.
    const appRegister = calls.findIndex(c => c[0] === 'register' && c[1] && c[1].app === 'viewer');
    const viewerLoaded = calls.findIndex(c => c[0] === 'viewer_loaded');
    expect(appRegister).toBeGreaterThanOrEqual(0);
    expect(viewerLoaded).toBeGreaterThanOrEqual(0);
    expect(appRegister).toBeLessThan(viewerLoaded);
  });

  it('puts build identity on the event itself, not only in super properties', async () => {
    const calls = await initFresh();
    const props = calls.find(c => c[0] === 'viewer_loaded')[1];
    expect(props).toHaveProperty('build_commit');
    expect(props).toHaveProperty('build_time');
    // No trailing whitespace: commit.txt is read untrimmed by webpack.base.js.
    expect(props.build_commit).toBe(props.build_commit.trim());
  });

  it('reports hidden_at_load from the visibility state at bundle eval', async () => {
    const visible = await initFresh('visible');
    expect(visible.find(c => c[0] === 'viewer_loaded')[1].hidden_at_load).toBe(false);

    const hidden = await initFresh('hidden');
    expect(hidden.find(c => c[0] === 'viewer_loaded')[1].hidden_at_load).toBe(true);
  });
});
