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
    }, 3000); // 3 seconds should be enough for initial app setup
  }

  private _setupEventListeners(): void {
    // Restoration is NOT triggered from VIEWPORT_NEW_IMAGE_SET: that event
    // fires mid-setStack, before OHIF applies presentations (zoom/pan) and
    // before the autoTrimBorders autozoom runs off IMAGE_RENDERED. Restoring
    // there applies rotation/flip early, which mirrors the pan and makes the
    // auto-trim's user-override guard in OHIFCornerstoneViewport read it as a
    // manual adjustment and skip the autozoom. OHIFCornerstoneViewport
    // triggers restoration after the displaySet change instead.
    //
    // This listener is only a retry net for restorations attempted before
    // image data was ready. It resolves viewports via event.detail.viewportId
    // (the viewport div never gets an id attribute, so element.id is always
    // empty), fires for stack and volume viewports alike, and
    // _handleViewportReady only acts while a restoration is pending.
    const imageRenderedHandler = (event: any) => {
      const viewportId = event.detail?.viewportId;
      if (viewportId) {
        this._handleViewportReady(viewportId);
      }
    };

    eventTarget.addEventListener(Enums.Events.IMAGE_RENDERED, imageRenderedHandler);

    this.subscriptions.push(() =>
      eventTarget.removeEventListener(Enums.Events.IMAGE_RENDERED, imageRenderedHandler)
    );
  }

  private _handleViewportReady(viewportId: string): void {
    if (!this.pendingRestorations.has(viewportId)) {
      return;
    }

    // Small delay to ensure viewport is fully stabilized
    setTimeout(() => {
      if (this.pendingRestorations.has(viewportId)) {
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
        return null;
      }

      const imageUids = this._extractUIDsFromImageId(currentImageId);

      if (!imageUids?.studyUID || !imageUids?.seriesUID || !imageUids?.instanceUID) {
        return null;
      }

      const hash = `${imageUids.studyUID}-${imageUids.seriesUID}-${imageUids.instanceUID}`;

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

      // Check if current state matches stored state
      const currentState = this._extractRotationFlipState(viewport);
      return !this._statesMatch(currentState?.rotationFlip, storedState.rotationFlip);
    } catch (error) {
      return false;
    }
  }

  public attemptViewportRestoration(viewportId: string): void {
    // Add to pending restorations for event-based handling
    this.pendingRestorations.set(viewportId, {
      viewportId,
      timestamp: Date.now(),
    });

    // Try immediate restoration first
    if (this._restoreViewportState(viewportId)) {
      // Success - remove from pending and we're done
      this.pendingRestorations.delete(viewportId);
      return;
    }

    // If immediate restoration fails, the viewport will be restored via events

    // Fallback: remove from pending after timeout to prevent memory leaks
    // Longer timeout for stack viewports that might be multi-frame (CT scans)
    const timeout = 8000; // 8 second timeout for slow-loading images
    setTimeout(() => {
      if (this.pendingRestorations.has(viewportId)) {
        this.pendingRestorations.delete(viewportId);
      }
    }, timeout);
  }

  private _restoreViewportStateWithRetry(viewportId: string, retryCount: number): void {
    const maxRetries = 5;
    const retryDelay = 25; // Further reduced retry delay for faster restoration

    if (this._restoreViewportState(viewportId)) {
      // Success - restoration completed
      this.pendingRestorations.delete(viewportId);

      if (this.isInitialLoad && retryCount === 0) {
        // For initial load, add an additional restoration attempt
        setTimeout(() => {
          this._restoreViewportState(viewportId);
        }, 800);
      }
      return;
    }

    // If restoration failed and we have retries left
    if (retryCount < maxRetries) {
      setTimeout(() => {
        this._restoreViewportStateWithRetry(viewportId, retryCount + 1);
      }, retryDelay);
    }
  }

  private _restoreViewportState(viewportId: string): boolean {
    const { cornerstoneViewportService } = this.servicesManager.services;

    try {
      const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
      if (!viewport?.getCurrentImageId?.()) {
        return false;
      }

      // Wait for image data to be available before restoration (fixes CT/MRI issues)
      const imageData = viewport.getImageData?.();
      if (!imageData) {
        return false;
      }

      const hash = this.generateViewportHash(viewport);
      if (!hash) {
        // Even if we can't generate hash, broadcast completion to clear black screen with same delay
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

      const storedState = this._getViewportState(hash);
      if (!storedState?.rotationFlip) {
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

            // Wait for the application to complete before broadcasting
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

        // Store default state for this image
        const defaultState = this._extractRotationFlipState(viewport);
        if (defaultState) {
          this._storeViewportState(hash, defaultState);

          // Apply the default state (even though it's the same) to ensure uniformity
          this._applyViewportState(viewport, defaultState);

          // Wait for the application to complete before broadcasting
          setTimeout(() => {
            this._broadcastEvent(ViewportPersistenceService.EVENTS.VIEWPORT_STATE_RESTORED, {
              viewportId,
              hash,
              state: defaultState,
              wasDefault: true,
            });
          }, 200); // Same delay as transformed images for uniformity
        } else {
          // No stored state found, broadcast completion to clear black screen
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

      // Apply stored state regardless of current state
      this._applyViewportState(viewport, storedState);

      // Wait for the application to complete before broadcasting
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
      // Even on error, broadcast completion to clear black screen with same delay
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

      // Special handling for stack viewports with multiple images (like CT stacks)
      const isStackViewport = viewport.constructor?.name === 'StackViewport';
      const imageIds = viewport.getImageIds?.() || [];
      const isMultiImageStack = isStackViewport && imageIds.length > 1;

      if (isMultiImageStack) {
        this._applyStackTransformations(viewport, state.rotationFlip);
      } else {
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
      // For stack viewports, we need to be more careful about timing
      // and ensure transformations apply to the entire stack, not per-image

      const applied = this._applyFlipsThenRotation(viewport, rotationFlipState);

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

      if (!applied) {
        console.warn(
          '⚠️ Stack transformation application failed for viewport type:',
          viewport.constructor?.name
        );
      }
    } catch (error) {
      console.error('Error applying stack transformations:', error);
    }
  }

  private _applyTransformations(viewport: any, rotationFlipState: any): void {
    try {
      const applied = this._applyFlipsThenRotation(viewport, rotationFlipState);

      // Final render after all transformations
      setTimeout(() => {
        if (viewport.render) {
          viewport.render();
        }
      }, 10);

      if (!applied) {
        console.warn(
          '⚠️ No state application method succeeded for viewport type:',
          viewport.constructor?.name
        );
      }
    } catch (error) {
      console.error('Error applying transformations:', error);
    }
  }

  /**
   * Applies flips BEFORE rotation. The stored rotation was read from
   * getRotation()/getViewPresentation() on the flipped viewport, and a flip
   * negates viewPlaneNormal, inverting the sign getRotation() reports. The
   * value only reproduces the saved camera when re-applied in the same flip
   * state it was measured in; rotating first lands 2×rotation (180° for a
   * 90° rotation) away and alternates on every save/restore cycle.
   *
   * Values that already match the viewport are NOT re-applied:
   * setViewPresentation unconditionally re-runs setRotation, whose
   * pan-preservation math mixes getPan(fitToCanvasCamera) with getPan()
   * (initialCamera-relative). After the autozoom displayArea is set with
   * storeAsInitialCamera, those reference cameras diverge and a redundant
   * setRotation collapses a presentation-restored manual pan.
   */
  private _applyFlipsThenRotation(viewport: any, rotationFlipState: any): boolean {
    const { rotation, flipHorizontal, flipVertical } = rotationFlipState;

    let currentFlipH;
    let currentFlipV;
    let currentRotation;
    try {
      const camera = viewport.getCamera?.() ?? {};
      currentFlipH = camera.flipHorizontal;
      currentFlipV = camera.flipVertical;
      currentRotation = viewport.getViewPresentation?.()?.rotation ?? camera.rotation;
    } catch (error) {
      // Leave current state unknown — everything will be applied below.
    }

    const flipHChanged = flipHorizontal !== undefined && flipHorizontal !== currentFlipH;
    const flipVChanged = flipVertical !== undefined && flipVertical !== currentFlipV;
    const rotationDelta =
      rotation !== undefined && currentRotation !== undefined
        ? (((rotation - currentRotation) % 360) + 360) % 360
        : undefined;
    const rotationChanged =
      rotation !== undefined &&
      (rotationDelta === undefined || (rotationDelta > 0.01 && rotationDelta < 359.99));

    const updates: any = {};
    if (flipHChanged || flipVChanged) {
      // A flip changes the frame rotation is measured in, so rotation must be
      // re-applied whenever a flip changes, even when numerically equal.
      if (flipHorizontal !== undefined) {
        updates.flipHorizontal = flipHorizontal;
      }
      if (flipVertical !== undefined) {
        updates.flipVertical = flipVertical;
      }
      if (rotation !== undefined) {
        updates.rotation = rotation;
      }
    } else if (rotationChanged) {
      updates.rotation = rotation;
    }

    if (Object.keys(updates).length === 0) {
      return true;
    }

    // The pan present at restore time was set by OHIF's presentation restore
    // and is already expressed in the final (transformed) frame; cs3d's flip()
    // would mirror it a second time. Preserve the exact screen pan across the
    // apply. (When the autozoom later re-runs it recomputes centering from
    // scratch, so pre-transform trim pans are corrected there.)
    let preservedPan;
    try {
      preservedPan = viewport.getPan?.();
    } catch (error) {
      preservedPan = undefined;
    }

    const restorePan = () => {
      if (!preservedPan || !viewport.setPan) {
        return;
      }
      try {
        viewport.setPan(preservedPan);
      } catch (error) {
        // Keep whatever pan the apply produced.
      }
    };

    // Preferred: a single setViewPresentation call — cornerstone3d applies
    // flips before rotation internally.
    if (viewport.setViewPresentation) {
      try {
        viewport.setViewPresentation(updates);
        restorePan();
        return true;
      } catch (error) {
        console.warn('❌ Failed setViewPresentation:', error.message);
      }
    }

    // Fallback: setCamera for flips first, then setRotation/setProperties.
    let flipsApplied = false;
    let rotationApplied = false;

    if (
      viewport.setCamera &&
      (updates.flipHorizontal !== undefined || updates.flipVertical !== undefined)
    ) {
      const cameraUpdates: any = {};
      if (updates.flipHorizontal !== undefined) {
        cameraUpdates.flipHorizontal = updates.flipHorizontal;
      }
      if (updates.flipVertical !== undefined) {
        cameraUpdates.flipVertical = updates.flipVertical;
      }

      try {
        viewport.setCamera(cameraUpdates);
        flipsApplied = true;
      } catch (error) {
        console.warn('❌ Failed setCamera flips:', error.message);
      }
    }

    if (updates.rotation !== undefined) {
      if (viewport.setRotation) {
        try {
          viewport.setRotation(updates.rotation);
          rotationApplied = true;
        } catch (error) {
          console.warn('❌ Failed setRotation:', error.message);
        }
      }

      if (!rotationApplied && viewport.setProperties) {
        try {
          viewport.setProperties({ rotation: updates.rotation });
          rotationApplied = true;
        } catch (error) {
          console.warn('❌ Failed setProperties rotation:', error.message);
        }
      }
    }

    if (flipsApplied || rotationApplied) {
      restorePan();
    }

    return flipsApplied || rotationApplied;
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
