import { PubSubService } from '@ohif/core';
import { Enums, eventTarget } from '@cornerstonejs/core';

interface RotationFlipState {
  rotation?: number;
  flipHorizontal?: boolean;
  flipVertical?: boolean;
}

interface StoredState {
  rotationFlip: RotationFlipState;
  timestamp: number;
}

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
    create: ({ servicesManager }) => new ViewportPersistenceService({ servicesManager }),
  };

  private servicesManager: any;
  private readonly STORAGE_KEY_PREFIX = 'ohif_viewport_state_';
  private readonly RESTORE_TIMEOUT_MS = 5000;

  private subscriptions: Array<() => void> = [];
  private isInitialized = false;
  private pendingRestorations: Map<string, number> = new Map();

  // Per-viewport, per-series state for the lifetime of the page session. Each
  // viewport's rotation/flip is independent — rotating one MPR view doesn't
  // affect the others. localStorage is keyed only by series and serves as
  // the cross-session fallback when a viewport encounters a series for the
  // first time in this session.
  private viewportStates: Map<string, Map<string, StoredState>> = new Map();

  constructor({ servicesManager }) {
    super(ViewportPersistenceService.EVENTS);
    this.servicesManager = servicesManager;
  }

  init(): void {
    if (this.isInitialized) return;
    this.isInitialized = true;
    this._setupEventListeners();
  }

  private _setupEventListeners(): void {
    // VIEWPORT_NEW_IMAGE_SET: a new image set was assigned to the viewport
    // (display set switch). The viewport may not be rendered yet, so only
    // queue — actual restoration runs on the ready events below.
    const handleNewImageSet = (event: any) => {
      const viewportId = this._extractViewportId(event);
      if (viewportId) {
        this._queueRestoration(viewportId);
      }
    };

    // STACK_NEW_IMAGE: scrolling within a stack viewport. With series-level
    // hashing the stored entry doesn't depend on which slice is showing —
    // restoration only needs to run if the viewport hasn't been restored yet.
    const handleStackImageChange = (event: any) => {
      const viewportId = this._extractViewportId(event);
      if (!viewportId) return;
      if (this.pendingRestorations.has(viewportId) && this._tryRestore(viewportId)) {
        this.pendingRestorations.delete(viewportId);
      }
    };

    // Viewport-is-ready events: drain pending restorations.
    // - IMAGE_RENDERED: stack viewports are renderable
    // - VOLUME_VIEWPORT_NEW_VOLUME: volume viewport has mounted a new volume
    //   actor and is ready for setViewPresentation()
    const handleViewportReady = (event: any) => {
      const viewportId = this._extractViewportId(event);
      if (!viewportId) return;
      if (this.pendingRestorations.has(viewportId) && this._tryRestore(viewportId)) {
        this.pendingRestorations.delete(viewportId);
      }
    };

    eventTarget.addEventListener(Enums.Events.VIEWPORT_NEW_IMAGE_SET, handleNewImageSet);
    eventTarget.addEventListener(Enums.Events.STACK_NEW_IMAGE, handleStackImageChange);
    eventTarget.addEventListener(Enums.Events.IMAGE_RENDERED, handleViewportReady);
    eventTarget.addEventListener(Enums.Events.VOLUME_VIEWPORT_NEW_VOLUME, handleViewportReady);

    this.subscriptions.push(
      () => eventTarget.removeEventListener(Enums.Events.VIEWPORT_NEW_IMAGE_SET, handleNewImageSet),
      () => eventTarget.removeEventListener(Enums.Events.STACK_NEW_IMAGE, handleStackImageChange),
      () => eventTarget.removeEventListener(Enums.Events.IMAGE_RENDERED, handleViewportReady),
      () => eventTarget.removeEventListener(Enums.Events.VOLUME_VIEWPORT_NEW_VOLUME, handleViewportReady)
    );
  }

  private _extractViewportId(event: any): string | null {
    return (
      event?.detail?.viewportId ??
      event?.detail?.viewport?.id ??
      event?.detail?.element?.id ??
      null
    );
  }

  // Retry the apply step after a short delay. Used when cs3d's actor isn't
  // ready yet and the apply silently no-ops (verified via getCamera /
  // getViewPresentation comparison). Stops automatically when the viewport
  // is no longer in pendingRestorations — either because a retry succeeded
  // or because the queue timeout fired (5s safety net).
  private _scheduleApplyRetry(viewportId: string): void {
    setTimeout(() => {
      if (!this.pendingRestorations.has(viewportId)) return;
      if (this._tryRestore(viewportId)) {
        this.pendingRestorations.delete(viewportId);
      }
      // On continued failure, _tryRestore schedules its own next retry.
    }, 100);
  }

  private _queueRestoration(viewportId: string): void {
    this.pendingRestorations.set(viewportId, Date.now());
    setTimeout(() => {
      const queuedAt = this.pendingRestorations.get(viewportId);
      if (queuedAt !== undefined && Date.now() - queuedAt >= this.RESTORE_TIMEOUT_MS) {
        this.pendingRestorations.delete(viewportId);
        // Always broadcast so the visibility state machine in
        // OHIFCornerstoneViewport.tsx unhides the viewport.
        this._broadcastEvent(ViewportPersistenceService.EVENTS.VIEWPORT_STATE_RESTORED, {
          viewportId,
          hash: null,
          state: null,
          timeout: true,
        });
      }
    }, this.RESTORE_TIMEOUT_MS);
  }

  generateViewportHash(viewport: any): string | null {
    try {
      let currentImageId = viewport.getCurrentImageId?.();
      if (!currentImageId && viewport.getImageIds) {
        const imageIds = viewport.getImageIds();
        const idx = viewport.getCurrentImageIdIndex?.() ?? 0;
        currentImageId = imageIds[idx] ?? imageIds[0];
      }
      if (!currentImageId) return null;

      const uids = this._extractUIDsFromImageId(currentImageId);
      if (!uids?.studyUID || !uids?.seriesUID) return null;

      // Hash by study+series only. Rotation/flip are viewport-level state in
      // cs3d 4.x (they apply to the entire series), not per-image. Hashing
      // per-instance caused state to be stored under one slice's hash while
      // restore keyed off a different slice's hash — e.g. flipping vertically
      // on a volume-backed stack navigates to a different slice mid-command.
      return `${uids.studyUID}-${uids.seriesUID}`;
    } catch (error) {
      console.error('Error generating viewport hash:', error);
      return null;
    }
  }

  private _extractUIDsFromImageId(
    imageId: string
  ): { studyUID: string; seriesUID: string; instanceUID: string } | null {
    try {
      const dicomWebMatch = imageId.match(
        /studies\/([^\/]+)\/series\/([^\/]+)\/instances\/([^\/]+)/
      );
      if (dicomWebMatch) {
        return {
          studyUID: dicomWebMatch[1],
          seriesUID: dicomWebMatch[2],
          instanceUID: dicomWebMatch[3],
        };
      }

      const wadouriMatch = imageId.match(
        /studyUID=([^&]+).*?seriesUID=([^&]+).*?objectUID=([^&]+)/
      );
      if (wadouriMatch) {
        return {
          studyUID: wadouriMatch[1],
          seriesUID: wadouriMatch[2],
          instanceUID: wadouriMatch[3],
        };
      }

      return null;
    } catch {
      return null;
    }
  }

  public storeRotationFlipState(
    viewportId: string,
    opts: { fromUserAction?: boolean } = {}
  ): void {
    const { fromUserAction = false } = opts;

    // Only persist state from explicit user actions (rotate/flip commands).
    // Event-driven callers (volume mount timers, displaySet transitions, etc.)
    // capture cs3d's intrinsic camera state — which in cs3d 4.x includes
    // acquisition-orientation rotations applied automatically for tilted
    // series. Persisting that state would replay it as if it were user
    // intent, causing pointless apply/verify cycles on revisit.
    if (!fromUserAction) {
      return;
    }

    const { cornerstoneViewportService } = this.servicesManager.services;
    try {
      const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
      if (!viewport) return;

      const hash = this.generateViewportHash(viewport);
      const state = this._extractRotationFlipState(viewport);
      if (!hash || !state) return;

      this._setInSessionState(viewportId, hash, state);
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

  private _isDefaultRotationFlip(state: RotationFlipState | undefined): boolean {
    if (!state) return true;
    const rotationIsDefault = state.rotation === undefined || state.rotation === 0;
    return rotationIsDefault && !state.flipHorizontal && !state.flipVertical;
  }

  public checkIfRestorationNeeded(viewportId: string): boolean {
    const { cornerstoneViewportService } = this.servicesManager.services;
    try {
      const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
      if (!viewport) return false;

      const hash = this.generateViewportHash(viewport);
      if (!hash) return false;

      const stored = this._getViewportState(hash);
      if (!stored?.rotationFlip) return false;

      const current = this._extractRotationFlipState(viewport);
      return !this._statesMatch(current?.rotationFlip, stored.rotationFlip);
    } catch {
      return false;
    }
  }

  public attemptViewportRestoration(viewportId: string): void {
    if (this._tryRestore(viewportId)) {
      this.pendingRestorations.delete(viewportId);
      return;
    }
    // Viewport not ready yet — wait for the next viewport-ready event.
    this._queueRestoration(viewportId);
  }

  // Returns true iff we either applied state or definitively determined
  // there was nothing to apply (and thus broadcast the RESTORED event).
  private _tryRestore(viewportId: string): boolean {
    const { cornerstoneViewportService } = this.servicesManager.services;
    try {
      const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
      if (!viewport) return false;

      const hash = this.generateViewportHash(viewport);
      if (!hash) {
        // Viewport not ready (no current imageId yet). Try again later.
        return false;
      }

      // In-session state (per-viewport) takes precedence over localStorage
      // (per-series). This is what keeps MPR / multi-viewport same-series
      // setups independent within a session: rotating viewport A stores
      // under A's in-session entry; viewport B's in-session entry for the
      // same series is unaffected.
      const inSession = this._getInSessionState(viewportId, hash);
      const stored = inSession?.rotationFlip ? null : this._getViewportState(hash);
      const partial =
        inSession?.rotationFlip || stored?.rotationFlip ? null : this._findPartialMatch(hash);
      const target = inSession?.rotationFlip ?? stored?.rotationFlip ?? partial;

      if (!target || this._isDefaultRotationFlip(target)) {
        // Nothing to restore (or stored state is the default unrotated /
        // unflipped state, which is what a fresh viewport already has).
        // Broadcast immediately so visibility unhides — no apply, no retries.
        this._broadcastEvent(ViewportPersistenceService.EVENTS.VIEWPORT_STATE_RESTORED, {
          viewportId,
          hash,
          state: null,
          noStoredState: true,
        });
        return true;
      }

      if (
        typeof viewport.setViewPresentation !== 'function' ||
        typeof viewport.getViewPresentation !== 'function'
      ) {
        // setViewPresentation should always exist in cs3d 4.x for both stack
        // and volume viewports. If missing, we can't safely restore.
        return false;
      }

      // Apply flips via setCamera. This is the same path the user-facing
      // flipViewport commands use. cs3d 4.x's flip() silently early-returns
      // when getDefaultImageData() is null — which happens on the first
      // IMAGE_RENDERED tick before the volume actor's mapper input is ready.
      // We verify the apply actually took effect below; if not, we schedule
      // a retry rather than relying on subsequent events firing (they often
      // don't on initial load).
      if (target.flipHorizontal !== undefined || target.flipVertical !== undefined) {
        const cameraUpdates: any = {};
        if (target.flipHorizontal !== undefined) {
          cameraUpdates.flipHorizontal = target.flipHorizontal;
        }
        if (target.flipVertical !== undefined) {
          cameraUpdates.flipVertical = target.flipVertical;
        }
        viewport.setCamera?.(cameraUpdates);

        const cameraAfter = viewport.getCamera?.();
        // Normalize undefined → false. cs3d's getCamera() doesn't always
        // populate flip fields on freshly-mounted viewports, but undefined
        // is semantically equivalent to "no flip" (false).
        const normalizeFlip = (v: any) => v === true;
        const flipsApplied =
          (target.flipHorizontal === undefined ||
            normalizeFlip(cameraAfter?.flipHorizontal) ===
              normalizeFlip(target.flipHorizontal)) &&
          (target.flipVertical === undefined ||
            normalizeFlip(cameraAfter?.flipVertical) ===
              normalizeFlip(target.flipVertical));
        if (!flipsApplied) {
          this._scheduleApplyRetry(viewportId);
          return false;
        }
      }

      // Apply rotation via setViewPresentation. Spread current presentation so
      // unspecified fields (displayArea, zoom, pan, flipH, flipV) keep their
      // values — passing only rotation triggers setDisplayArea(undefined) and
      // can wipe other state on multi-image stacks.
      if (target.rotation !== undefined) {
        const nextPresentation: any = {
          ...viewport.getViewPresentation(),
          rotation: target.rotation,
        };
        viewport.setViewPresentation(nextPresentation);

        const presentationAfter = viewport.getViewPresentation?.();
        if (
          presentationAfter?.rotation !== undefined &&
          target.rotation !== presentationAfter.rotation
        ) {
          this._scheduleApplyRetry(viewportId);
          return false;
        }
      }

      viewport.render?.();

      // Remember the just-applied state in-session so this viewport keeps
      // its independent rotation/flip across displaySet navigation within
      // the session, regardless of what localStorage holds for the series.
      this._setInSessionState(viewportId, hash, {
        rotationFlip: target,
        timestamp: Date.now(),
      });

      // Promote a partial match into a direct entry so future loads are exact.
      if (!stored) {
        this._storeViewportState(hash, { rotationFlip: target, timestamp: Date.now() });
      }

      this._broadcastEvent(ViewportPersistenceService.EVENTS.VIEWPORT_STATE_RESTORED, {
        viewportId,
        hash,
        state: { rotationFlip: target, timestamp: Date.now() },
      });
      return true;
    } catch (error) {
      console.error('Error restoring viewport state:', error);
      return false;
    }
  }

  // Look for legacy per-instance entries stored under `<study>-<series>-<instance>`
  // before we switched to series-level hashing. Used as a fallback so users
  // don't lose previously-persisted rotation/flip after the format change.
  private _findPartialMatch(hash: string): RotationFlipState | null {
    try {
      const legacyPrefix = `${this.STORAGE_KEY_PREFIX}${hash}-`;

      let mostRecent: { state: RotationFlipState; timestamp: number } | null = null;
      for (const key of Object.keys(localStorage)) {
        if (!key.startsWith(legacyPrefix)) continue;
        try {
          const parsed = JSON.parse(localStorage.getItem(key) || '{}') as Partial<StoredState>;
          if (parsed?.rotationFlip) {
            const ts = parsed.timestamp ?? 0;
            if (!mostRecent || ts > mostRecent.timestamp) {
              mostRecent = { state: parsed.rotationFlip, timestamp: ts };
            }
          }
        } catch {
          // ignore malformed entry
        }
      }
      return mostRecent?.state ?? null;
    } catch {
      return null;
    }
  }

  private _statesMatch(
    current: RotationFlipState | undefined,
    stored: RotationFlipState
  ): boolean {
    if (!current || !stored) return false;
    return (
      current.rotation === stored.rotation &&
      current.flipHorizontal === stored.flipHorizontal &&
      current.flipVertical === stored.flipVertical
    );
  }

  private _extractRotationFlipState(viewport: any): StoredState | null {
    try {
      if (typeof viewport.getViewPresentation !== 'function') return null;
      const presentation = viewport.getViewPresentation();

      const rotationFlip: RotationFlipState = {};
      if (presentation?.rotation !== undefined) rotationFlip.rotation = presentation.rotation;
      if (presentation?.flipHorizontal !== undefined) {
        rotationFlip.flipHorizontal = presentation.flipHorizontal;
      }
      if (presentation?.flipVertical !== undefined) {
        rotationFlip.flipVertical = presentation.flipVertical;
      }

      if (Object.keys(rotationFlip).length === 0) return null;
      return { rotationFlip, timestamp: Date.now() };
    } catch (error) {
      console.error('Error extracting rotation/flip state:', error);
      return null;
    }
  }

  private _getInSessionState(viewportId: string, hash: string): StoredState | null {
    return this.viewportStates.get(viewportId)?.get(hash) ?? null;
  }

  private _setInSessionState(viewportId: string, hash: string, state: StoredState): void {
    let viewportMap = this.viewportStates.get(viewportId);
    if (!viewportMap) {
      viewportMap = new Map();
      this.viewportStates.set(viewportId, viewportMap);
    }
    viewportMap.set(hash, state);
  }

  private _clearInSessionState(viewportId: string, hash: string): void {
    this.viewportStates.get(viewportId)?.delete(hash);
  }

  private _storeViewportState(hash: string, state: StoredState): void {
    try {
      localStorage.setItem(`${this.STORAGE_KEY_PREFIX}${hash}`, JSON.stringify(state));
    } catch (error) {
      console.error('Error storing to localStorage:', error);
    }
  }

  private _getViewportState(hash: string): StoredState | null {
    try {
      const raw = localStorage.getItem(`${this.STORAGE_KEY_PREFIX}${hash}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  cleanupInvalidStates(): void {
    try {
      const keys = Object.keys(localStorage).filter(key =>
        key.startsWith(this.STORAGE_KEY_PREFIX)
      );
      keys.forEach(key => {
        try {
          const parsed = JSON.parse(localStorage.getItem(key) || '{}');
          if (!parsed?.rotationFlip) {
            localStorage.removeItem(key);
          }
        } catch {
          localStorage.removeItem(key);
        }
      });
    } catch {
      // ignore
    }
  }

  clearViewportState(hash: string): void {
    try {
      localStorage.removeItem(`${this.STORAGE_KEY_PREFIX}${hash}`);
    } catch {
      // ignore
    }
  }

  // Clear every stored entry for the same study+series as the viewport's
  // current image. Called from `resetViewport` so that "reset" actually means
  // "back to default" — including across page reloads. Wipes both the new
  // series-level entry and any legacy per-instance entries.
  clearSeriesStateForViewport(viewportId: string): void {
    const { cornerstoneViewportService } = this.servicesManager.services;
    try {
      const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
      if (!viewport) return;

      const hash = this.generateViewportHash(viewport);
      if (!hash) return;

      this._clearInSessionState(viewportId, hash);

      const directKey = `${this.STORAGE_KEY_PREFIX}${hash}`;
      const legacyPrefix = `${this.STORAGE_KEY_PREFIX}${hash}-`;

      Object.keys(localStorage)
        .filter(key => key === directKey || key.startsWith(legacyPrefix))
        .forEach(key => localStorage.removeItem(key));
    } catch (error) {
      console.error('Error clearing series state:', error);
    }
  }

  clearAllViewportStates(): void {
    try {
      Object.keys(localStorage)
        .filter(key => key.startsWith(this.STORAGE_KEY_PREFIX))
        .forEach(key => localStorage.removeItem(key));
    } catch {
      // ignore
    }
  }

  getAllViewportStates(): Record<string, StoredState> {
    const states: Record<string, StoredState> = {};
    try {
      Object.keys(localStorage)
        .filter(key => key.startsWith(this.STORAGE_KEY_PREFIX))
        .forEach(key => {
          const hash = key.replace(this.STORAGE_KEY_PREFIX, '');
          try {
            states[hash] = JSON.parse(localStorage.getItem(key) || '{}');
          } catch {
            // ignore malformed entry
          }
        });
    } catch {
      // ignore
    }
    return states;
  }

  cleanup(): void {
    this.subscriptions.forEach(unsub => {
      try {
        unsub();
      } catch {
        // ignore
      }
    });
    this.subscriptions = [];
    this.pendingRestorations.clear();
    this.viewportStates.clear();
    this.isInitialized = false;
  }

  destroy(): void {
    this.cleanup();
  }
}

export default ViewportPersistenceService;
