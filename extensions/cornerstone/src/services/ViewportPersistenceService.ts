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

  private subscriptions: Array<() => void> = [];
  private isInitialized = false;
  private isInitialLoad = true;
  private initialLoadTimer: NodeJS.Timeout | null = null;

  constructor({ servicesManager }) {
    super(ViewportPersistenceService.EVENTS);
    this.servicesManager = servicesManager;
  }

  init(): void {
    if (this.isInitialized) return;
    this.isInitialized = true;

    // Mark as no longer initial load after a delay
    this.initialLoadTimer = setTimeout(() => {
      this.isInitialLoad = false;
      console.log('📱 Initial load period ended');
    }, 3000); // 3 seconds should be enough for initial app setup
  }

  // Generate a simple hash based on the current image
  generateViewportHash(viewport: any): string | null {
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

      return `${imageUids.studyUID}-${imageUids.seriesUID}-${imageUids.instanceUID}`;
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

  public storeRotationFlipState(viewportId: string): void {
    const { cornerstoneViewportService } = this.servicesManager.services;

    try {
      const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
      if (!viewport) return;

      const hash = this.generateViewportHash(viewport);
      const state = this._extractRotationFlipState(viewport);

      if (!hash || !state) return;

      this._storeViewportState(hash, state);

      console.log('📦 Storing state:', {
        viewportId,
        hash,
        state: state.rotationFlip,
      });

      this._broadcastEvent(ViewportPersistenceService.EVENTS.VIEWPORT_STATE_STORED, {
        viewportId,
        hash,
        state,
      });
    } catch (error) {
      console.error('Error storing viewport state:', error);
    }
  }

  public attemptViewportRestoration(viewportId: string): void {
    // Use longer delay for initial load, shorter for navigation
    const delay = this.isInitialLoad ? 800 : 50;
    console.log(`🔄 Scheduling restoration (delay: ${delay}ms, initial: ${this.isInitialLoad})`);

    setTimeout(() => {
      this._restoreViewportState(viewportId);

      // For initial load, add an additional restoration attempt
      if (this.isInitialLoad) {
        setTimeout(() => {
          console.log('🔄 Additional restoration attempt for initial load');
          this._restoreViewportState(viewportId);
        }, 800);
      }
    }, delay);
  }

  private _restoreViewportState(viewportId: string): void {
    const { cornerstoneViewportService } = this.servicesManager.services;

    try {
      const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
      if (!viewport?.getCurrentImageId?.()) {
        return;
      }

      const hash = this.generateViewportHash(viewport);
      if (!hash) return;

      const storedState = this._getViewportState(hash);
      if (!storedState?.rotationFlip) return;

      // Check if the current state matches the stored state
      const currentState = this._extractRotationFlipState(viewport);
      if (this._statesMatch(currentState?.rotationFlip, storedState.rotationFlip)) {
        console.log('⏭️ State already correct, skipping restoration');
        return;
      }

      console.log('📥 Restoring state:', {
        viewportId,
        hash,
        currentState: currentState?.rotationFlip,
        storedState: storedState.rotationFlip,
      });

      this._applyViewportState(viewport, storedState);

      this._broadcastEvent(ViewportPersistenceService.EVENTS.VIEWPORT_STATE_RESTORED, {
        viewportId,
        hash,
        state: storedState,
      });
    } catch (error) {
      console.error('Error restoring viewport state:', error);
    }
  }

  private _statesMatch(current: any, stored: any): boolean {
    if (!current || !stored) return false;

    return (
      current.rotation === stored.rotation &&
      current.flipHorizontal === stored.flipHorizontal &&
      current.flipVertical === stored.flipVertical
    );
  }

  private _extractRotationFlipState(viewport: any): any | null {
    try {
      const state: any = {
        viewportId: viewport.id,
        timestamp: Date.now(),
        type: 'rotation_flip_only',
      };

      // Get rotation from view presentation first
      if (viewport.getViewPresentation) {
        const presentation = viewport.getViewPresentation();
        if (presentation?.rotation !== undefined) {
          state.rotationFlip = state.rotationFlip || {};
          state.rotationFlip.rotation = presentation.rotation;
        }
      }

      // Get flips and fallback rotation from camera
      if (viewport.getCamera) {
        const camera = viewport.getCamera();
        state.rotationFlip = state.rotationFlip || {};

        if (camera.flipHorizontal !== undefined) {
          state.rotationFlip.flipHorizontal = camera.flipHorizontal;
        }

        if (camera.flipVertical !== undefined) {
          state.rotationFlip.flipVertical = camera.flipVertical;
        }

        // Fallback rotation from camera if not in presentation
        if (camera.rotation !== undefined && !state.rotationFlip.rotation) {
          state.rotationFlip.rotation = camera.rotation;
        }
      }

      return state.rotationFlip ? state : null;
    } catch (error) {
      return null;
    }
  }

  private _storeViewportState(hash: string, viewportState: any): void {
    try {
      const storageKey = `${this.STORAGE_KEY_PREFIX}${hash}`;
      localStorage.setItem(storageKey, JSON.stringify(viewportState));
    } catch (error) {
      console.error('Error storing to localStorage:', error);
    }
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
      if (!state.rotationFlip) return;

      // Apply rotation via setViewPresentation if available
      if (viewport.setViewPresentation && state.rotationFlip.rotation !== undefined) {
        viewport.setViewPresentation({
          rotation: state.rotationFlip.rotation,
        });
        console.log('✅ Applied rotation:', state.rotationFlip.rotation);
      }

      // Apply flips via camera if available
      if (viewport.setCamera) {
        const cameraUpdates: any = {};

        if (state.rotationFlip.flipHorizontal !== undefined) {
          cameraUpdates.flipHorizontal = state.rotationFlip.flipHorizontal;
        }

        if (state.rotationFlip.flipVertical !== undefined) {
          cameraUpdates.flipVertical = state.rotationFlip.flipVertical;
        }

        if (Object.keys(cameraUpdates).length > 0) {
          viewport.setCamera(cameraUpdates);
          console.log('✅ Applied flips:', cameraUpdates);
        }
      }

      // Render the changes
      if (viewport.render) {
        viewport.render();
      }
    } catch (error) {
      console.error('Error applying viewport state:', error);
    }
  }

  cleanupInvalidStates(): void {
    try {
      const keys = Object.keys(localStorage).filter(key => key.startsWith(this.STORAGE_KEY_PREFIX));
      keys.forEach(key => {
        try {
          const storedState = JSON.parse(localStorage.getItem(key) || '{}');
          // Remove old format states
          if (storedState.camera && !storedState.type) {
            localStorage.removeItem(key);
          }
        } catch (error) {
          localStorage.removeItem(key);
        }
      });
    } catch (error) {
      // Silent error handling
    }
  }

  clearViewportState(hash: string): void {
    try {
      localStorage.removeItem(`${this.STORAGE_KEY_PREFIX}${hash}`);
    } catch (error) {
      // Silent error handling
    }
  }

  clearAllViewportStates(): void {
    try {
      Object.keys(localStorage)
        .filter(key => key.startsWith(this.STORAGE_KEY_PREFIX))
        .forEach(key => localStorage.removeItem(key));
    } catch (error) {
      // Silent error handling
    }
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
    } catch (error) {
      // Silent error handling
    }
    return states;
  }

  cleanup(): void {
    this.subscriptions.forEach(unsubscribe => {
      try {
        unsubscribe();
      } catch (error) {
        // Silent error handling
      }
    });
    this.subscriptions = [];

    if (this.initialLoadTimer) {
      clearTimeout(this.initialLoadTimer);
      this.initialLoadTimer = null;
    }

    this.isInitialized = false;
  }

  destroy(): void {
    this.cleanup();
  }
}

export default ViewportPersistenceService;
