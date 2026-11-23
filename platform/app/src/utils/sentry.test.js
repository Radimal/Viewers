const mockInit = jest.fn();
jest.mock('@sentry/react', () => ({ init: mockInit }));

const loadWithCommit = commit => {
  process.env.COMMIT_HASH = commit;
  jest.isolateModules(() => require('./sentry'));
  return mockInit.mock.calls.at(-1)[0];
};

afterEach(() => {
  delete process.env.COMMIT_HASH;
});

describe('sentry init', () => {
  it('is off for local builds', () => {
    expect(loadWithCommit('local').enabled).toBe(false);
  });

  it('drops the global handlers so boundary-reported errors are not sent twice', () => {
    const options = loadWithCommit('abc123');
    const kept = options.integrations([{ name: 'GlobalHandlers' }, { name: 'Breadcrumbs' }]);
    expect(kept).toEqual([{ name: 'Breadcrumbs' }]);
    expect(options.release).toBe('abc123');
  });
});
