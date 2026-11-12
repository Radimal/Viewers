const REQUEST_TYPE = 'RADIMAL_AUTH_REQUEST';
const RESPONSE_TYPE = 'RADIMAL_AUTH_RESPONSE';
const AUTH_TIMEOUT_MS = 15000;
const SIGN_IN_TIMEOUT_MS = 120000;
const RELAY_REGISTRATION = '__radimalReporterAuthChild';

const validToken = token =>
  typeof token === 'string' && token.length > 0 && token.length <= 16384 && !/[\r\n]/.test(token);

export class ReporterAuthenticationError extends Error {
  constructor() {
    super('Sign in to Radimal and reopen this study to view reports or download images.');
    this.name = 'ReporterAuthenticationError';
  }
}

export function vetOriginFor(origin) {
  if (origin === 'http://localhost:3000') return 'http://localhost:8000';
  if (origin.endsWith('.stage-1.radimal.ai') || origin === 'https://green-view-stage-2.radimal.ai')
    return 'https://radimal-vet-staging.onrender.com';
  if (origin.startsWith('https://') && origin.endsWith('.radimal.ai')) {
    return 'https://vet.radimal.ai';
  }
  return undefined;
}

export function createReporterAuthentication(viewerWindow) {
  const children = new Set();
  let pendingToken;
  let pendingSignIn;
  let signedInToken;
  let signedInUntil = 0;
  let reportWindow;
  let parentUnavailable = false;

  Object.defineProperty(viewerWindow, RELAY_REGISTRATION, {
    configurable: true,
    value: child => children.has(child),
  });

  function closeReport() {
    if (reportWindow && !reportWindow.closed) reportWindow.close();
    reportWindow = undefined;
  }

  const parentWindow = () => {
    const source =
      viewerWindow.opener || (viewerWindow.parent !== viewerWindow ? viewerWindow.parent : null);
    return source && !source.closed ? source : null;
  };

  function parentCanRelay(source) {
    if (!/^viewerWindow-\d+$/.test(viewerWindow.name)) return true;
    try {
      return source?.[RELAY_REGISTRATION]?.(viewerWindow) === true;
    } catch {
      return false;
    }
  }

  function getAccessToken() {
    if (signedInToken && Date.now() < signedInUntil) return Promise.resolve(signedInToken);
    if (pendingToken) return pendingToken;
    const source = parentWindow();
    const isMonitor = /^viewerWindow-\d+$/.test(viewerWindow.name);
    const origin = isMonitor
      ? viewerWindow.location.origin
      : vetOriginFor(viewerWindow.location.origin);
    if (!source || source.closed || !origin || !viewerWindow.crypto?.randomUUID) {
      return Promise.reject(new ReporterAuthenticationError());
    }

    const requestId = viewerWindow.crypto.randomUUID();
    pendingToken = new Promise((resolve, reject) => {
      const finish = (token, error) => {
        viewerWindow.clearTimeout(timer);
        viewerWindow.removeEventListener('message', receive);
        parentUnavailable = !!error;
        if (error) reject(error);
        else resolve(token);
      };
      const receive = event => {
        if (
          event.source !== source ||
          event.origin !== origin ||
          event.data?.type !== RESPONSE_TYPE ||
          event.data.requestId !== requestId
        )
          return;
        const token = event.data.accessToken;
        if (!validToken(token)) {
          finish(undefined, new ReporterAuthenticationError());
          return;
        }
        finish(token);
      };
      const timer = viewerWindow.setTimeout(
        () => finish(undefined, new ReporterAuthenticationError()),
        AUTH_TIMEOUT_MS
      );
      viewerWindow.addEventListener('message', receive);
      try {
        source.postMessage({ type: REQUEST_TYPE, requestId }, origin);
      } catch (error) {
        finish(undefined, new ReporterAuthenticationError());
      }
    }).finally(() => {
      pendingToken = undefined;
    });
    return pendingToken;
  }

  function signIn(intent = 'download') {
    const isReport = intent === 'report';
    if (parentWindow() && !parentUnavailable && parentCanRelay(parentWindow())) {
      if (isReport) reportWindow = viewerWindow.open('about:blank', '_blank');
      return getAccessToken().catch(error => {
        closeReport();
        throw error;
      });
    }
    if (signedInToken && Date.now() < signedInUntil) {
      if (isReport) reportWindow = viewerWindow.open('about:blank', '_blank');
      return Promise.resolve(signedInToken);
    }
    if (pendingSignIn) return pendingSignIn;
    const origin = vetOriginFor(viewerWindow.location.origin);
    if (!origin || !viewerWindow.crypto?.randomUUID)
      return Promise.reject(new ReporterAuthenticationError());
    const requestId = viewerWindow.crypto.randomUUID();
    const url = new URL('/viewer-auth', origin);
    url.searchParams.set('origin', viewerWindow.location.origin);
    url.searchParams.set('requestId', requestId);
    const popup = viewerWindow.open(url.toString(), '_blank', 'popup,width=520,height=720');
    if (!popup) return Promise.reject(new ReporterAuthenticationError());
    if (isReport) reportWindow = popup;
    pendingSignIn = new Promise((resolve, reject) => {
      const finish = (token, error) => {
        viewerWindow.clearTimeout(timer);
        viewerWindow.clearInterval(closedTimer);
        viewerWindow.removeEventListener('message', receive);
        if ((!isReport || error) && !popup.closed) popup.close();
        if (error) {
          closeReport();
          reject(error);
        } else {
          signedInToken = token;
          signedInUntil = Date.now() + 30000;
          resolve(token);
        }
      };
      const receive = event => {
        if (
          event.source !== popup ||
          event.origin !== origin ||
          event.data?.type !== RESPONSE_TYPE ||
          event.data.requestId !== requestId
        )
          return;
        if (!validToken(event.data.accessToken))
          finish(undefined, new ReporterAuthenticationError());
        else finish(event.data.accessToken);
      };
      const timer = viewerWindow.setTimeout(
        () => finish(undefined, new ReporterAuthenticationError()),
        SIGN_IN_TIMEOUT_MS
      );
      const closedTimer = viewerWindow.setInterval(() => {
        if (popup.closed) finish(undefined, new ReporterAuthenticationError());
      }, 500);
      viewerWindow.addEventListener('message', receive);
    }).finally(() => {
      pendingSignIn = undefined;
    });
    return pendingSignIn;
  }

  const relayRequest = async event => {
    if (
      event.origin !== viewerWindow.location.origin ||
      !children.has(event.source) ||
      event.data?.type !== REQUEST_TYPE ||
      typeof event.data.requestId !== 'string' ||
      event.data.requestId.length > 100
    )
      return;
    const source = event.source;
    let accessToken;
    try {
      accessToken = await getAccessToken();
    } catch (error) {
      // An unauthenticated parent cannot authorize a monitor window.
    }
    if (!source.closed && children.has(source)) {
      source.postMessage(
        { type: RESPONSE_TYPE, requestId: event.data.requestId, accessToken },
        event.origin
      );
    }
  };
  viewerWindow.addEventListener('message', relayRequest);

  return {
    getAccessToken,
    signIn,
    closeReport,
    openReport(url) {
      const target = new URL(url);
      if (target.origin !== vetOriginFor(viewerWindow.location.origin)) {
        closeReport();
        throw new Error('The report page must be served by the configured Radimal app.');
      }
      const popup = reportWindow || viewerWindow.open('about:blank', '_blank');
      reportWindow = undefined;
      if (!popup || popup.closed) throw new Error('Allow popups to view this report.');
      popup.location.href = target.toString();
    },
    registerChild(child) {
      if (child && child !== viewerWindow) children.add(child);
    },
    async fetch(input, options = {}, reporterOrigin) {
      const url = new URL(input, reporterOrigin);
      if (url.origin !== reporterOrigin || url.username || url.password) {
        throw new Error('Reporter credentials may only be sent to the configured Reporter origin.');
      }
      const token = await getAccessToken();
      const headers = new Headers(options.headers);
      headers.delete('X-Radimal-Key');
      headers.set('Authorization', `Bearer ${token}`);
      const response = await viewerWindow.fetch(url.toString(), {
        ...options,
        headers,
        credentials: 'omit',
        redirect: 'error',
      });
      if (response.status === 401) {
        if (signedInToken === token) {
          signedInToken = undefined;
          signedInUntil = 0;
        }
        throw new ReporterAuthenticationError();
      }
      return response;
    },
  };
}

let authentication;
export function reporterAuthentication() {
  if (!authentication) authentication = createReporterAuthentication(window);
  return authentication;
}
