import React, { useCallback, useEffect, useRef, useState } from 'react';
import cacheManager, { UPDATE_AVAILABLE_EVENT, UPDATE_CHANNEL_NAME } from '../utils/cacheManager';
import { normalizeCommit, isDismissed, shouldReactToBroadcast } from '../utils/updateDetection';

const BANNER_TEXT = 'New Update Today | Click to Refresh';
const DISMISS_STORAGE_KEY = 'ohif-update-banner-dismissed-commit';
const UNKNOWN_COMMIT = 'unknown';

const OWN_COMMIT = normalizeCommit(process.env.COMMIT_HASH);

function readDismissedCommit(): string {
  try {
    return window.sessionStorage.getItem(DISMISS_STORAGE_KEY) || '';
  } catch (e) {
    return '';
  }
}

function writeDismissedCommit(commit: string): void {
  try {
    window.sessionStorage.setItem(DISMISS_STORAGE_KEY, commit);
  } catch (e) {
    // sessionStorage unavailable — dismissal just won't persist
  }
}

/**
 * Best-effort: if a new service worker is waiting, tell it to activate before
 * we reload so the reload is served by the fresh worker. The Workbox instance
 * is stashed on window.__ohifWorkbox by public/init-service-worker.js.
 */
async function activateWaitingServiceWorker(): Promise<void> {
  try {
    const wb = (window as any).__ohifWorkbox;
    if (!wb) {
      return;
    }
    (window as any).__ohifUpdateReloadRequested = true;
    await Promise.race([
      wb.messageSW({ type: 'SKIP_WAITING' }),
      new Promise(resolve => setTimeout(resolve, 500)),
    ]);
  } catch (e) {
    // ignore — forceReload below still gets the user unstuck
  }
}

async function refreshToNewBuild(): Promise<void> {
  await activateWaitingServiceWorker();
  await cacheManager.forceReload();
}

/**
 * App-wide "new version available" banner.
 *
 * Mounted once in App.tsx so it renders above every route (study list and all
 * viewer windows). Hidden by default; becomes visible when:
 *  - this window's detector (cacheManager) dispatches 'viewer-update-available', or
 *  - init-service-worker.js dispatches the same event for a waiting SW, or
 *  - a sibling window broadcasts UPDATE_AVAILABLE on 'viewer_update_channel'.
 *
 * Every window validates broadcasts against its OWN baked commit, so a window
 * already running the new build ignores them. Clicking the banner broadcasts
 * REFRESH_REQUESTED (siblings on the old build reload too — user-initiated,
 * so the whole window family converges), then clears caches and reloads.
 */
function UpdateBanner(): JSX.Element | null {
  const [updateCommit, setUpdateCommit] = useState<string | null>(null);
  const [dismissedCommit, setDismissedCommit] = useState<string>(readDismissedCommit);
  const [entered, setEntered] = useState(false);
  const channelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    const handleUpdateAvailable = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      setUpdateCommit(normalizeCommit(detail.commit) || UNKNOWN_COMMIT);
    };
    window.addEventListener(UPDATE_AVAILABLE_EVENT, handleUpdateAvailable);

    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel(UPDATE_CHANNEL_NAME);
      channel.onmessage = event => {
        const { type, commit } = event.data || {};
        if (type === 'UPDATE_AVAILABLE') {
          if (shouldReactToBroadcast({ ownCommit: OWN_COMMIT, broadcastCommit: commit })) {
            setUpdateCommit(normalizeCommit(commit) || UNKNOWN_COMMIT);
          }
        } else if (type === 'REFRESH_REQUESTED') {
          // A sibling window's user clicked refresh — converge the family.
          // Guard: a window already on the broadcast commit must not reload
          // (prevents reload loops and pointless refreshes of new windows).
          if (shouldReactToBroadcast({ ownCommit: OWN_COMMIT, broadcastCommit: commit })) {
            refreshToNewBuild();
          }
        }
      };
      channelRef.current = channel;
    }

    // Catch up if detection fired before this component mounted.
    if (cacheManager.updateAvailable && cacheManager.latestRemoteInfo) {
      setUpdateCommit(normalizeCommit(cacheManager.latestRemoteInfo.commit) || UNKNOWN_COMMIT);
    }

    return () => {
      window.removeEventListener(UPDATE_AVAILABLE_EVENT, handleUpdateAvailable);
      channelRef.current = null;
      channel?.close();
    };
  }, []);

  const visible = Boolean(updateCommit) && !isDismissed(dismissedCommit, updateCommit);

  // Subtle slide-in once visible.
  useEffect(() => {
    if (!visible) {
      setEntered(false);
      return;
    }
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, [visible]);

  const handleRefreshClick = useCallback(() => {
    try {
      // Post through this window's persistent channel: BroadcastChannel never
      // delivers a message back to the instance that posted it, so this window
      // won't double-handle its own REFRESH_REQUESTED.
      channelRef.current?.postMessage({ type: 'REFRESH_REQUESTED', commit: updateCommit });
    } catch (e) {
      // broadcast is best-effort; still refresh this window
    }
    refreshToNewBuild();
  }, [updateCommit]);

  const handleDismiss = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      const commit = updateCommit || UNKNOWN_COMMIT;
      writeDismissedCommit(commit);
      setDismissedCommit(commit);
    },
    [updateCommit]
  );

  if (!visible) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[10000] flex justify-center">
      <div
        className={`bg-primary pointer-events-auto mb-2 flex items-stretch overflow-hidden rounded-full text-white shadow-lg transition-all duration-300 ease-out ${
          entered ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
        }`}
      >
        <button
          type="button"
          data-cy="update-banner-refresh"
          className="py-1.5 pl-4 pr-2 text-sm font-medium hover:brightness-110 focus:outline-none"
          onClick={handleRefreshClick}
        >
          {BANNER_TEXT}
        </button>
        <button
          type="button"
          data-cy="update-banner-dismiss"
          aria-label="Dismiss update notification"
          className="py-1.5 pl-1 pr-3 text-sm text-white/80 hover:text-white focus:outline-none"
          onClick={handleDismiss}
        >
          &times;
        </button>
      </div>
    </div>
  );
}

export default UpdateBanner;
