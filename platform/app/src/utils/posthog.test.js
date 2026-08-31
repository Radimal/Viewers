// posthog-js is mocked so importing this module doesn't pull the real SDK into
// jsdom. Only the module-scope visibility latch is under test here.
jest.mock('posthog-js', () => ({
  default: { init: () => {}, register: () => {}, capture: () => {} },
  __esModule: true,
}));

describe('hidden_at_load latch', () => {
  const setVisibility = state => {
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  };

  // The latch is module state, so each case needs a fresh module registry to
  // control what visibilityState was at import (= page load) time.
  const loadWith = async state => {
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
    let mod;
    await jest.isolateModulesAsync(async () => {
      mod = await import('./posthog');
    });
    return mod;
  };

  it('is false for a tab that loaded visible and stayed visible', async () => {
    const { wasHiddenBeforeLoad } = await loadWith('visible');
    expect(wasHiddenBeforeLoad()).toBe(false);
  });

  it('is true for a tab that was already hidden at load', async () => {
    const { wasHiddenBeforeLoad } = await loadWith('hidden');
    expect(wasHiddenBeforeLoad()).toBe(true);
  });

  // The regression this guards: reading visibilityState inside posthog's async
  // `loaded` callback would report 'visible' here and lose the sample.
  it('stays true after a tab hidden at load is focused before viewer_loaded', async () => {
    const { wasHiddenBeforeLoad } = await loadWith('hidden');
    setVisibility('visible');
    expect(wasHiddenBeforeLoad()).toBe(true);
  });

  it('latches true when a visible tab is backgrounded before viewer_loaded', async () => {
    const { wasHiddenBeforeLoad } = await loadWith('visible');
    setVisibility('hidden');
    expect(wasHiddenBeforeLoad()).toBe(true);
  });
});
