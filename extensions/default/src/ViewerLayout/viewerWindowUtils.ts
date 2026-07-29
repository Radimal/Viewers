export const VIEWER_WINDOW_NAME = 'viewerWindow';

/**
 * Identity of this window instance, regenerated on every page load. A primary viewer announces
 * itself with these on load so an older primary (e.g. one opened from a different radimal-vet
 * tab) can yield — two primaries would fight over currentStudyId.
 */
export const WINDOW_INSTANCE_ID = Math.random().toString(36).slice(2);
export const WINDOW_STARTED_AT = Date.now();

export const isPrimaryViewerWindow = () => window.name === VIEWER_WINDOW_NAME;

/**
 * The vet-driven window family is the primary ('viewerWindow') plus additional monitor windows
 * ('viewerWindow-<timestamp>'). Standalone viewers (share links, direct URLs) have no window
 * name and must ignore family traffic (fade/close broadcasts, currentStudyId changes).
 */
export const isManagedViewerWindow = () => window.name.startsWith(VIEWER_WINDOW_NAME);

export const isFamilyWindowId = (id: unknown): boolean =>
  typeof id === 'string' && id.startsWith(VIEWER_WINDOW_NAME);

/**
 * Params that describe ONE specific case. A monitor window following a same-origin study change
 * reuses its own URL and swaps StudyInstanceUIDs, so these have to go: carrying the previous
 * case's Orthanc study id onto a new study makes the download button hand over the PREVIOUS
 * patient's images and report success, because `studyId` is trusted ahead of loaded metadata
 * (ViewerHeader handleDownloadStudy). The initial series/SOP params belong to the old study's
 * series and can never resolve against the new one.
 *
 * `distinct_id` is deliberately absent — it identifies the user, not the case, and the same vet
 * drives the whole window family.
 */
export const CASE_SCOPED_PARAMS = [
  'studyId',
  'patientId',
  'PatientID',
  'initialseriesinstanceuid',
  'initialsopinstanceuid',
];

/**
 * Drop every case-scoped param from `url`, mutating and returning it. Use whenever a URL for one
 * study is reused as the basis for another.
 */
export const stripCaseScopedParams = (url: URL): URL => {
  CASE_SCOPED_PARAMS.forEach(param => url.searchParams.delete(param));
  return url;
};

type FamilyWindowEntry = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  closed: boolean;
};

/**
 * Read windowData, dropping any entry that isn't a family window. Standalone viewers used to
 * write themselves in with `id: ''`; reusing such an entry gave "Duplicate Window" children no
 * window name, making them unreachable by name-grab, broadcasts, and study-change follows.
 * Every write-back of this filtered list sanitizes the stored data.
 */
export const readFamilyWindowData = (): FamilyWindowEntry[] => {
  let windows;
  try {
    windows = JSON.parse(localStorage.getItem('windowData')) || [];
  } catch (error) {
    windows = [];
  }
  if (!Array.isArray(windows)) {
    windows = [];
  }
  return windows.filter(win => isFamilyWindowId(win?.id));
};

/**
 * Which radimal-vet origin a given viewer origin reports to. Pattern-based because the viewer is
 * served from multiple origins per environment (e.g. view.radimal.ai and veg-view.radimal.ai in
 * production) that all pair with the same vet app.
 */
export const vetOriginFor = (viewerOrigin: string): string | undefined => {
  if (viewerOrigin === 'http://localhost:3000') {
    return 'http://localhost:8000';
  }
  if (viewerOrigin.endsWith('.stage-1.radimal.ai')) {
    return 'https://radimal-vet-staging.onrender.com';
  }
  if (viewerOrigin.startsWith('https://') && viewerOrigin.endsWith('.radimal.ai')) {
    return 'https://vet.radimal.ai';
  }
  return undefined;
};

export const getVetOrigin = (): string | undefined => vetOriginFor(window.location.origin);

/**
 * Canonical name for the next monitor window: lowest 'viewerWindow-N' not currently open.
 * Names are positional rather than timestamped so the SAME physical window is addressable
 * from every viewer origin — windowData/windowsArray are per-origin localStorage, and a
 * timestamped id saved on one origin can never match a monitor that followed a cross-origin
 * case switch from the other, which made "open saved windows" spawn extras beside it.
 */
export const nextMonitorWindowId = (): string => {
  const openIds = new Set(
    readFamilyWindowData()
      .filter(win => !win.closed)
      .map(win => win.id)
  );
  let n = 1;
  while (openIds.has(`${VIEWER_WINDOW_NAME}-${n}`)) {
    n += 1;
  }
  return `${VIEWER_WINDOW_NAME}-${n}`;
};

/**
 * Close every window in the viewer family, saving the set to `windowsArray` so "Open Saved
 * Windows" can restore it. Used by the Close Windows menu item, the CLOSE message from
 * radimal-vet, and the opener-closed auto-close.
 *
 * Order matters: broadcast first so windows this one can't grab by name (a window in another
 * tab's browsing context group) still close themselves, and close self LAST so the bookkeeping
 * loop is guaranteed to finish.
 */
export const closeAllViewerWindows = () => {
  const channel = new BroadcastChannel('window_channel');
  channel.postMessage({ type: 'CLOSE', value: true });
  channel.close();

  const windowDataArray = [];
  const windows = readFamilyWindowData();
  windows.forEach(win => {
    if (win.closed) {
      return;
    }
    win.closed = true;
    windowDataArray.push(win);
    if (win.id === window.name) {
      return;
    }
    const childWindow = window.open('', win.id);
    if (childWindow) {
      childWindow.close();
    }
  });
  localStorage.setItem('windowData', JSON.stringify(windows));
  // Only overwrite the saved layout when a secondary window is part of this teardown. The
  // opener-closed auto-close routinely fires with just the primary open; saving that snapshot
  // would degrade windowsArray to [viewerWindow] and turn "Open Saved Windows" (and the
  // open-on-start preference) into a permanent no-op.
  const hasSecondaryWindow = windowDataArray.some(win => win.id !== VIEWER_WINDOW_NAME);
  if (hasSecondaryWindow) {
    localStorage.setItem('windowsArray', JSON.stringify(windowDataArray));
  }
  window.close();
};

/**
 * Reopen every saved secondary window from `windowsArray` at its saved geometry, staggered so
 * the browser doesn't coalesce the opens. The primary entry is skipped — the caller already is
 * (or stands in for) the primary. Used by the "Open Saved Windows" menu item and the
 * open-on-start preference.
 *
 * Calls `onBlocked(count)` after the last attempt if the popup blocker refused any window —
 * without user activation (the on-start path) Chrome blocks window.open unless the viewer
 * origin has been granted popup permission, and silently doing nothing reads as a dead button.
 */
export const openSavedViewerWindows = (onBlocked?: (blockedCount: number) => void) => {
  let windows;
  try {
    windows = JSON.parse(localStorage.getItem('windowsArray')) || [];
  } catch (error) {
    windows = [];
  }
  if (!Array.isArray(windows)) {
    windows = [];
  }
  const savedSecondaryWindows = windows.filter(
    win => isFamilyWindowId(win?.id) && win.id !== VIEWER_WINDOW_NAME
  );
  let blockedCount = 0;
  savedSecondaryWindows.forEach((win, index) => {
    setTimeout(() => {
      // Open by canonical position, not the saved id: the saved geometry still applies, but
      // targeting 'viewerWindow-N' reuses (and navigates) a monitor that already exists —
      // e.g. one that followed a cross-origin case switch — instead of spawning a new window
      // beside it because the per-origin saved id doesn't match its name.
      const opened = window.open(
        window.location.href,
        `${VIEWER_WINDOW_NAME}-${index + 1}`,
        `width=${win.width},height=${win.height},left=${win.x},top=${win.y}`
      );
      if (!opened) {
        blockedCount += 1;
      }
      if (index === savedSecondaryWindows.length - 1 && blockedCount > 0) {
        console.warn(`Popup blocker prevented reopening ${blockedCount} saved viewer window(s)`);
        onBlocked?.(blockedCount);
      }
    }, index * 200);
  });
};
