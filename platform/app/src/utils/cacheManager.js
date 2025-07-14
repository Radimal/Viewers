// Cache management utility for smart version checking
class CacheManager {
  constructor() {
    this.currentVersion = null;
    this.isChecking = false;
    this.hasCheckedAfterLoad = false;
    this.lastCheckTime = 0;
    this.minCheckInterval = 60000; // Minimum 1 minute between checks
  }

  async getCurrentVersion() {
    try {
      console.log('🔍 Checking for version.json...');
      const response = await fetch('/version.json?' + Date.now()); // Cache bust the version check
      
      console.log('📡 Version check response:', {
        status: response.status,
        statusText: response.statusText,
        url: response.url,
        ok: response.ok
      });

      if (!response.ok) {
        console.warn('❌ version.json not found or error:', response.status, response.statusText);
        return null;
      }

      const data = await response.json();
      console.log('✅ Version data received:', data);
      return data.version;
    } catch (error) {
      console.warn('❌ Failed to check version:', error);
      return null;
    }
  }

  async checkForUpdates() {
    if (this.isChecking) return;
    
    // Rate limiting - don't check too frequently
    const now = Date.now();
    if (now - this.lastCheckTime < this.minCheckInterval) {
      return;
    }
    
    this.isChecking = true;
    this.lastCheckTime = now;

    try {
      const newVersion = await this.getCurrentVersion();
      
      if (this.currentVersion && newVersion && this.currentVersion !== newVersion) {
        console.log('New version detected:', newVersion, 'Current:', this.currentVersion);
        this.handleVersionChange();
      } else if (!this.currentVersion) {
        this.currentVersion = newVersion;
      }
    } catch (error) {
      console.warn('Version check failed:', error);
    } finally {
      this.isChecking = false;
    }
  }

  handleVersionChange() {
    // Show user notification
    const shouldReload = confirm(
      'A new version is available. Click OK to refresh and get the latest updates.'
    );
    
    if (shouldReload) {
      this.forceReload();
    }
  }

  forceReload() {
    // Clear all caches and reload
    if ('caches' in window) {
      caches.keys().then(names => {
        names.forEach(name => caches.delete(name));
      });
    }
    
    // Clear localStorage if needed (be careful with user data)
    // localStorage.clear();
    
    // Force hard reload
    window.location.reload(true);
  }

  startVersionChecking() {
    console.log('🚀 Starting cache manager...');
    
    // Initial version set
    this.getCurrentVersion().then(version => {
      this.currentVersion = version;
      if (version) {
        console.log('✅ Current app version initialized:', version);
      } else {
        console.warn('⚠️ Could not initialize app version - version.json may not exist');
      }
    });

    // Single check 30 seconds after initial load
    setTimeout(() => {
      if (!this.hasCheckedAfterLoad) {
        this.checkForUpdates();
        this.hasCheckedAfterLoad = true;
      }
    }, 30000);

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
    await this.checkForUpdates();
  }

  logStatus() {
    console.log('📊 Cache Manager Status:', {
      currentVersion: this.currentVersion,
      hasCheckedAfterLoad: this.hasCheckedAfterLoad,
      lastCheckTime: new Date(this.lastCheckTime).toLocaleTimeString(),
      isChecking: this.isChecking
    });
  }
}

export default new CacheManager();