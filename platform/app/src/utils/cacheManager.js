class CacheManager {
  constructor() {
    this.currentVersion = null;
    this.checkInterval = 30000; // Check every 30 seconds
    this.isChecking = false;
  }

  async getCurrentVersion() {
    try {
      const response = await fetch('/version.json?' + Date.now()); // Cache bust the version check
      const data = await response.json();
      return data.version;
    } catch (error) {
      console.warn('Failed to check version:', error);
      return null;
    }
  }

  async checkForUpdates() {
    if (this.isChecking) return;
    this.isChecking = true;

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
    // Initial version set
    this.getCurrentVersion().then(version => {
      this.currentVersion = version;
      console.log('Current app version:', version);
    });

    // Periodic checking
    setInterval(() => {
      this.checkForUpdates();
    }, this.checkInterval);

    // Check when window regains focus
    window.addEventListener('focus', () => {
      this.checkForUpdates();
    });
  }
}

export default new CacheManager();