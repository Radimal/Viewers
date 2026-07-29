export const VIEWER_WINDOW_NAME = 'viewerWindow';

/**
 * Identity of this window instance, regenerated on every page load. A primary viewer announces
 * itself with these on load so an older primary (e.g. one opened from a different radimal-vet
 * tab) can yield — two primaries would fight over currentStudyId.
 */
export const WINDOW_INSTANCE_ID = Math.random().toString(36).slice(2);
export const WINDOW_STARTED_AT = Date.now();

/**
 * When this document's NAVIGATION began — the moment its URL was fixed — as opposed to
 * WINDOW_STARTED_AT, which is when this module evaluated, seconds later on a slow load.
 *
 * The family-signal gates must use this one. A signal published in the gap between the two (the
 * observed case: refresh a monitor, and the case switches before the new document's scripts run)
 * genuinely happened after this document's URL was decided, so it is NOT reflected in that URL and
 * must be honored; gating on module-eval time silently discarded exactly those.
 */
export const DOCUMENT_STARTED_AT: number =
  typeof performance !== 'undefined' && performance.timeOrigin
    ? performance.timeOrigin
    : WINDOW_STARTED_AT;

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

const FAMILY_STUDY_KEY = 'currentStudyId';
const FAMILY_STUDY_AT_KEY = 'currentStudyIdAt';

/**
 * Publish the study the family should be showing. Written only by the primary.
 *
 * The timestamp lives in a separate key on purpose: builds that read only `currentStudyId` keep
 * working through a rollout, which matters because monitor windows are long-lived and are not
 * all reloaded at once.
 */
export const publishFamilyStudy = (studyInstanceUid: string) => {
  localStorage.setItem(FAMILY_STUDY_KEY, studyInstanceUid);
  localStorage.setItem(FAMILY_STUDY_AT_KEY, String(Date.now()));
};

/**
 * The family's intended study, but only if it was published after this document began loading.
 *
 * For the mount-time reconcile, which exists because a window that is still loading has no
 * `storage` listener and no channel listener, so it misses a case switch entirely. Some check is
 * essential: localStorage outlives the session and each viewer origin keeps its own copy, so a
 * window would otherwise chase whatever study that origin was last showing.
 *
 * Publication time versus load time is the exact question — "did the family move on while I was
 * loading?" — where wall-clock freshness is only a proxy for it, and a misleading one. A regular ->
 * VEG -> regular switch inside a short window leaves the first origin's entry recent but obsolete,
 * and a monitor returning there would follow it back to the previous patient. Anything published
 * before this document's navigation began is by definition already reflected in the URL we were
 * handed; anything after it happened while we were blind.
 *
 * A live `storage` event needs no check at all — it is current by definition.
 */
export const readFamilyStudyPublishedSinceLoad = (): string | null => {
  const studyInstanceUid = localStorage.getItem(FAMILY_STUDY_KEY);
  if (!studyInstanceUid) {
    return null;
  }
  const publishedAt = Number(localStorage.getItem(FAMILY_STUDY_AT_KEY));
  if (!publishedAt || publishedAt < DOCUMENT_STARTED_AT) {
    return null;
  }
  return studyInstanceUid;
};

const FAMILY_DEPARTURE_KEY = 'familyDepartureTarget';

/**
 * Record, on the origin the family is LEAVING, where it went. Written by the primary immediately
 * before a cross-origin case switch.
 *
 * This exists for monitor windows that are mid-load when the switch happens: they have no channel
 * listener yet, so they miss NAVIGATE_FAMILY, and once the family is gone nothing on this origin
 * will ever update again — localStorage and BroadcastChannel are both origin-partitioned. The
 * departure note is what such a window finds when it finishes loading.
 *
 * This replaced navigating family windows by name (window.open(url, name)): when the name lookup
 * failed — a monitor opened by an earlier primary, restored by the browser, or in another tab
 * group — window.open CREATED a new window under that name instead, so a case switch could spawn
 * an extra viewer tab while the real monitor stayed on the previous patient.
 */
export const publishFamilyDeparture = (url: string) => {
  localStorage.setItem(FAMILY_DEPARTURE_KEY, JSON.stringify({ url, at: Date.now() }));
};

/**
 * Where the family went, if it left this origin after this document began loading — else null.
 * Same load-time gate as readFamilyStudyPublishedSinceLoad, and the target must report to this
 * window's own vet app, mirroring the LOAD_STUDY / NAVIGATE_FAMILY validation.
 */
export const readFamilyDepartureSinceLoad = (
  currentOrigin: string = window.location.origin
): { url: string; at: number } | null => {
  let departure;
  try {
    departure = JSON.parse(localStorage.getItem(FAMILY_DEPARTURE_KEY));
  } catch (error) {
    return null;
  }
  if (!departure?.url || !departure.at || departure.at < DOCUMENT_STARTED_AT) {
    return null;
  }
  try {
    const targetVet = vetOriginFor(new URL(departure.url).origin);
    if (!targetVet || targetVet !== vetOriginFor(currentOrigin)) {
      return null;
    }
  } catch (error) {
    return null;
  }
  return departure;
};

/** When the family study on this origin was last published; 0 if never. */
export const familyStudyPublishedAt = (): number =>
  Number(localStorage.getItem(FAMILY_STUDY_AT_KEY)) || 0;

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
