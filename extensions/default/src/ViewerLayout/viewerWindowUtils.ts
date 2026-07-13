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
 * Close every family window except this one (grab-by-name; no broadcast, no self-close). Used
 * before a cross-origin LOAD_STUDY navigation: storage events and BroadcastChannel are
 * per-origin, so monitor windows can't follow a VEG↔non-VEG switch and would be left showing
 * the previous patient.
 */
export const closeOtherFamilyWindows = () => {
  const windows = readFamilyWindowData();
  windows.forEach(win => {
    if (win.closed || win.id === window.name) {
      return;
    }
    const childWindow = window.open('', win.id);
    if (childWindow) {
      childWindow.close();
      win.closed = true;
    }
  });
  localStorage.setItem('windowData', JSON.stringify(windows));
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
  localStorage.setItem('windowsArray', JSON.stringify(windowDataArray));
  window.close();
};
