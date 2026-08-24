import { imageLoader, getRenderingEngines } from '@cornerstonejs/core';

/**
 * Recovery layer for frame loads.
 *
 * Two failure modes observed in production (VEG studies especially, where raw
 * uncompressed DX frames are ~13MB):
 *
 * 1. A frame request stalls (client connection dies mid-transfer) and hangs
 *    forever — the viewer shows a permanently blank viewport/thumbnail.
 * 2. A frame request fails once and is never retried, because cornerstone
 *    evicts the failed load from cache but nothing re-requests it.
 *
 * This module provides a stall watchdog that aborts dead transfers (so they
 * fail fast instead of hanging) and a bounded retrier that re-requests failed
 * frames and repaints any viewport currently showing them.
 *
 * All outcomes are announced on a window CustomEvent channel
 * (RADIMAL_IMAGE_LOAD_TELEMETRY_EVENT) which the app-level PostHog bridge
 * forwards, so these failures are visible in telemetry.
 */

export const RADIMAL_IMAGE_LOAD_TELEMETRY_EVENT = 'radimal:image-load-telemetry';

export function dispatchImageLoadTelemetry(event: string, detail: Record<string, unknown>): void {
  try {
    window.dispatchEvent(
      new CustomEvent(RADIMAL_IMAGE_LOAD_TELEMETRY_EVENT, { detail: { event, ...detail } })
    );
  } catch {
    // Telemetry must never break image loading.
  }
}

type StallWatchdogOptions = {
  /** Abort when no progress bytes arrive for this long. 0 disables the watchdog. */
  stallTimeoutMs?: number;
  /** Abort when the whole transfer exceeds this. 0 disables the cap. */
  maxDurationMs?: number;
};

const WATCHDOG_POLL_MS = 5000;

/**
 * Watches an in-flight frame XHR and aborts it when the transfer stalls
 * (no progress events for `stallTimeoutMs`) or exceeds `maxDurationMs`.
 * The abort surfaces as a normal load failure, which the retrier below —
 * or a fresh user action — can then recover from, instead of the request
 * hanging silently for the rest of the session.
 */
export function attachStallWatchdog(
  xhr: XMLHttpRequest,
  imageId: string,
  { stallTimeoutMs = 90000, maxDurationMs = 600000 }: StallWatchdogOptions = {}
): void {
  if (!stallTimeoutMs && !maxDurationMs) {
    return;
  }

  const startedAt = Date.now();
  let lastProgressAt = startedAt;
  let loadedBytes = 0;

  const onProgress = (e: ProgressEvent) => {
    lastProgressAt = Date.now();
    if (typeof e.loaded === 'number') {
      loadedBytes = e.loaded;
    }
  };

  const cleanup = () => {
    clearInterval(interval);
    xhr.removeEventListener('progress', onProgress);
    xhr.removeEventListener('loadend', cleanup);
  };

  const interval = setInterval(() => {
    const now = Date.now();
    const sinceProgress = now - lastProgressAt;
    const duration = now - startedAt;
    const stalled = Boolean(stallTimeoutMs) && sinceProgress >= stallTimeoutMs;
    const tooLong = Boolean(maxDurationMs) && duration >= maxDurationMs;
    if (!stalled && !tooLong) {
      return;
    }
    cleanup();
    dispatchImageLoadTelemetry('image_load_stall_aborted', {
      imageId,
      reason: stalled ? 'stalled' : 'max_duration',
      msSinceLastProgress: sinceProgress,
      durationMs: duration,
      loadedBytes,
    });
    try {
      xhr.abort();
    } catch {
      // Aborting an already-settled request is fine.
    }
  }, WATCHDOG_POLL_MS);

  xhr.addEventListener('progress', onProgress);
  // loadend fires on load, error, abort and timeout alike.
  xhr.addEventListener('loadend', cleanup);
}

type RetrierOptions = {
  /** Retry attempts per imageId after the initial failure. */
  retryAttempts?: number;
  /** Base backoff before the first retry; doubles per attempt. */
  backoffMs?: number;
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function httpStatusOf(error: unknown): number | undefined {
  const err = error as { status?: number; request?: { status?: number } } | undefined;
  return err?.status ?? err?.request?.status;
}

/** 4xx (except 429) won't heal on retry — don't hammer the server. */
function isPermanentFailure(error: unknown): boolean {
  const status = httpStatusOf(error);
  return typeof status === 'number' && status >= 400 && status < 500 && status !== 429;
}

/**
 * After a successful re-load, repaint any stack viewport that is currently
 * showing the recovered image — it went blank when the original load failed
 * and nothing else will trigger a redraw.
 */
function refreshViewportsShowing(imageId: string): void {
  const renderingEngines = getRenderingEngines() ?? [];
  renderingEngines.forEach(renderingEngine => {
    let viewports = [];
    try {
      viewports = renderingEngine.getViewports() ?? [];
    } catch {
      return;
    }
    viewports.forEach(viewport => {
      try {
        const vp = viewport as unknown as {
          getCurrentImageId?: () => string;
          getCurrentImageIdIndex?: () => number;
          setImageIdIndex?: (index: number) => Promise<string>;
        };
        if (vp.getCurrentImageId?.() === imageId && vp.setImageIdIndex && vp.getCurrentImageIdIndex) {
          vp.setImageIdIndex(vp.getCurrentImageIdIndex());
        }
      } catch {
        // Never let a repaint attempt break the recovery path.
      }
    });
  });
}

/**
 * Returns a handler for cornerstone's IMAGE_LOAD_FAILED / IMAGE_LOAD_ERROR
 * events that re-requests the failed image a bounded number of times.
 * Cornerstone evicts failed loads from its cache, so a re-request goes back
 * to the network; on success the image lands in cache and any viewport
 * currently showing it is repainted.
 */
export function createImageLoadFailureRetrier({
  retryAttempts = 2,
  backoffMs = 1000,
}: RetrierOptions = {}): (detail: { imageId?: string; error?: unknown }) => void {
  // imageIds we are currently retrying — failures they re-emit are ours.
  const retrying = new Set<string>();
  // imageId -> when its retries were exhausted. Blocks an immediate restart of
  // the cycle, but expires so a later user-driven attempt gets retry help again.
  const exhaustedAt = new Map<string, number>();
  const EXHAUSTED_COOLDOWN_MS = 60000;

  async function retryLoop(imageId: string, initialError: unknown): Promise<void> {
    let lastError = initialError;
    for (let attempt = 1; attempt <= retryAttempts; attempt++) {
      await sleep(backoffMs * Math.pow(2, attempt - 1));
      try {
        await imageLoader.loadAndCacheImage(imageId);
        retrying.delete(imageId);
        refreshViewportsShowing(imageId);
        dispatchImageLoadTelemetry('image_load_recovered', { imageId, attempts: attempt });
        return;
      } catch (error) {
        lastError = error;
        if (isPermanentFailure(error)) {
          break;
        }
      }
    }
    retrying.delete(imageId);
    exhaustedAt.set(imageId, Date.now());
    dispatchImageLoadTelemetry('image_load_failed', {
      imageId,
      attempts: retryAttempts,
      status: httpStatusOf(lastError),
      message: (lastError as Error | undefined)?.message,
    });
  }

  return ({ imageId, error } = {}) => {
    try {
      if (!imageId || retrying.has(imageId)) {
        return;
      }
      const exhausted = exhaustedAt.get(imageId);
      if (exhausted !== undefined) {
        if (Date.now() - exhausted < EXHAUSTED_COOLDOWN_MS) {
          return;
        }
        exhaustedAt.delete(imageId);
      }
      if (retryAttempts < 1 || isPermanentFailure(error)) {
        dispatchImageLoadTelemetry('image_load_failed', {
          imageId,
          attempts: 0,
          status: httpStatusOf(error),
          message: (error as Error | undefined)?.message,
        });
        return;
      }
      retrying.add(imageId);
      retryLoop(imageId, error);
    } catch {
      retrying.delete(imageId);
    }
  };
}
