/**
 * @jest-environment-options {"url": "https://viewer.example"}
 */
const mockInit = jest.fn();
jest.mock('@sentry/react', () => ({ init: mockInit }));
jest.mock('@ohif/ui-next', () => ({
  isTransportRejection: reason => typeof reason?.status === 'number',
}));

const loadWithCommit = commit => {
  process.env.COMMIT_HASH = commit;
  jest.isolateModules(() => require('./sentry'));
  return mockInit.mock.calls.at(-1)[0];
};

afterEach(() => {
  delete process.env.COMMIT_HASH;
});

describe('sentry init', () => {
  it('is off for local builds and on for deployed ones', () => {
    expect(loadWithCommit('local').enabled).toBe(false);
    const options = loadWithCommit('abc123');
    expect(options.enabled).toBe(true);
    expect(options.release).toBe('abc123');
  });

  it('drops transient image request failures', () => {
    const { beforeSend } = loadWithCommit('abc123');
    const event = { message: 'x' };
    expect(beforeSend(event, { originalException: { status: 504 } })).toBeNull();
    expect(beforeSend(event, { originalException: new Error('boom') })).toBe(event);
  });
});
