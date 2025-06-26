import { PubSubService } from '@ohif/core';

class ViewportPersistenceService extends PubSubService {
  public static readonly EVENTS = {
    VIEWPORT_STATE_STORED: 'event::viewportStateStored',
    VIEWPORT_STATE_RESTORED: 'event::viewportStateRestored',
    VIEWPORT_STATE_CLEARED: 'event::viewportStateCleared',
  };

  public static REGISTRATION = {
    name: 'viewportPersistenceService',
    altName: 'ViewportPersistenceService',
    create: ({ configuration = {}, servicesManager }) => {
      return new ViewportPersistenceService({ servicesManager });
    },
  };

  private servicesManager: any;
  private readonly STORAGE_KEY_PREFIX = 'ohif_viewport_state_';
  private readonly DEBOUNCE_DELAY = 300;
  private readonly HEALTH_CHECK_DELAY = 500;

  private subscriptions: Array<() => void> = [];
  private isInitialized = false;
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  private processedViewports = new Set<string>();
  private restoredHashes = new Set<string>();
  private restorationInProgress = new Set<string>();

  constructor({ servicesManager }) {
    super(ViewportPersistenceService.EVENTS);
    this.servicesManager = servicesManager;
  }

  init(): void {
    if (this.isInitialized) return;

    const { cornerstoneViewportService } = this.servicesManager.services;
    if (cornerstoneViewportService) {
      this._subscribeToServiceEvents(cornerstoneViewportService);
      this._subscribeToViewportCreation(cornerstoneViewportService);

      setTimeout(() => {
        this.cleanupInvalidStates();
      }, 1000);
    }

    this.isInitialized = true;
  }

  private _subscribeToServiceEvents(cornerstoneViewportService: any): void {
    try {
      const eventKey =
        cornerstoneViewportService.EVENTS?.VIEWPORT_DATA_CHANGED || 'VIEWPORT_DATA_CHANGED';
      const subscription = cornerstoneViewportService.subscribe(
        eventKey,
        this._handleViewportCreated.bind(this)
      );

      if (subscription) {
        this.subscriptions.push(subscription);
      }
    } catch (error) {}
  }

  private _subscribeToViewportCreation(cornerstoneViewportService: any): void {
    try {
      const subscription = cornerstoneViewportService.subscribe(
        'VIEWPORT_DATA_CHANGED',
        (eventData: any) => {
          if (eventData?.viewportId && !this.processedViewports.has(eventData.viewportId)) {
            this.processedViewports.add(eventData.viewportId);
            setTimeout(() => this._attemptStateRestoration(eventData.viewportId), 200);
          }
        }
      );

      if (subscription) {
        this.subscriptions.push(subscription);
      }
    } catch (error) {}
  }

  private _handleViewportCreated(eventData: any): void {
    const viewportId = eventData?.viewportId;
    if (!viewportId || this.processedViewports.has(viewportId)) return;

    this.processedViewports.add(viewportId);
    setTimeout(() => this._attemptStateRestoration(viewportId), 200);
  }

  private _attemptStateRestoration(viewportId: string): void {
    const { cornerstoneViewportService } = this.servicesManager.services;

    try {
      const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
      if (!viewport?.getCurrentImageId?.()) {
        return;
      }

      const hash = this._generateViewportHash(viewport);
      if (!hash) {
        return;
      }

      if (this.restoredHashes.has(hash)) {
        return;
      }

      let storedState = this._getViewportState(hash);

      if (!storedState) {
        storedState = this._findFallbackState(hash);
      }

      if (!storedState) {
        this.restoredHashes.add(hash);
        return;
      }

      this.restorationInProgress.add(viewportId);

      this._applyViewportState(viewport, storedState);
      this.restoredHashes.add(hash);

      setTimeout(() => {
        this.restorationInProgress.delete(viewportId);
      }, 500);

      setTimeout(
        () => this._verifyViewportHealth(viewport, hash, viewportId),
        this.HEALTH_CHECK_DELAY
      );

      this._broadcastEvent(ViewportPersistenceService.EVENTS.VIEWPORT_STATE_RESTORED, {
        viewportId,
        hash,
        state: storedState,
      });
    } catch (error) {
      this.restorationInProgress.delete(viewportId);
      this._ensureViewportVisible(viewportId);
    }
  }

  private _findFallbackState(targetHash: string): any | null {
    try {
      const [studyUID, seriesUID] = targetHash.split('-');
      const seriesPrefix = `${studyUID}-${seriesUID}`;

      const keys = Object.keys(localStorage).filter(
        key => key.startsWith(this.STORAGE_KEY_PREFIX) && key.includes(seriesPrefix)
      );

      if (keys.length > 0) {
        let mostRecentKey = keys[0];
        let mostRecentTime = 0;

        for (const key of keys) {
          try {
            const state = JSON.parse(localStorage.getItem(key) || '{}');
            if (state.timestamp > mostRecentTime) {
              mostRecentTime = state.timestamp;
              mostRecentKey = key;
            }
          } catch (e) {}
        }

        const fallbackState = localStorage.getItem(mostRecentKey);
        return fallbackState ? JSON.parse(fallbackState) : null;
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  public storeRotationFlipState(viewportId: string): void {
    setTimeout(() => {
      this._storeCurrentViewportState(viewportId);
    }, 250);
  }

  private _storeCurrentViewportState(viewportId: string): void {
    const { cornerstoneViewportService } = this.servicesManager.services;

    try {
      if (this.restorationInProgress.has(viewportId)) {
        return;
      }

      const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
      if (!viewport) return;

      const hash = this._generateViewportHash(viewport);
      const state = this._extractRotationFlipState(viewport);

      if (!hash || !state) return;

      this._storeViewportState(hash, state);

      this._broadcastEvent(ViewportPersistenceService.EVENTS.VIEWPORT_STATE_STORED, {
        viewportId,
        hash,
        state,
      });
    } catch (error) {}
  }

  private _generateViewportHash(viewport: any): string | null {
    try {
      let currentImageId = viewport.getCurrentImageId?.();

      if (!currentImageId && viewport.getImageIds) {
        const imageIds = viewport.getImageIds();
        const currentIndex = viewport.getCurrentImageIdIndex?.() || 0;
        currentImageId = imageIds[currentIndex] || imageIds[0];
      }

      if (!currentImageId) return null;

      const imageUids = this._extractUIDsFromImageId(currentImageId);
      if (!imageUids?.studyUID || !imageUids?.seriesUID || !imageUids?.instanceUID) {
        return null;
      }

      return `${imageUids.studyUID}-${imageUids.seriesUID}-${imageUids.instanceUID}-${imageUids.frameIndex || 0}`;
    } catch {
      return null;
    }
  }

  private _extractUIDsFromImageId(imageId: string): {
    studyUID: string;
    seriesUID: string;
    instanceUID: string;
    frameIndex?: number;
  } | null {
    try {
      const dicomWebMatch = imageId.match(
        /studies\/([^\/]+)\/series\/([^\/]+)\/instances\/([^\/]+)(?:\/frames\/(\d+))?/
      );
      if (dicomWebMatch) {
        return {
          studyUID: dicomWebMatch[1],
          seriesUID: dicomWebMatch[2],
          instanceUID: dicomWebMatch[3],
          frameIndex: dicomWebMatch[4] ? parseInt(dicomWebMatch[4]) : 0,
        };
      }

      const wadouriMatch = imageId.match(
        /studyUID=([^&]+).*?seriesUID=([^&]+).*?objectUID=([^&]+)/
      );
      if (wadouriMatch) {
        const frameMatch = imageId.match(/frameNumber=(\d+)/);
        return {
          studyUID: wadouriMatch[1],
          seriesUID: wadouriMatch[2],
          instanceUID: wadouriMatch[3],
          frameIndex: frameMatch ? parseInt(frameMatch[1]) - 1 : 0,
        };
      }

      return null;
    } catch {
      return null;
    }
  }

  private _extractRotationFlipState(viewport: any): any | null {
    try {
      const state: any = {
        viewportId: viewport.id,
        timestamp: new Date().toISOString(),
        type: 'rotation_flip_only',
      };

      if (viewport.getCamera) {
        const camera = viewport.getCamera();
        const rotationFlipState: any = {};

        if (camera.rotation !== undefined) {
          rotationFlipState.rotation = camera.rotation;
        }

        if (camera.flipHorizontal !== undefined) {
          rotationFlipState.flipHorizontal = camera.flipHorizontal;
        }

        if (camera.flipVertical !== undefined) {
          rotationFlipState.flipVertical = camera.flipVertical;
        }

        if (Object.keys(rotationFlipState).length > 0) {
          state.rotationFlip = rotationFlipState;
        }
      }

      if (viewport.getCurrentImageId) state.currentImageId = viewport.getCurrentImageId();
      if (viewport.getCurrentImageIdIndex)
        state.currentImageIdIndex = viewport.getCurrentImageIdIndex();

      return state.rotationFlip ? state : null;
    } catch (error) {
      return null;
    }
  }

  private _storeViewportState(hash: string, viewportState: any): void {
    try {
      const storageKey = `${this.STORAGE_KEY_PREFIX}${hash}`;
      const stateToStore = {
        ...viewportState,
        timestamp: Date.now(),
        hash,
      };

      localStorage.setItem(storageKey, JSON.stringify(stateToStore));
    } catch (error) {}
  }

  private _getViewportState(hash: string): any | null {
    try {
      const storageKey = `${this.STORAGE_KEY_PREFIX}${hash}`;
      const storedState = localStorage.getItem(storageKey);
      return storedState ? JSON.parse(storedState) : null;
    } catch {
      return null;
    }
  }

  private _applyViewportState(viewport: any, state: any): void {
    try {
      if (!state.rotationFlip) {
        return;
      }

      let applied = false;

      if (viewport.setViewPresentation && state.rotationFlip.rotation !== undefined) {
        try {
          viewport.setViewPresentation({
            rotation: state.rotationFlip.rotation,
          });
          applied = true;
        } catch (error) {}
      }

      if (viewport.setCamera) {
        const cameraUpdates: any = {};

        if (state.rotationFlip.flipHorizontal !== undefined) {
          cameraUpdates.flipHorizontal = state.rotationFlip.flipHorizontal;
        }

        if (state.rotationFlip.flipVertical !== undefined) {
          cameraUpdates.flipVertical = state.rotationFlip.flipVertical;
        }

        if (!applied && state.rotationFlip.rotation !== undefined) {
          cameraUpdates.rotation = state.rotationFlip.rotation;
        }

        if (Object.keys(cameraUpdates).length > 0) {
          try {
            viewport.setCamera(cameraUpdates);
            applied = true;
          } catch (error) {}
        }
      }

      if (!applied && viewport.setProperties) {
        try {
          viewport.setProperties(state.rotationFlip);
          applied = true;
        } catch (error) {}
      }

      if (viewport.render) {
        viewport.render();
      }

      if (state.currentImageIdIndex !== undefined && viewport.setImageIdIndex) {
        viewport.setImageIdIndex(state.currentImageIdIndex);
      }
    } catch (error) {}
  }

  private _verifyViewportHealth(viewport: any, hash: string, viewportId: string): void {
    try {
      if (!this._checkViewportHasValidImage(viewport)) {
        this._recoverFromBlackScreen(viewport, hash, viewportId);
      }
    } catch (error) {
      this._recoverFromBlackScreen(viewport, hash, viewportId);
    }
  }

  private _checkViewportHasValidImage(viewport: any): boolean {
    try {
      return !!(
        viewport.getCurrentImageId?.() &&
        viewport.getCanvas?.() &&
        viewport.getImageData?.()
      );
    } catch {
      return false;
    }
  }

  private _recoverFromBlackScreen(viewport: any, hash: string, viewportId: string): void {
    try {
      if (viewport.render) {
        viewport.render();
      }
    } catch (error) {}
  }

  private _ensureViewportVisible(viewportId: string): void {
    try {
      const { cornerstoneViewportService } = this.servicesManager.services;
      const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
      if (viewport && viewport.render) {
        viewport.render();
      }
    } catch (error) {}
  }

  private _isViewportRestored(viewportId: string): boolean {
    try {
      const { cornerstoneViewportService } = this.servicesManager.services;
      const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
      const hash = viewport ? this._generateViewportHash(viewport) : null;
      return hash ? this.restoredHashes.has(hash) : false;
    } catch {
      return false;
    }
  }

  handleViewportStateChange(viewportId: string, eventType: string): void {}

  attemptViewportRestoration(viewportId: string): void {
    this._attemptStateRestoration(viewportId);
  }

  ensureViewportVisible(viewportId: string): void {
    this._ensureViewportVisible(viewportId);
  }

  cleanupInvalidStates(): void {
    try {
      const keys = Object.keys(localStorage).filter(key => key.startsWith(this.STORAGE_KEY_PREFIX));
      let cleanedCount = 0;

      keys.forEach(key => {
        try {
          const storedState = JSON.parse(localStorage.getItem(key) || '{}');
          if (storedState.camera && !storedState.type) {
            localStorage.removeItem(key);
            cleanedCount++;
          }
        } catch (error) {
          localStorage.removeItem(key);
          cleanedCount++;
        }
      });
    } catch (error) {}
  }

  clearViewportState(hash: string): void {
    try {
      localStorage.removeItem(`${this.STORAGE_KEY_PREFIX}${hash}`);
    } catch (error) {}
  }

  clearAllViewportStates(): void {
    try {
      Object.keys(localStorage)
        .filter(key => key.startsWith(this.STORAGE_KEY_PREFIX))
        .forEach(key => localStorage.removeItem(key));
    } catch (error) {}
  }

  getAllViewportStates(): Record<string, any> {
    const states: Record<string, any> = {};
    try {
      Object.keys(localStorage)
        .filter(key => key.startsWith(this.STORAGE_KEY_PREFIX))
        .forEach(key => {
          const hash = key.replace(this.STORAGE_KEY_PREFIX, '');
          const state = JSON.parse(localStorage.getItem(key) || '{}');
          states[hash] = state;
        });
    } catch (error) {}
    return states;
  }

  cleanup(): void {
    this.subscriptions.forEach(unsubscribe => {
      try {
        unsubscribe();
      } catch (error) {}
    });
    this.subscriptions = [];

    this.debounceTimers.forEach(timer => clearTimeout(timer));
    this.debounceTimers.clear();

    this.processedViewports.clear();
    this.restoredHashes.clear();
    this.restorationInProgress.clear();

    this.isInitialized = false;
  }

  destroy(): void {
    this.cleanup();
  }
}

export default ViewportPersistenceService;
