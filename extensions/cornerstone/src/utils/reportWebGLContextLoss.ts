import { eventTarget, Enums, getRenderingEngine } from '@cornerstonejs/core';

// Chrome allows about 16 WebGL contexts per process and drops the oldest past that. Each viewer
// window holds 8 (a pool of 7 plus thumbnails), and windows opened from the viewer share a
// process, so a second window is enough to start losing contexts. The lost viewport goes blank
// or freezes until F5. This reports each loss to Sentry with what was open, so we can measure
// how often it happens and whether a fix lowers it.

// ponytail: capped per page load; one bad window (the worst seen peaked at 23) would otherwise flood Sentry.
const MAX_REPORTS_PER_PAGE = 5;

type SentryHook = (message: string, context: Record<string, unknown>) => void;

let lossesThisPage = 0;

/** Family windows the viewer believes are open, from the bookkeeping Duplicate Window keeps. */
function countOpenViewerWindows(): number | undefined {
  try {
    const windows = JSON.parse(localStorage.getItem('windowData') || '[]');
    return Array.isArray(windows) ? windows.filter(win => win && !win.closed).length : undefined;
  } catch {
    return undefined;
  }
}

export function onWebGLContextLost(evt: CustomEvent): void {
  lossesThisPage += 1;
  if (lossesThisPage > MAX_REPORTS_PER_PAGE) {
    return;
  }
  const { renderingEngineId, contextIndex } = evt.detail || {};
  let viewports: number | undefined;
  try {
    viewports = getRenderingEngine(renderingEngineId)?.getViewports().length;
  } catch {
    viewports = undefined;
  }
  const posthog = (window as any).posthog;

  (window as unknown as { __captureSentryMessage?: SentryHook }).__captureSentryMessage?.(
    'WebGL context lost',
    {
      renderingEngineId,
      contextIndex,
      viewports,
      lossesThisPage,
      windowName: window.name || undefined,
      openViewerWindows: countOpenViewerWindows(),
      secondsSinceLoad: Math.round(performance.now() / 1000),
      // Joins the event to its PostHog replay and to the per-tab window count there.
      posthogSessionId: posthog?.get_session_id?.(),
    }
  );
}

export default function reportWebGLContextLoss(): void {
  eventTarget.addEventListener(Enums.Events.WEBGL_CONTEXT_LOST, onWebGLContextLost);
}
