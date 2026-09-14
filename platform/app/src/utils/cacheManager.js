// Non-destructive update detector.
//
// Polls /version.json (emitted per-deploy by platform/app/.webpack/webpack.pwa.js)
// and compares the fetched build identity against the identity BAKED into this
// bundle (process.env.COMMIT_HASH / BUILD_TIME from DefinePlugin). On mismatch
// it never reloads on its own — it dispatches a 'viewer-update-available'
// CustomEvent and broadcasts UPDATE_AVAILABLE on the 'viewer_update_channel'
// BroadcastChannel so every open window can show the update banner
// (see src/components/UpdateBanner.tsx). Reloads only happen when the user
// clicks the banner (UpdateBanner calls forceReload()).
import { normalizeCommit, isLocalEnvironment, isUpdateAvailable } from './updateDetection';

export const UPDATE_AVAILABLE_EVENT = 'viewer-update-available';
export const UPDATE_CHANNEL_NAME = 'viewer_update_channel';

class CacheManager {
  constructor() {
    this.bakedCommit = normalizeCommit(process.env.COMMIT_HASH);
    this.bakedBuildTime = process.env.BUILD_TIME || '';
    this.latestRemoteInfo = null;
    this.updateAvailable = false;
    this.isChecking = false;
    this.hasCheckedAfterLoad = false;
    this.lastCheckTime = 0;
    this.minCheckInterval = 60000; // Minimum 1 minute between checks
    this.started = false;
    this.channel = null;
  }

  // Detection never fires in local development.
  isEnabled() {
    if (typeof window === 'undefined') {
      return false;
    }
    return !isLocalEnvironment(this.bakedCommit, window.location.hostname);
  }

  async getRemoteBuildInfo() {
    try {
      // Cache bust the version check; no-store keeps SW/HTTP caches out of it.
      const response = await fetch('/version.json?' + Date.now(), { cache: 'no-store' });

      if (!response.ok) {
        console.warn('❌ version.json not found or error:', response.status, response.statusText);
        return null;
      }

      return await response.json();
    } catch (error) {
      console.warn('❌ Failed to check version:', error);
      return null;
    }
  }

  // Backward-compat debug helper (window.cacheManager.getCurrentVersion()).
  async getCurrentVersion() {
    const info = await this.getRemoteBuildInfo();
    return info ? info.version : null;
  }

  async checkForUpdates({ force = false } = {}) {
    if (!this.isEnabled() || this.isChecking) {
      return this.updateAvailable;
    }

    // Rate limiting - don't check too frequently
    const now = Date.now();
    if (!force && now - this.lastCheckTime < this.minCheckInterval) {
      return this.updateAvailable;
    }

    this.isChecking = true;
    this.lastCheckTime = now;

    try {
      const remote = await this.getRemoteBuildInfo();
      if (!remote) {
        return this.updateAvailable;
      }

      this.latestRemoteInfo = remote;

      const available = isUpdateAvailable({
        remoteCommit: remote.commit,
        remoteBuildTime: remote.buildTime,
        bakedCommit: this.bakedCommit,
        bakedBuildTime: this.bakedBuildTime,
      });

      if (available && !this.updateAvailable) {
        this.updateAvailable = true;
        console.log(
          '🔔 New build detected. Running commit:',
          this.bakedCommit,
          'Deployed commit:',
          remote.commit
        );
        this.notifyUpdateAvailable({
          commit: normalizeCommit(remote.commit),
          buildTime: remote.buildTime || null,
          version: remote.version || null,
          source: 'poll',
        });
      }

      return this.updateAvailable;
    } catch (error) {
      console.warn('Version check failed:', error);
      return this.updateAvailable;
    } finally {
      this.isChecking = false;
    }
  }

  // Notify THIS window (CustomEvent) and every sibling window (BroadcastChannel).
  // No reload happens here — the UpdateBanner handles user-initiated refresh.
  notifyUpdateAvailable(detail) {
    try {
      window.dispatchEvent(new CustomEvent(UPDATE_AVAILABLE_EVENT, { detail }));
    } catch (error) {
      console.warn('Failed to dispatch update event:', error);
    }

    if (detail.commit && typeof BroadcastChannel !== 'undefined') {
      try {
        if (!this.channel) {
          this.channel = new BroadcastChannel(UPDATE_CHANNEL_NAME);
        }
        this.channel.postMessage({ type: 'UPDATE_AVAILABLE', commit: detail.commit });
      } catch (error) {
        console.warn('Failed to broadcast update:', error);
      }
    }
  }

  async forceReload() {
    // Clear all caches, then reload
    if ('caches' in window) {
      try {
        const names = await caches.keys();
        await Promise.all(names.map(name => caches.delete(name)));
      } catch (error) {
        console.warn('Failed to clear caches before reload:', error);
      }
    }

    // Clear localStorage if needed (be careful with user data)
    // localStorage.clear();

    // Force hard reload
    window.location.reload(true);
  }

  startVersionChecking() {
    if (this.started) {
      return;
    }
    if (!this.isEnabled()) {
      console.log('🛑 Update detection disabled (local development).');
      return;
    }
    this.started = true;

    console.log('🚀 Starting update detection. Running commit:', this.bakedCommit);

    // Immediate check shortly after load
    setTimeout(() => this.checkForUpdates({ force: true }), 1000);

    // Single follow-up check 10 seconds after initial load
    setTimeout(() => {
      if (!this.hasCheckedAfterLoad) {
        this.checkForUpdates();
        this.hasCheckedAfterLoad = true;
      }
    }, 10000);

    // Only check when window regains focus (user returns to tab)
    // This is the most practical time for updates
    window.addEventListener('focus', () => {
      this.checkForUpdates();
    });

    // Check when user interacts after being idle
    let idleTimer = null;
    const resetIdleTimer = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        // After 5 minutes of inactivity, check on next interaction
        const checkOnNextInteraction = () => {
          this.checkForUpdates();
          document.removeEventListener('click', checkOnNextInteraction);
          document.removeEventListener('keypress', checkOnNextInteraction);
        };
        document.addEventListener('click', checkOnNextInteraction);
        document.addEventListener('keypress', checkOnNextInteraction);
      }, 300000); // 5 minutes
    };

    // Reset idle timer on user activity
    document.addEventListener('click', resetIdleTimer);
    document.addEventListener('keypress', resetIdleTimer);
    resetIdleTimer();
  }

  // Debug functions for console testing
  async manualVersionCheck() {
    console.log('🔧 Manual version check triggered...');
    return this.checkForUpdates({ force: true });
  }

  logStatus() {
    console.log('📊 Cache Manager Status:', {
      bakedCommit: this.bakedCommit,
      bakedBuildTime: this.bakedBuildTime,
      latestRemoteInfo: this.latestRemoteInfo,
      updateAvailable: this.updateAvailable,
      hasCheckedAfterLoad: this.hasCheckedAfterLoad,
      lastCheckTime: new Date(this.lastCheckTime).toLocaleTimeString(),
      isChecking: this.isChecking,
      started: this.started,
    });
  }
}

export default new CacheManager();
