/**
 * Pure helpers for "new build available" detection.
 *
 * The running bundle has its build identity baked in at compile time
 * (process.env.COMMIT_HASH / process.env.BUILD_TIME via DefinePlugin in
 * .webpack/webpack.base.js). The server emits a per-deploy /version.json
 * (see platform/app/.webpack/webpack.pwa.js). An update is available when the
 * FETCHED identity differs from THIS window's BAKED identity — each window
 * compares against its own bundle, which is what makes multi-window
 * "old build + new build side by side" converge correctly.
 */

/** Values of the baked commit that mean "not a real deploy" (local dev). */
const LOCAL_COMMIT_VALUES = ['', 'local', 'dev'];

/**
 * Normalize a commit value (trim, coerce non-strings to '').
 */
export function normalizeCommit(commit) {
  return typeof commit === 'string' ? commit.trim() : '';
}

/**
 * True when the baked commit doesn't identify a real deployed build.
 */
export function isLocalCommit(commit) {
  return LOCAL_COMMIT_VALUES.includes(normalizeCommit(commit).toLowerCase());
}

/**
 * True for localhost-style hostnames where update checking must never fire.
 */
export function isLocalHostname(hostname) {
  if (typeof hostname !== 'string' || hostname === '') {
    return true;
  }
  return (
    hostname === 'localhost' ||
    hostname === '::1' ||
    hostname.startsWith('127.') ||
    hostname.endsWith('.localhost')
  );
}

/**
 * Detection is disabled entirely in local development.
 */
export function isLocalEnvironment(bakedCommit, hostname) {
  return isLocalCommit(bakedCommit) || isLocalHostname(hostname);
}

/**
 * Core comparison: is the fetched build newer than the running bundle?
 *
 * Commit is the primary signal; buildTime is a fallback for deploys where a
 * commit is unavailable on one side. Never reports an update when the baked
 * commit is a local sentinel.
 *
 * @param {object} params
 * @param {string} [params.remoteCommit] - commit from fetched /version.json
 * @param {string} [params.remoteBuildTime] - ISO buildTime from fetched /version.json
 * @param {string} [params.bakedCommit] - process.env.COMMIT_HASH of this bundle
 * @param {string} [params.bakedBuildTime] - process.env.BUILD_TIME of this bundle
 * @returns {boolean}
 */
export function isUpdateAvailable({
  remoteCommit,
  remoteBuildTime,
  bakedCommit,
  bakedBuildTime,
} = {}) {
  const baked = normalizeCommit(bakedCommit);
  const remote = normalizeCommit(remoteCommit);

  if (isLocalCommit(baked)) {
    return false;
  }

  if (remote && !isLocalCommit(remote)) {
    return remote !== baked;
  }

  // Fallback: compare build times when a usable remote commit is missing.
  const remoteTime = Date.parse(remoteBuildTime || '');
  const bakedTime = Date.parse(bakedBuildTime || '');
  if (!Number.isNaN(remoteTime) && !Number.isNaN(bakedTime)) {
    return remoteTime > bakedTime;
  }

  return false;
}

/**
 * Session-dismiss logic: the banner stays hidden only for the exact commit the
 * user dismissed. A newer (different) commit shows the banner again.
 */
export function isDismissed(dismissedCommit, updateCommit) {
  const dismissed = normalizeCommit(dismissedCommit);
  const update = normalizeCommit(updateCommit);
  return dismissed !== '' && dismissed === update;
}

/**
 * Guard for BroadcastChannel messages (UPDATE_AVAILABLE / REFRESH_REQUESTED):
 * a window whose own baked commit already matches the broadcast commit is
 * already on the new build and must ignore the message (prevents pointless
 * banners and reload loops). Unknown broadcast commits are acted upon.
 */
export function shouldReactToBroadcast({ ownCommit, broadcastCommit } = {}) {
  const own = normalizeCommit(ownCommit);
  const incoming = normalizeCommit(broadcastCommit);

  if (incoming === '' || incoming === 'unknown') {
    // Can't validate — act on it (user/detector initiated; reloads never
    // rebroadcast, so no loop is possible).
    return true;
  }

  return incoming !== own;
}
