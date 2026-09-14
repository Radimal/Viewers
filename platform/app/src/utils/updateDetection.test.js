import {
  normalizeCommit,
  isLocalCommit,
  isLocalHostname,
  isLocalEnvironment,
  isUpdateAvailable,
  isDismissed,
  shouldReactToBroadcast,
} from './updateDetection';

const OLD_COMMIT = '2260fc7d6a112da99b47e26c5e3460b920bbc3c0';
const NEW_COMMIT = '9f8e7d6c5b4a3210fedcba9876543210deadbeef';

describe('normalizeCommit', () => {
  it('trims whitespace (commit.txt often has a trailing newline)', () => {
    expect(normalizeCommit(`${OLD_COMMIT}\n`)).toBe(OLD_COMMIT);
    expect(normalizeCommit(`  ${OLD_COMMIT}  `)).toBe(OLD_COMMIT);
  });

  it('coerces non-strings to empty string', () => {
    expect(normalizeCommit(undefined)).toBe('');
    expect(normalizeCommit(null)).toBe('');
    expect(normalizeCommit(42)).toBe('');
  });
});

describe('isLocalCommit / isLocalHostname / isLocalEnvironment', () => {
  it('treats empty, "local" and "dev" commits as local', () => {
    expect(isLocalCommit('')).toBe(true);
    expect(isLocalCommit('  ')).toBe(true);
    expect(isLocalCommit('local')).toBe(true);
    expect(isLocalCommit('LOCAL')).toBe(true);
    expect(isLocalCommit('dev')).toBe(true);
    expect(isLocalCommit(OLD_COMMIT)).toBe(false);
  });

  it('recognizes localhost-style hostnames', () => {
    expect(isLocalHostname('localhost')).toBe(true);
    expect(isLocalHostname('127.0.0.1')).toBe(true);
    expect(isLocalHostname('::1')).toBe(true);
    expect(isLocalHostname('app.localhost')).toBe(true);
    expect(isLocalHostname('')).toBe(true);
    expect(isLocalHostname('viewer.radimal.ai')).toBe(false);
  });

  it('is local when EITHER the commit or the hostname is local', () => {
    expect(isLocalEnvironment('local', 'viewer.radimal.ai')).toBe(true);
    expect(isLocalEnvironment(OLD_COMMIT, 'localhost')).toBe(true);
    expect(isLocalEnvironment(OLD_COMMIT, 'viewer.radimal.ai')).toBe(false);
  });
});

describe('isUpdateAvailable (fetched /version.json vs baked bundle identity)', () => {
  it('reports an update when the fetched commit differs from the baked commit', () => {
    expect(
      isUpdateAvailable({
        remoteCommit: NEW_COMMIT,
        bakedCommit: OLD_COMMIT,
      })
    ).toBe(true);
  });

  it('reports no update when commits match', () => {
    expect(
      isUpdateAvailable({
        remoteCommit: OLD_COMMIT,
        bakedCommit: OLD_COMMIT,
      })
    ).toBe(false);
  });

  it('compares against THIS bundle, not a stored first-fetch value: a window that already runs the new build sees no update', () => {
    // Simulates the multi-window split-brain: the freshly-opened window's
    // baked commit already equals the deployed commit.
    expect(
      isUpdateAvailable({
        remoteCommit: NEW_COMMIT,
        bakedCommit: NEW_COMMIT,
      })
    ).toBe(false);
  });

  it('ignores whitespace differences from raw commit.txt reads', () => {
    expect(
      isUpdateAvailable({
        remoteCommit: `${OLD_COMMIT}\n`,
        bakedCommit: `${OLD_COMMIT}`,
      })
    ).toBe(false);
  });

  it('never fires when the baked commit is a local sentinel', () => {
    expect(isUpdateAvailable({ remoteCommit: NEW_COMMIT, bakedCommit: 'local' })).toBe(false);
    expect(isUpdateAvailable({ remoteCommit: NEW_COMMIT, bakedCommit: '' })).toBe(false);
  });

  it('falls back to buildTime when the remote commit is missing', () => {
    expect(
      isUpdateAvailable({
        remoteCommit: undefined,
        remoteBuildTime: '2026-07-21T12:00:00.000Z',
        bakedCommit: OLD_COMMIT,
        bakedBuildTime: '2026-07-20T12:00:00.000Z',
      })
    ).toBe(true);

    expect(
      isUpdateAvailable({
        remoteCommit: undefined,
        remoteBuildTime: '2026-07-20T12:00:00.000Z',
        bakedCommit: OLD_COMMIT,
        bakedBuildTime: '2026-07-20T12:00:00.000Z',
      })
    ).toBe(false);

    // Remote OLDER than baked (e.g. rollback race) is not "newer".
    expect(
      isUpdateAvailable({
        remoteCommit: undefined,
        remoteBuildTime: '2026-07-19T12:00:00.000Z',
        bakedCommit: OLD_COMMIT,
        bakedBuildTime: '2026-07-20T12:00:00.000Z',
      })
    ).toBe(false);
  });

  it('reports no update when neither commit nor parseable buildTime is available remotely', () => {
    expect(
      isUpdateAvailable({
        bakedCommit: OLD_COMMIT,
        bakedBuildTime: '2026-07-20T12:00:00.000Z',
      })
    ).toBe(false);
    expect(
      isUpdateAvailable({
        remoteBuildTime: 'not-a-date',
        bakedCommit: OLD_COMMIT,
        bakedBuildTime: '2026-07-20T12:00:00.000Z',
      })
    ).toBe(false);
    expect(isUpdateAvailable()).toBe(false);
  });
});

describe('isDismissed (sessionStorage dismiss behavior)', () => {
  it('stays dismissed only for the exact commit the user dismissed', () => {
    expect(isDismissed(NEW_COMMIT, NEW_COMMIT)).toBe(true);
  });

  it('shows again when a NEWER commit than the dismissed one appears', () => {
    expect(isDismissed(NEW_COMMIT, '0123456789abcdef0123456789abcdef01234567')).toBe(false);
  });

  it('is not dismissed when nothing was stored', () => {
    expect(isDismissed('', NEW_COMMIT)).toBe(false);
    expect(isDismissed(null, NEW_COMMIT)).toBe(false);
  });
});

describe('shouldReactToBroadcast (cross-window guards)', () => {
  it('reacts when this window is still on the old build', () => {
    expect(shouldReactToBroadcast({ ownCommit: OLD_COMMIT, broadcastCommit: NEW_COMMIT })).toBe(
      true
    );
  });

  it('ignores broadcasts about a build this window already runs (reload-loop guard)', () => {
    expect(shouldReactToBroadcast({ ownCommit: NEW_COMMIT, broadcastCommit: NEW_COMMIT })).toBe(
      false
    );
    expect(
      shouldReactToBroadcast({ ownCommit: NEW_COMMIT, broadcastCommit: `${NEW_COMMIT}\n` })
    ).toBe(false);
  });

  it('acts on unknown commits (user-initiated refresh must not be dropped)', () => {
    expect(shouldReactToBroadcast({ ownCommit: NEW_COMMIT, broadcastCommit: 'unknown' })).toBe(
      true
    );
    expect(shouldReactToBroadcast({ ownCommit: NEW_COMMIT, broadcastCommit: '' })).toBe(true);
    expect(shouldReactToBroadcast({})).toBe(true);
  });
});
