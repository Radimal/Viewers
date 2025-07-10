import { PubSubService } from '@ohif/core';
import { Enums, eventTarget } from '@cornerstonejs/core';

class ViewportPersistenceService extends PubSubService {
  public static readonly EVENTS = {
    VIEWPORT_STATE_STORED: 'event::viewportStateStored',
    VIEWPORT_STATE_RESTORED: 'event::viewportStateRestored',
    VIEWPORT_STATE_CLEARED: 'event::viewportStateCleared',
    VIEWPORT_STATE_RESTORE_START: 'event::viewportStateRestoreStart',
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
  private pendingRestorations: Map<string, { viewportId: string; timestamp: number }> = new Map();

  constructor({ servicesManager }) {
    super(ViewportPersistenceService.EVENTS);
    this.servicesManager = servicesManager;
  }

  init(): void {
    if (this.isInitialized) return;
    this.isInitialized = true;

    // Set up event listeners for immediate restoration
    this._setupEventListeners();

    // Mark as no longer initial load after a delay
    this.initialLoadTimer = setTimeout(() => {
      this.isInitialLoad = false;
      console.log('📱 Initial load period ended');
    }, 3000); // 3 seconds should be enough for initial app setup
  }

  private _setupEventListeners(): void {
    // Listen for viewport new image set events
    const viewportNewImageSetHandler = (event: any) => {
      const { element } = event.detail;
      if (element?.id) {
        this._handleViewportImageChange(element.id);
      }
    };

    // Listen for image rendered events
    const imageRenderedHandler = (event: any) => {
      const { element } = event.detail;
      if (element?.id) {
        this._handleViewportReady(element.id);
      }
    };

    // Listen for stack new image events
    const stackNewImageHandler = (event: any) => {
      const { element } = event.detail;
      if (element?.id) {
        this._handleViewportImageChange(element.id);
      }
    };

    // Add event listeners
    eventTarget.addEventListener(Enums.Events.VIEWPORT_NEW_IMAGE_SET, viewportNewImageSetHandler);
    eventTarget.addEventListener(Enums.Events.IMAGE_RENDERED, imageRenderedHandler);
    eventTarget.addEventListener(Enums.Events.STACK_NEW_IMAGE, stackNewImageHandler);

    // Store cleanup functions
    this.subscriptions.push(
      () => eventTarget.removeEventListener(Enums.Events.VIEWPORT_NEW_IMAGE_SET, viewportNewImageSetHandler),
      () => eventTarget.removeEventListener(Enums.Events.IMAGE_RENDERED, imageRenderedHandler),
      () => eventTarget.removeEventListener(Enums.Events.STACK_NEW_IMAGE, stackNewImageHandler)
    );
  }

  private _handleViewportImageChange(viewportId: string): void {
    console.log('🔄 Image change detected for viewport:', viewportId);
    
    this.storeRotationFlipState(viewportId);
    
    this.attemptViewportRestoration(viewportId);
  }

  private _handleViewportReady(viewportId: string): void {
    if (!this.pendingRestorations.has(viewportId)) {
      return;
    }

    console.log('🎯 Viewport ready event received for:', viewportId);

    // Small delay to ensure viewport is fully stabilized
    setTimeout(() => {
      if (this.pendingRestorations.has(viewportId)) {
        console.log('🔄 Attempting immediate restoration for:', viewportId);
        this._restoreViewportStateWithRetry(viewportId, 0);
      }
    }, 10);
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

      if (!currentImageId) {
        console.log('❌ No current image ID found for hash generation');
        return null;
      }

      console.log('🔍 Hash generation details:', {
        currentImageId,
        viewportType: viewport.constructor?.name,
        currentIndex: viewport.getCurrentImageIdIndex?.() || 'unknown',
      });

      const imageUids = this._extractUIDsFromImageId(currentImageId);
      console.log('🔍 Extracted UIDs:', imageUids);

      if (!imageUids?.studyUID || !imageUids?.seriesUID || !imageUids?.instanceUID) {
        console.log('❌ Missing required UIDs for hash generation');
        return null;
      }

      const hash = `${imageUids.studyUID}-${imageUids.seriesUID}-${imageUids.instanceUID}`;
      console.log('🔍 Generated hash:', hash);

      return hash;
    } catch (error) {
      console.error('❌ Error in hash generation:', error);
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

  public checkIfRestorationNeeded(viewportId: string): boolean {
    const { cornerstoneViewportService } = this.servicesManager.services;

    try {
      const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
      if (!viewport?.getCurrentImageId?.()) {
        return false;
      }

      const hash = this.generateViewportHash(viewport);
      if (!hash) {
        return false;
      }

      const storedState = this._getViewportState(hash);
      if (!storedState?.rotationFlip) {
        return false;
      }

      const currentState = this._extractRotationFlipState(viewport);
      return !this._statesMatch(currentState?.rotationFlip, storedState.rotationFlip);
    } catch (error) {
      return false;
    }
  }

  public attemptViewportRestoration(viewportId: string): void {
    console.log('🔄 Scheduling restoration for:', viewportId);

    // Add to pending restorations for event-based handling
    this.pendingRestorations.set(viewportId, {
      viewportId,
      timestamp: Date.now()
    });

    // Try immediate restoration first
    if (this._restoreViewportState(viewportId)) {
      // Success - remove from pending and we're done
      this.pendingRestorations.delete(viewportId);
      console.log('✅ Immediate restoration successful for:', viewportId);
      return;
    }

    // If immediate restoration fails, the viewport will be restored via events
    console.log('⏳ Waiting for viewport ready events for:', viewportId);

    // Fallback: remove from pending after timeout to prevent memory leaks
    setTimeout(() => {
      if (this.pendingRestorations.has(viewportId)) {
        console.log('🕐 Removing stale pending restoration for:', viewportId);
        this.pendingRestorations.delete(viewportId);
      }
    }, 5000); // 5 second timeout
  }

  private _restoreViewportStateWithRetry(viewportId: string, retryCount: number): void {
    const maxRetries = 5;
    const retryDelay = 25; // Further reduced retry delay for faster restoration

    console.log(`🔄 Restoration attempt ${retryCount + 1}/${maxRetries + 1} for:`, viewportId);

    if (this._restoreViewportState(viewportId)) {
      // Success - restoration completed
      this.pendingRestorations.delete(viewportId);
      
      if (this.isInitialLoad && retryCount === 0) {
        // For initial load, add an additional restoration attempt
        setTimeout(() => {
          console.log('🔄 Additional restoration attempt for initial load');
          this._restoreViewportState(viewportId);
        }, 800);
      }
      return;
    }

    // If restoration failed and we have retries left
    if (retryCount < maxRetries) {
      console.log(`⏳ Retry ${retryCount + 1} in ${retryDelay}ms...`);
      setTimeout(() => {
        this._restoreViewportStateWithRetry(viewportId, retryCount + 1);
      }, retryDelay);
    } else {
      console.log('❌ Restoration failed after max retries');
    }
  }

  private _restoreViewportState(viewportId: string): boolean {
    const { cornerstoneViewportService } = this.servicesManager.services;

    try {
      console.log('🔍 Attempting restoration for:', viewportId);

      const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
      if (!viewport?.getCurrentImageId?.()) {
        console.log('❌ No viewport or current image ID found');
        return false;
      }

      // Wait for image data to be available before restoration (fixes CT/MRI issues)
      const imageData = viewport.getImageData?.();
      if (!imageData) {
        console.log('❌ Image data not ready, will retry...');
        return false;
      }

      const hash = this.generateViewportHash(viewport);
      if (!hash) {
        console.log('❌ Could not generate hash for viewport');
        setTimeout(() => {
          this._broadcastEvent(ViewportPersistenceService.EVENTS.VIEWPORT_STATE_RESTORED, {
            viewportId,
            hash: null,
            state: null,
            noHash: true,
          });
        }, 200);
        return false;
      }

      console.log('🔍 Looking for stored state with hash:', hash);

      const storedState = this._getViewportState(hash);
      if (!storedState?.rotationFlip) {
        console.log('❌ No stored state found for hash:', hash);

        // Try to find a close match
        const allStoredKeys = Object.keys(localStorage).filter(key =>
          key.startsWith(this.STORAGE_KEY_PREFIX)
        );
        
        const partialMatches = allStoredKeys.filter(key => {
          const storedHash = key.replace(this.STORAGE_KEY_PREFIX, '');
          const hashParts = hash.split('-');
          const storedParts = storedHash.split('-');

          // Check if study and series match (ignore instance UID differences)
          return hashParts[0] === storedParts[0] && hashParts[1] === storedParts[1];
        });

        if (partialMatches.length > 0) {

          // Use the most recent partial match
          let mostRecentKey = partialMatches[0];
          let mostRecentTime = 0;

          for (const key of partialMatches) {
            try {
              const state = JSON.parse(localStorage.getItem(key) || '{}');
              if (state.timestamp > mostRecentTime) {
                mostRecentTime = state.timestamp;
                mostRecentKey = key;
              }
            } catch (e) {
              // Silent error handling
            }
          }

          const fallbackState = localStorage.getItem(mostRecentKey);
          if (fallbackState) {
            const parsedState = JSON.parse(fallbackState);

            // Update the stored state with the current hash for future use
            this._storeViewportState(hash, parsedState);

            this._applyViewportState(viewport, parsedState);

            setTimeout(() => {
              this._broadcastEvent(ViewportPersistenceService.EVENTS.VIEWPORT_STATE_RESTORED, {
                viewportId,
                hash,
                state: parsedState,
              });
            }, 200); // Balanced delay to prevent flicker while staying responsive

            return true;
          }
        }

        const defaultState = this._extractRotationFlipState(viewport);
        if (defaultState) {
          this._storeViewportState(hash, defaultState);
          console.log('📦 Stored default state for new image');
          
          this._applyViewportState(viewport, defaultState);
          
          setTimeout(() => {
            this._broadcastEvent(ViewportPersistenceService.EVENTS.VIEWPORT_STATE_RESTORED, {
              viewportId,
              hash,
              state: defaultState,
              wasDefault: true,
            });
          }, 200); // Same delay as transformed images for uniformity
        } else {
          setTimeout(() => {
            this._broadcastEvent(ViewportPersistenceService.EVENTS.VIEWPORT_STATE_RESTORED, {
              viewportId,
              hash,
              state: null,
              noStoredState: true,
            });
          }, 200); // Same delay for uniformity
        }
        
        return false;
      }

      console.log('📥 Restoring state:', {
        viewportId,
        hash,
        storedState: storedState.rotationFlip,
      });

      this._applyViewportState(viewport, storedState);

      setTimeout(() => {
        this._broadcastEvent(ViewportPersistenceService.EVENTS.VIEWPORT_STATE_RESTORED, {
          viewportId,
          hash,
          state: storedState,
        });
      }, 200); // Balanced delay to prevent flicker while staying responsive

      return true;
    } catch (error) {
      console.error('Error restoring viewport state:', error);
      setTimeout(() => {
        this._broadcastEvent(ViewportPersistenceService.EVENTS.VIEWPORT_STATE_RESTORED, {
          viewportId,
          hash: null,
          state: null,
          error: true,
        });
      }, 300);
      return false;
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

      const rotationFlipState: any = {};

      // For volume viewports (CT/MRI), check camera first
      if (viewport.getCamera) {
        const camera = viewport.getCamera();

        if (camera.flipHorizontal !== undefined) {
          rotationFlipState.flipHorizontal = camera.flipHorizontal;
        }

        if (camera.flipVertical !== undefined) {
          rotationFlipState.flipVertical = camera.flipVertical;
        }

        // Some volume viewports store rotation in camera
        if (camera.rotation !== undefined) {
          rotationFlipState.rotation = camera.rotation;
        }
      }

      // For stack viewports and as fallback, check view presentation
      if (viewport.getViewPresentation) {
        const presentation = viewport.getViewPresentation();
        if (presentation?.rotation !== undefined) {
          rotationFlipState.rotation = presentation.rotation;
        }

        // Some viewports store flips in presentation too
        if (presentation?.flipHorizontal !== undefined) {
          rotationFlipState.flipHorizontal = presentation.flipHorizontal;
        }
        if (presentation?.flipVertical !== undefined) {
          rotationFlipState.flipVertical = presentation.flipVertical;
        }
      }

      // Check properties as another fallback
      if (viewport.getProperties) {
        const properties = viewport.getProperties();
        if (properties?.rotation !== undefined && rotationFlipState.rotation === undefined) {
          rotationFlipState.rotation = properties.rotation;
        }
        if (
          properties?.flipHorizontal !== undefined &&
          rotationFlipState.flipHorizontal === undefined
        ) {
          rotationFlipState.flipHorizontal = properties.flipHorizontal;
        }
        if (
          properties?.flipVertical !== undefined &&
          rotationFlipState.flipVertical === undefined
        ) {
          rotationFlipState.flipVertical = properties.flipVertical;
        }
      }

      console.log('🔍 Extracting state from viewport:', {
        viewportType: viewport.constructor?.name,
        extractedState: rotationFlipState,
        viewportId: viewport.id,
      });

      if (Object.keys(rotationFlipState).length > 0) {
        state.rotationFlip = rotationFlipState;
        return state;
      }

      return null;
    } catch (error) {
      console.error('Error extracting rotation/flip state:', error);
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

      console.log('🔧 Applying state to viewport:', {
        viewportType: viewport.constructor?.name,
        targetState: state.rotationFlip,
        viewportId: viewport.id,
        imageIds: viewport.getImageIds?.()?.length || 'unknown',
        currentImageIndex: viewport.getCurrentImageIdIndex?.() || 'unknown',
      });

      // Special handling for stack viewports with multiple images (like CT stacks)
      const isStackViewport = viewport.constructor?.name === 'StackViewport';
      const imageIds = viewport.getImageIds?.() || [];
      const isMultiImageStack = isStackViewport && imageIds.length > 1;

      if (isMultiImageStack) {
        console.log('📚 Detected multi-image stack (CT/MRI), using stack-specific application');
        this._applyStackTransformations(viewport, state.rotationFlip);
      } else {
        console.log('🖼️ Single image or volume viewport, using standard application');
        // Ensure the viewport is ready before applying transformations
        try {
          // Force a render first to ensure the viewport is in a good state
          if (viewport.render) {
            viewport.render();
          }

          // Small delay to let the render complete, then apply transformations
          setTimeout(() => {
            this._applyTransformations(viewport, state.rotationFlip);
          }, 50);
        } catch (error) {
          console.error('Error in viewport preparation:', error);
          // Fallback: try applying immediately
          this._applyTransformations(viewport, state.rotationFlip);
        }
      }
    } catch (error) {
      console.error('Error applying viewport state:', error);
    }
  }

  private _applyStackTransformations(viewport: any, rotationFlipState: any): void {
    try {
      console.log('🔄 Applying transformations to stack viewport...');

      // For stack viewports, we need to be more careful about timing
      // and ensure transformations apply to the entire stack, not per-image

      let rotationApplied = false;
      let flipsApplied = false;

      // Method 1: Try setViewPresentation first (most reliable for stacks)
      if (rotationFlipState.rotation !== undefined && viewport.setViewPresentation) {
        try {
          viewport.setViewPresentation({
            rotation: rotationFlipState.rotation,
          });
          console.log(
            '✅ Applied stack rotation via setViewPresentation:',
            rotationFlipState.rotation
          );
          rotationApplied = true;
        } catch (error) {
          console.log('❌ Failed stack setViewPresentation rotation:', error.message);
        }
      }

      // Method 2: Try setCamera for flips and fallback rotation
      if (viewport.setCamera) {
        const cameraUpdates: any = {};

        if (rotationFlipState.flipHorizontal !== undefined) {
          cameraUpdates.flipHorizontal = rotationFlipState.flipHorizontal;
        }

        if (rotationFlipState.flipVertical !== undefined) {
          cameraUpdates.flipVertical = rotationFlipState.flipVertical;
        }

        // Add rotation to camera if setViewPresentation failed
        if (!rotationApplied && rotationFlipState.rotation !== undefined) {
          cameraUpdates.rotation = rotationFlipState.rotation;
        }

        if (Object.keys(cameraUpdates).length > 0) {
          try {
            viewport.setCamera(cameraUpdates);
            console.log('✅ Applied stack camera updates:', cameraUpdates);
            flipsApplied = true;
            if (!rotationApplied && cameraUpdates.rotation !== undefined) {
              rotationApplied = true;
            }
          } catch (error) {
            console.log('❌ Failed stack setCamera:', error.message);
          }
        }
      }

      // Force a full re-render to ensure consistency across all images in stack
      setTimeout(() => {
        if (viewport.render) {
          viewport.render();
        }

        // Additional render after a brief delay to handle any async updates
        setTimeout(() => {
          if (viewport.render) {
            viewport.render();
          }
        }, 100);
      }, 50);

      if (!rotationApplied && !flipsApplied) {
        console.log(
          '⚠️ Stack transformation application failed for viewport type:',
          viewport.constructor?.name
        );
      } else {
        console.log('✅ Stack transformations completed successfully');
      }
    } catch (error) {
      console.error('Error applying stack transformations:', error);
    }
  }

  private _applyTransformations(viewport: any, rotationFlipState: any): void {
    try {
      let rotationApplied = false;
      let flipsApplied = false;

      // Try applying rotation via different methods based on viewport type
      if (rotationFlipState.rotation !== undefined) {
        // Method 1: setViewPresentation (stack viewports)
        if (viewport.setViewPresentation) {
          try {
            viewport.setViewPresentation({
              rotation: rotationFlipState.rotation,
            });
            console.log('✅ Applied rotation via setViewPresentation:', rotationFlipState.rotation);
            rotationApplied = true;
          } catch (error) {
            console.log('❌ Failed setViewPresentation:', error.message);
          }
        }

        // Method 2: setCamera (volume viewports)
        if (!rotationApplied && viewport.setCamera) {
          try {
            viewport.setCamera({ rotation: rotationFlipState.rotation });
            console.log('✅ Applied rotation via setCamera:', rotationFlipState.rotation);
            rotationApplied = true;
          } catch (error) {
            console.log('❌ Failed setCamera rotation:', error.message);
          }
        }

        // Method 3: setProperties (fallback)
        if (!rotationApplied && viewport.setProperties) {
          try {
            viewport.setProperties({ rotation: rotationFlipState.rotation });
            console.log('✅ Applied rotation via setProperties:', rotationFlipState.rotation);
            rotationApplied = true;
          } catch (error) {
            console.log('❌ Failed setProperties rotation:', error.message);
          }
        }
      }

      // Apply flips via camera (most common method)
      if (
        viewport.setCamera &&
        (rotationFlipState.flipHorizontal !== undefined ||
          rotationFlipState.flipVertical !== undefined)
      ) {
        const cameraUpdates: any = {};

        if (rotationFlipState.flipHorizontal !== undefined) {
          cameraUpdates.flipHorizontal = rotationFlipState.flipHorizontal;
        }

        if (rotationFlipState.flipVertical !== undefined) {
          cameraUpdates.flipVertical = rotationFlipState.flipVertical;
        }

        try {
          viewport.setCamera(cameraUpdates);
          console.log('✅ Applied flips via setCamera:', cameraUpdates);
          flipsApplied = true;
        } catch (error) {
          console.log('❌ Failed setCamera flips:', error.message);
        }
      }

      // Fallback: try setViewPresentation for flips
      if (
        !flipsApplied &&
        viewport.setViewPresentation &&
        (rotationFlipState.flipHorizontal !== undefined ||
          rotationFlipState.flipVertical !== undefined)
      ) {
        try {
          const presentationUpdates: any = {};
          if (rotationFlipState.flipHorizontal !== undefined) {
            presentationUpdates.flipHorizontal = rotationFlipState.flipHorizontal;
          }
          if (rotationFlipState.flipVertical !== undefined) {
            presentationUpdates.flipVertical = rotationFlipState.flipVertical;
          }
          viewport.setViewPresentation(presentationUpdates);
          console.log('✅ Applied flips via setViewPresentation:', presentationUpdates);
          flipsApplied = true;
        } catch (error) {
          console.log('❌ Failed setViewPresentation flips:', error.message);
        }
      }

      // Final render after all transformations
      setTimeout(() => {
        if (viewport.render) {
          viewport.render();
        }
      }, 10);

      if (!rotationApplied && !flipsApplied) {
        console.log(
          '⚠️ No state application method succeeded for viewport type:',
          viewport.constructor?.name
        );
      }
    } catch (error) {
      console.error('Error applying transformations:', error);
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

    // Clear pending restorations
    this.pendingRestorations.clear();

    this.isInitialized = false;
  }

  destroy(): void {
    this.cleanup();
  }
}

export default ViewportPersistenceService;
