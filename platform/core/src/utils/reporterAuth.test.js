import { afterEach, beforeEach, expect, it, jest } from '@jest/globals';
import { createReporterAuthentication, ReporterAuthenticationError } from './reporterAuth';

const REPORTER = 'https://radimal-reporter.onrender.com';
const VET = 'https://vet.radimal.ai';

function viewer(overrides = {}) {
  const listeners = new Set();
  let request = 0;
  /** @type {any} */
  const win = {
    name: 'viewerWindow',
    location: { origin: 'https://view.radimal.ai', search: '' },
    crypto: { randomUUID: () => `request-${++request}` },
    opener: { postMessage: jest.fn(), closed: false },
    fetch: jest.fn(async () => ({ status: 200, ok: true })),
    open: jest.fn(),
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    addEventListener: (type, listener) => {
      if (type === 'message') listeners.add(listener);
    },
    removeEventListener: (type, listener) => {
      if (type === 'message') listeners.delete(listener);
    },
    emit: event => [...listeners].forEach(listener => listener(event)),
    ...overrides,
  };
  win.parent = win;
  return win;
}

function reply(win, token = 'synthetic-user-token', overrides = {}) {
  const request = win.opener.postMessage.mock.calls.at(-1)[0];
  win.emit({
    source: win.opener,
    origin: VET,
    data: { type: 'RADIMAL_AUTH_RESPONSE', requestId: request.requestId, accessToken: token },
    ...overrides,
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  Object.defineProperty(global, 'Headers', {
    configurable: true,
    value: class {
      constructor(values = {}) {
        this.values = new Map(Object.entries(values).map(([k, v]) => [k.toLowerCase(), v]));
      }
      set(key, value) {
        this.values.set(key.toLowerCase(), value);
      }
      get(key) {
        return this.values.get(key.toLowerCase());
      }
      delete(key) {
        this.values.delete(key.toLowerCase());
      }
    },
  });
});

afterEach(() => {
  jest.useRealTimers();
});

it('adds a user bearer only after a correlated response and refuses cookie/server credentials', async () => {
  const win = viewer();
  const auth = createReporterAuthentication(win);
  const done = auth.fetch(
    `${REPORTER}/case/1.2.3`,
    { headers: { 'X-Radimal-Key': 'not-for-browser' } },
    REPORTER
  );
  expect(win.fetch).not.toHaveBeenCalled();
  expect(win.opener.postMessage).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'RADIMAL_AUTH_REQUEST' }),
    VET
  );
  reply(win);
  await done;
  const options = win.fetch.mock.calls[0][1];
  expect(options.headers.get('Authorization')).toBe('Bearer synthetic-user-token');
  expect(options.headers.get('X-Radimal-Key')).toBeUndefined();
  expect(options.credentials).toBe('omit');
  expect(options.redirect).toBe('error');
});

it.each(['', '_blank', 'secondary-1794438300000'])(
  'authenticates a Vet opener without requiring a specific window name: %s',
  async name => {
    const win = viewer({ name });
    const auth = createReporterAuthentication(win);
    const done = auth.getAccessToken();
    expect(win.opener.postMessage).toHaveBeenCalledWith(
      { type: 'RADIMAL_AUTH_REQUEST', requestId: 'request-1' },
      VET
    );
    reply(win);
    await expect(done).resolves.toBe('synthetic-user-token');
    expect(win.open).not.toHaveBeenCalled();
  }
);

it.each(['viewerWindow', '', 'secondary-1794438300000'])(
  'ignores a forged origin, source and request id for window name %s',
  async name => {
    const win = viewer({ name });
    const auth = createReporterAuthentication(win);
    const done = auth.fetch(`${REPORTER}/case/1.2.3`, {}, REPORTER);
    reply(win, 'bad', { origin: 'https://attacker.test' });
    reply(win, 'bad', { source: {} });
    reply(win, 'bad', {
      data: { type: 'RADIMAL_AUTH_RESPONSE', requestId: 'other', accessToken: 'bad' },
    });
    await Promise.resolve();
    expect(win.fetch).not.toHaveBeenCalled();
    reply(win, 'correct');
    await done;
    expect(win.fetch.mock.calls[0][1].headers.get('Authorization')).toBe('Bearer correct');
  }
);

it('never sends a bearer or private request when an untrusted opener cannot authenticate', async () => {
  const win = viewer({ name: '' });
  const auth = createReporterAuthentication(win);
  const done = auth.fetch(`${REPORTER}/case/1.2.3`, {}, REPORTER);
  const rejected = expect(done).rejects.toBeInstanceOf(ReporterAuthenticationError);
  reply(win, 'forged-token', { origin: 'https://attacker.test' });
  jest.advanceTimersByTime(15000);
  await rejected;
  expect(win.fetch).not.toHaveBeenCalled();
  expect(win.opener.postMessage).toHaveBeenCalledTimes(1);
  expect(win.opener.postMessage).toHaveBeenCalledWith(
    { type: 'RADIMAL_AUTH_REQUEST', requestId: 'request-1' },
    VET
  );
});

it('keeps a monitor token request bound to its Viewer opener origin', async () => {
  const win = viewer({ name: 'viewerWindow-2' });
  const auth = createReporterAuthentication(win);
  const done = auth.getAccessToken();
  expect(win.opener.postMessage).toHaveBeenCalledWith(
    { type: 'RADIMAL_AUTH_REQUEST', requestId: 'request-1' },
    win.location.origin
  );
  reply(win, 'wrong-vet-origin');
  reply(win, 'monitor-token', { origin: win.location.origin });
  await expect(done).resolves.toBe('monitor-token');
});

it('keeps an embedded Viewer token request bound to its parent window', async () => {
  const win = viewer({ name: '', opener: null });
  const parent = { postMessage: jest.fn(), closed: false };
  win.parent = parent;
  const auth = createReporterAuthentication(win);
  const done = auth.getAccessToken();
  expect(parent.postMessage).toHaveBeenCalledWith(
    { type: 'RADIMAL_AUTH_REQUEST', requestId: 'request-1' },
    VET
  );
  win.emit({
    source: parent,
    origin: VET,
    data: { type: 'RADIMAL_AUTH_RESPONSE', requestId: 'request-1', accessToken: 'parent-token' },
  });
  await expect(done).resolves.toBe('parent-token');
});

it('deduplicates simultaneous requests but asks the owner again for later calls', async () => {
  const win = viewer();
  const auth = createReporterAuthentication(win);
  const first = auth.fetch(`${REPORTER}/case/a`, {}, REPORTER);
  const second = auth.fetch(`${REPORTER}/case/b`, {}, REPORTER);
  expect(win.opener.postMessage).toHaveBeenCalledTimes(1);
  reply(win, 'first');
  await Promise.all([first, second]);
  const third = auth.fetch(`${REPORTER}/case/c`, {}, REPORTER);
  expect(win.opener.postMessage).toHaveBeenCalledTimes(2);
  reply(win, 'refreshed');
  await third;
  expect(win.fetch.mock.calls[2][1].headers.get('Authorization')).toBe('Bearer refreshed');
});

it('does not send any private request without credentials or reuse a DICOM URL token', async () => {
  const win = viewer({
    name: '',
    opener: null,
    location: { origin: 'https://view.radimal.ai', search: '?token=dicom-only' },
  });
  const auth = createReporterAuthentication(win);
  await expect(auth.fetch(`${REPORTER}/case/a`, {}, REPORTER)).rejects.toBeInstanceOf(
    ReporterAuthenticationError
  );
  expect(win.fetch).not.toHaveBeenCalled();
  expect(win.open).not.toHaveBeenCalled();
});

it('requests green public-alias credentials from staging Vet', async () => {
  const win = viewer({ location: { origin: 'https://green-view-stage-2.radimal.ai', search: '' } });
  const auth = createReporterAuthentication(win);
  const done = auth.getAccessToken();
  expect(win.opener.postMessage).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'RADIMAL_AUTH_REQUEST' }),
    'https://radimal-vet-staging.onrender.com'
  );
  reply(win, 'synthetic-stage-token', { origin: 'https://radimal-vet-staging.onrender.com' });
  await expect(done).resolves.toBe('synthetic-stage-token');
});

it('rejects another destination before even requesting a bearer', async () => {
  const win = viewer();
  const auth = createReporterAuthentication(win);
  await expect(auth.fetch('https://attacker.test/collect', {}, REPORTER)).rejects.toThrow(
    /configured Reporter/
  );
  expect(win.opener.postMessage).not.toHaveBeenCalled();
  expect(win.fetch).not.toHaveBeenCalled();
});

it('fails closed on a missing token and timeout', async () => {
  const win = viewer();
  const auth = createReporterAuthentication(win);
  const missing = auth.fetch(`${REPORTER}/case/a`, {}, REPORTER);
  reply(win, undefined, { data: { type: 'RADIMAL_AUTH_RESPONSE', requestId: 'request-1' } });
  await expect(missing).rejects.toBeInstanceOf(ReporterAuthenticationError);
  const timeout = auth.fetch(`${REPORTER}/case/a`, {}, REPORTER);
  const rejected = expect(timeout).rejects.toBeInstanceOf(ReporterAuthenticationError);
  jest.advanceTimersByTime(15000);
  await rejected;
  expect(win.fetch).not.toHaveBeenCalled();
});

it('relays only an explicitly opened same-origin child window', async () => {
  const win = viewer();
  const auth = createReporterAuthentication(win);
  const child = { closed: false, postMessage: jest.fn() };
  auth.registerChild(child);
  const request = { type: 'RADIMAL_AUTH_REQUEST', requestId: 'child-request' };
  win.emit({ source: {}, origin: win.location.origin, data: request });
  win.emit({ source: child, origin: 'https://attacker.test', data: request });
  expect(win.opener.postMessage).not.toHaveBeenCalled();
  win.emit({ source: child, origin: win.location.origin, data: request });
  const pending = auth.getAccessToken();
  reply(win);
  await pending;
  expect(child.postMessage).toHaveBeenCalledWith(
    {
      type: 'RADIMAL_AUTH_RESPONSE',
      requestId: 'child-request',
      accessToken: 'synthetic-user-token',
    },
    win.location.origin
  );
});

it('opens standalone sign-in only explicitly and binds the response to that popup', async () => {
  const win = viewer({ name: '', opener: null });
  const popup = { closed: false, close: jest.fn() };
  win.open.mockReturnValue(popup);
  const auth = createReporterAuthentication(win);
  const done = auth.signIn();
  const authUrl = new URL(win.open.mock.calls[0][0]);
  expect(authUrl.origin).toBe(VET);
  expect(authUrl.pathname).toBe('/viewer-auth');
  expect(authUrl.searchParams.get('origin')).toBe(win.location.origin);
  const data = {
    type: 'RADIMAL_AUTH_RESPONSE',
    requestId: authUrl.searchParams.get('requestId'),
    accessToken: 'standalone-token',
  };
  win.emit({ source: {}, origin: VET, data });
  expect(win.fetch).not.toHaveBeenCalled();
  win.emit({ source: popup, origin: VET, data });
  await done;
  await auth.fetch(`${REPORTER}/case/a`, {}, REPORTER);
  expect(win.fetch.mock.calls[0][1].headers.get('Authorization')).toBe('Bearer standalone-token');
  win.fetch.mockResolvedValueOnce({ status: 401 });
  await expect(auth.fetch(`${REPORTER}/case/a`, {}, REPORTER)).rejects.toBeInstanceOf(
    ReporterAuthenticationError
  );
  await expect(auth.fetch(`${REPORTER}/case/a`, {}, REPORTER)).rejects.toBeInstanceOf(
    ReporterAuthenticationError
  );
});

it('reuses the standalone sign-in popup as the report tab without opening a second popup', async () => {
  const win = viewer({ name: '', opener: null });
  const popup = { closed: false, close: jest.fn(), location: {} };
  win.open.mockReturnValue(popup);
  const auth = createReporterAuthentication(win);
  const done = auth.signIn('report');
  const requestId = new URL(win.open.mock.calls[0][0]).searchParams.get('requestId');
  win.emit({
    source: popup,
    origin: VET,
    data: { type: 'RADIMAL_AUTH_RESPONSE', requestId, accessToken: 'token' },
  });
  await done;
  expect(popup.close).not.toHaveBeenCalled();
  auth.openReport(`${VET}/consultation/?url=authorized-report`);
  expect(popup.location.href).toBe(`${VET}/consultation/?url=authorized-report`);
  expect(win.open).toHaveBeenCalledTimes(1);
});
