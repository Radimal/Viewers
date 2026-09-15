import { createDeferredTeardown } from './deferredTeardown';

describe('createDeferredTeardown', () => {
  it('runs teardowns on dispose after arming (normal unmount)', () => {
    const holder = createDeferredTeardown();
    const unsub = jest.fn();
    holder.arm([unsub]);
    expect(unsub).not.toHaveBeenCalled();
    holder.dispose();
    expect(unsub).toHaveBeenCalledTimes(1);
  });

  // The bug that froze readers: cleanup ran before setupRouteInit resolved,
  // so the poll's stop function was returned to nobody.
  it('runs teardowns immediately when armed AFTER dispose (unmount-before-resolve)', () => {
    const holder = createDeferredTeardown();
    holder.dispose();
    const unsub = jest.fn();
    holder.arm([unsub]);
    expect(unsub).toHaveBeenCalledTimes(1);
  });

  it('never runs a teardown twice', () => {
    const holder = createDeferredTeardown();
    const unsub = jest.fn();
    holder.arm([unsub]);
    holder.dispose();
    holder.dispose();
    expect(unsub).toHaveBeenCalledTimes(1);
  });

  it('a throwing teardown does not stop the rest', () => {
    const holder = createDeferredTeardown();
    const bad = jest.fn(() => {
      throw new Error('boom');
    });
    const good = jest.fn();
    holder.arm([bad, good]);
    holder.dispose();
    expect(good).toHaveBeenCalledTimes(1);
  });
});
