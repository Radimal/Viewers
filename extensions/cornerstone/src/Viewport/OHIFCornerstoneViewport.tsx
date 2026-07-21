import React, { useEffect, useRef, useCallback, useState } from 'react';
import { useResizeDetector } from 'react-resize-detector';
import * as cs3DTools from '@cornerstonejs/tools';
import { cache, Enums, eventTarget, getEnabledElement } from '@cornerstonejs/core';
import { MeasurementService } from '@ohif/core';
import {
  AllInOneMenu,
  LoadingIndicatorTotalPercent,
  Notification,
  useViewportDialog,
} from '@ohif/ui';
import type { Types as csTypes } from '@cornerstonejs/core';

import { setEnabledElement } from '../state';

import './OHIFCornerstoneViewport.css';
import CornerstoneOverlays from './Overlays/CornerstoneOverlays';
import CinePlayer from '../components/CinePlayer';
import type { Types } from '@ohif/core';

import OHIFViewportActionCorners from '../components/OHIFViewportActionCorners';
import { getWindowLevelActionMenu } from '../components/WindowLevelActionMenu/getWindowLevelActionMenu';
import { useAppConfig } from '@state';
import { getViewportDataOverlaySettingsMenu } from '../components/ViewportDataOverlaySettingMenu';
import { getViewportPresentations } from '../utils/presentations/getViewportPresentations';
import { useSynchronizersStore } from '../stores/useSynchronizersStore';
import ActiveViewportBehavior from '../utils/ActiveViewportBehavior';

const STACK = 'stack';

/** The default volume loader scheme used to build volumeIds (see CornerstoneCacheService). */
const DEFAULT_VOLUME_LOADER_SCHEME = 'cornerstoneStreamingImageVolume';

/**
 * Minimum number of images in a stack before the loading overlay switches
 * from the indeterminate bar to a real "Loaded X of Y" percent. Small stacks
 * (single-frame CR/DX etc.) load too fast for a percent to be useful, so
 * they keep the current indeterminate look and fast reveal.
 */
const MIN_STACK_IMAGES_FOR_PROGRESS = 10;

/**
 * Caches the jump to measurement operation, so that if display set is shown,
 * it can jump to the measurement.
 */
let cacheJumpToMeasurementEvent;

/**
 * The canonical "untouched" zoom/pan per displaySet: snapshotted right after a
 * trim (autozoom) completes and refreshed after every rotate/flip command.
 * cs3d zoom/pan numbers are only comparable within the same camera reference
 * frame — the trim re-bases the viewport's initialCamera
 * (storeAsInitialCamera) and a rotation then shifts the MEASURED pan even
 * though the user touched nothing — so every comparison in this file is
 * current-camera vs this baseline, never across transform changes.
 */
const baselineViewCache = new Map<string, { zoom: number; panX: number; panY: number }>();

/**
 * The user's manual zoom/pan, stored as a DELTA from that visit's untouched
 * baseline (zoom ratio + pan offset). Autozoom always runs as the foundation
 * on every visit — skipping it would leave the view at the mercy of stale
 * reference cameras (resetCamera auto-re-applies the viewport's last
 * options.displayArea, which may belong to a different image) — and the
 * delta is re-applied on top. Delta arithmetic is same-frame at both ends:
 * measured against the leave visit's post-trim baseline, applied onto the
 * return visit's post-trim camera.
 */
const manualViewCache = new Map<string, { zoomRatio: number; panDX: number; panDY: number }>();

// Todo: This should be done with expose of internal API similar to react-vtkjs-viewport
// Then we don't need to worry about the re-renders if the props change.
const OHIFCornerstoneViewport = React.memo(
  (
    props: withAppTypes<{
      viewportId: string;
      displaySets: AppTypes.DisplaySet[];
      viewportOptions: AppTypes.ViewportGrid.GridViewportOptions;
      initialImageIndex: number;
    }>
  ) => {
    const {
      displaySets,
      dataSource,
      viewportOptions,
      displaySetOptions,
      servicesManager,
      commandsManager,
      onElementEnabled,
      // eslint-disable-next-line react/prop-types
      onElementDisabled,
      isJumpToMeasurementDisabled = false,
      // Note: you SHOULD NOT use the initialImageIdOrIndex for manipulation
      // of the imageData in the OHIFCornerstoneViewport. This prop is used
      // to set the initial state of the viewport's first image to render
      // eslint-disable-next-line react/prop-types
      initialImageIndex,
      // if the viewport is part of a hanging protocol layout
      // we should not really rely on the old synchronizers and
      // you see below we only rehydrate the synchronizers if the viewport
      // is not part of the hanging protocol layout. HPs should
      // define their own synchronizers. Since the synchronizers are
      // viewportId dependent and
      // eslint-disable-next-line react/prop-types
      isHangingProtocolLayout,
    } = props;
    const viewportId = viewportOptions.viewportId;


    if (!viewportId) {
      throw new Error('Viewport ID is required');
    }

    // Make sure displaySetOptions has one object per displaySet
    while (displaySetOptions.length < displaySets.length) {
      displaySetOptions.push({});
    }

    // Since we only have support for dynamic data in volume viewports, we should
    // handle this case here and set the viewportType to volume if any of the
    // displaySets are dynamic volumes
    viewportOptions.viewportType = displaySets.some(
      ds => ds.isDynamicVolume && ds.isReconstructable
    )
      ? 'volume'
      : viewportOptions.viewportType;

    const [scrollbarHeight, setScrollbarHeight] = useState('100px');
    const [enabledVPElement, setEnabledVPElement] = useState(null);
    // Start hidden behind the loading overlay until rotation/flip restoration has run
    const [showLoadingOverlay, setShowLoadingOverlay] = useState(true);
    // Frames/images loaded so far for this viewport's displaySets; null when
    // there is no reliable progress signal (the overlay bar then stays
    // indeterminate, exactly as before).
    const [loadProgress, setLoadProgress] = useState<{
      loaded: number;
      total: number;
      targetText: string;
    } | null>(null);

    const elementRef = useRef() as React.MutableRefObject<HTMLDivElement>;
    const [appConfig] = useAppConfig();

    const {
      displaySetService,
      toolbarService,
      toolGroupService,
      syncGroupService,
      cornerstoneViewportService,
      segmentationService,
      cornerstoneCacheService,
      viewportActionCornersService,
      viewportPersistenceService,
    } = servicesManager.services;

    const [viewportDialogState] = useViewportDialog();
    // useCallback for scroll bar height calculation
    const setImageScrollBarHeight = useCallback(() => {
      const scrollbarHeight = `${elementRef.current.clientHeight - 40}px`;
      setScrollbarHeight(scrollbarHeight);
    }, [elementRef]);

    // useCallback for onResize
    const onResize = useCallback(() => {
      if (elementRef.current) {
        cornerstoneViewportService.resize();
        setImageScrollBarHeight();
      }
    }, [elementRef]);

    const cleanUpServices = useCallback(
      viewportInfo => {
        const renderingEngineId = viewportInfo.getRenderingEngineId();
        const syncGroups = viewportInfo.getSyncGroups();

        toolGroupService.removeViewportFromToolGroup(viewportId, renderingEngineId);
        syncGroupService.removeViewportFromSyncGroup(viewportId, renderingEngineId, syncGroups);

        segmentationService.clearSegmentationRepresentations(viewportId);

        viewportActionCornersService.clear(viewportId);
      },
      [
        viewportId,
        segmentationService,
        syncGroupService,
        toolGroupService,
        viewportActionCornersService,
      ]
    );

    const elementEnabledHandler = useCallback(
      evt => {
        // check this is this element reference and return early if doesn't match
        if (evt.detail.element !== elementRef.current) {
          return;
        }

        const { viewportId, element } = evt.detail;
        const viewportInfo = cornerstoneViewportService.getViewportInfo(viewportId);
        setEnabledElement(viewportId, element);
        setEnabledVPElement(element);

        const renderingEngineId = viewportInfo.getRenderingEngineId();
        const toolGroupId = viewportInfo.getToolGroupId();
        const syncGroups = viewportInfo.getSyncGroups();

        toolGroupService.addViewportToToolGroup(viewportId, renderingEngineId, toolGroupId);

        syncGroupService.addViewportToSyncGroup(viewportId, renderingEngineId, syncGroups);

        // we don't need reactivity here so just use state
        const { synchronizersStore } = useSynchronizersStore.getState();
        if (synchronizersStore?.[viewportId]?.length && !isHangingProtocolLayout) {
          // If the viewport used to have a synchronizer, re apply it again
          _rehydrateSynchronizers(viewportId, syncGroupService);
        }

        if (onElementEnabled && typeof onElementEnabled === 'function') {
          onElementEnabled(evt);
        }
      },
      [viewportId, onElementEnabled, toolGroupService]
    );

    // disable the element upon unmounting
    useEffect(() => {
      cornerstoneViewportService.enableViewport(viewportId, elementRef.current);

      eventTarget.addEventListener(Enums.Events.ELEMENT_ENABLED, elementEnabledHandler);

      setImageScrollBarHeight();

      return () => {
        const viewportInfo = cornerstoneViewportService.getViewportInfo(viewportId);

        if (!viewportInfo) {
          return;
        }

        cornerstoneViewportService.storePresentation({ viewportId });

        // This should be done after the store presentation since synchronizers
        // will get cleaned up and they need the viewportInfo to be present
        cleanUpServices(viewportInfo);

        if (onElementDisabled && typeof onElementDisabled === 'function') {
          onElementDisabled(viewportInfo);
        }

        cornerstoneViewportService.disableElement(viewportId);

        eventTarget.removeEventListener(Enums.Events.ELEMENT_ENABLED, elementEnabledHandler);
      };
    }, []);

    useEffect(() => {
      const element = elementRef.current;

      if (!element || !viewportPersistenceService || !cornerstoneViewportService) return;

      const handleRotationFlip = (evt: Event) => {
        try {
          const csViewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
          if (csViewport) {
            viewportPersistenceService.storeRotationFlipState(viewportId);
          }
        } catch (error) {
          console.error('Error handling rotation/flip change:', error);
        }
      };

      const rotationFlipEvents = [
        'CORNERSTONE_VIEWPORT_ROTATION_CHANGED',
        'CORNERSTONE_VIEWPORT_FLIP_CHANGED',
      ];

      rotationFlipEvents.forEach(eventType => {
        element.addEventListener(eventType, handleRotationFlip);
      });

      const globalEventTarget = window.cornerstone?.eventTarget;
      if (globalEventTarget) {
        rotationFlipEvents.forEach(eventType => {
          globalEventTarget.addEventListener(eventType, handleRotationFlip);
        });
      }

      return () => {
        rotationFlipEvents.forEach(eventType => {
          element.removeEventListener(eventType, handleRotationFlip);
        });

        if (globalEventTarget) {
          rotationFlipEvents.forEach(eventType => {
            globalEventTarget.removeEventListener(eventType, handleRotationFlip);
          });
        }
      };
    }, [viewportId, cornerstoneViewportService, viewportPersistenceService]);

    // On displaySet change: store the outgoing image's rotation/flip, then hide
    // the viewport behind the loading overlay while the new image loads and
    // persisted rotation/flip is applied. The reveal effect below shows it once
    // restoration has run, so the user sees a loading indicator instead of the
    // image snapping through its transforms.
    useEffect(() => {
      const element = elementRef.current;
      if (!element) {
        return;
      }

      // Store the outgoing image's state before we switch.
      try {
        const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
        if (viewport?.getCurrentImageId?.()) {
          viewportPersistenceService?.storeRotationFlipState(viewportId);
        }
      } catch (error) {
        console.warn('Error storing current state during transition:', error);
      }

      element.style.visibility = 'hidden';
      setShowLoadingOverlay(true);
      // New displaySets, new load: drop any progress from the previous ones.
      setLoadProgress(null);
    }, [displaySets, viewportId, cornerstoneViewportService, viewportPersistenceService]);

    useEffect(() => {
      if (!viewportPersistenceService || !cornerstoneViewportService) return;

      const attemptRestoration = () => {
        try {
          const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
          if (viewport?.getCurrentImageId?.()) {
            viewport.getCamera();

            viewportPersistenceService.attemptViewportRestoration(viewportId);

            setTimeout(() => {
              viewport.getCamera();
            }, 200);
          }
        } catch (error) {
          console.warn('Error during restoration attempt:', error);
        }
      };

      setTimeout(attemptRestoration, 50);
    }, [viewportId, viewportPersistenceService, cornerstoneViewportService, displaySets]);
    // subscribe to displaySet metadata invalidation (updates)
    // Currently, if the metadata changes we need to re-render the display set
    // for it to take effect in the viewport. As we deal with scaling in the loading,
    // we need to remove the old volume from the cache, and let the
    // viewport to re-add it which will use the new metadata. Otherwise, the
    // viewport will use the cached volume and the new metadata will not be used.
    // Note: this approach does not actually end of sending network requests
    // and it uses the network cache
    useEffect(() => {
      const { unsubscribe } = displaySetService.subscribe(
        displaySetService.EVENTS.DISPLAY_SET_SERIES_METADATA_INVALIDATED,
        async ({
          displaySetInstanceUID: invalidatedDisplaySetInstanceUID,
          invalidateData,
        }: Types.DisplaySetSeriesMetadataInvalidatedEvent) => {
          if (!invalidateData) {
            return;
          }

          const viewportInfo = cornerstoneViewportService.getViewportInfo(viewportId);

          if (viewportInfo.hasDisplaySet(invalidatedDisplaySetInstanceUID)) {
            const viewportData = viewportInfo.getViewportData();
            const newViewportData = await cornerstoneCacheService.invalidateViewportData(
              viewportData,
              invalidatedDisplaySetInstanceUID,
              dataSource,
              displaySetService
            );

            const keepCamera = true;
            cornerstoneViewportService.updateViewport(viewportId, newViewportData, keepCamera);
          }
        }
      );
      return () => {
        unsubscribe();
      };
    }, [viewportId]);

    useEffect(() => {
      // handle the default viewportType to be stack
      if (!viewportOptions.viewportType) {
        viewportOptions.viewportType = STACK;
      }

      const loadViewportData = async () => {
        const viewportData = await cornerstoneCacheService.createViewportData(
          displaySets,
          viewportOptions,
          dataSource,
          initialImageIndex
        );

        const presentations = getViewportPresentations(viewportId, viewportOptions);

        let measurement;
        if (cacheJumpToMeasurementEvent?.viewportId === viewportId) {
          measurement = cacheJumpToMeasurementEvent.measurement;
          // Delete the position presentation so that viewport navigates direct
          presentations.positionPresentation = null;
          cacheJumpToMeasurementEvent = null;
        }

        // Note: This is a hack to get the grid to re-render the OHIFCornerstoneViewport component
        // Used for segmentation hydration right now, since the logic to decide whether
        // a viewport needs to render a segmentation lives inside the CornerstoneViewportService
        // so we need to re-render (force update via change of the needsRerendering) so that React
        // does the diffing and decides we should render this again (although the id and element has not changed)
        // so that the CornerstoneViewportService can decide whether to render the segmentation or not. Not that we reached here we can turn it off.
        if (viewportOptions.needsRerendering) {
          viewportOptions.needsRerendering = false;
        }

        cornerstoneViewportService.setViewportData(
          viewportId,
          viewportData,
          viewportOptions,
          displaySetOptions,
          presentations
        );

        if (measurement) {
          cs3DTools.annotation.selection.setAnnotationSelected(measurement.uid);
        }
      };

      loadViewportData();
    }, [viewportOptions, displaySets, dataSource]);

    // Feed a real percent into the loading overlay while it is shown. This
    // effect only OBSERVES load progress — the overlay show/hide/reveal logic
    // is untouched — and when no signal is available loadProgress stays null,
    // keeping the indeterminate bar. Note: this effect is declared after the
    // loadViewportData effect above so that, on the same commit, the default
    // viewportType (stack) has already been applied to viewportOptions.
    useEffect(() => {
      const isVolumeViewport =
        Boolean(viewportOptions.viewportType) && viewportOptions.viewportType !== STACK;

      if (isVolumeViewport) {
        // VOLUME viewports (reconstructable CT/MR): the streaming volume
        // loader reports per-frame progress on the cornerstone eventTarget.
        // Multiple viewports (e.g. MPR) share one volumeId, so filter events
        // to this viewport's own volumes; progress is taken from the event
        // payload (framesProcessed/numberOfFrames) rather than counted, so a
        // shared volume can never double count.
        const displaySetUIDs = displaySets
          .map(displaySet => displaySet.displaySetInstanceUID)
          .filter(Boolean);
        const isViewportVolume = (volumeId: unknown): boolean =>
          typeof volumeId === 'string' && displaySetUIDs.some(uid => volumeId.includes(uid));

        // Already-cached volume: neither IMAGE_VOLUME_MODIFIED nor
        // IMAGE_VOLUME_LOADING_COMPLETED will fire, so seed a full bar
        // instead of leaving the overlay indeterminate.
        displaySets.forEach(displaySet => {
          const { volumeLoaderSchema } = displaySet as { volumeLoaderSchema?: string };
          const volumeId = `${volumeLoaderSchema ?? DEFAULT_VOLUME_LOADER_SCHEME}:${displaySet.displaySetInstanceUID}`;
          const volume = cache.getVolume(volumeId);
          const numberOfFrames = volume?.imageIds?.length;
          if (volume?.loadStatus?.loaded && numberOfFrames) {
            setLoadProgress({
              loaded: numberOfFrames,
              total: numberOfFrames,
              targetText: 'frames',
            });
          }
        });

        const handleVolumeModified = evt => {
          const { volumeId, numberOfFrames, framesProcessed } = evt.detail || {};
          if (!isViewportVolume(volumeId) || !numberOfFrames) {
            return;
          }
          setLoadProgress({
            loaded: framesProcessed,
            total: numberOfFrames,
            targetText: 'frames',
          });
        };

        const handleVolumeLoadingCompleted = evt => {
          if (!isViewportVolume(evt.detail?.volumeId)) {
            return;
          }
          // Pin to 100%; if no progress was ever reported stay indeterminate.
          setLoadProgress(prev => (prev ? { ...prev, loaded: prev.total } : prev));
        };

        eventTarget.addEventListener(Enums.Events.IMAGE_VOLUME_MODIFIED, handleVolumeModified);
        eventTarget.addEventListener(
          Enums.Events.IMAGE_VOLUME_LOADING_COMPLETED,
          handleVolumeLoadingCompleted
        );

        return () => {
          eventTarget.removeEventListener(Enums.Events.IMAGE_VOLUME_MODIFIED, handleVolumeModified);
          eventTarget.removeEventListener(
            Enums.Events.IMAGE_VOLUME_LOADING_COMPLETED,
            handleVolumeLoadingCompleted
          );
        };
      }

      // STACK viewports: count IMAGE_LOADED events for this viewport's
      // imageIds (deduped via a Set — an image can only count once).
      const imageIdSet = new Set<string>();
      displaySets.forEach(displaySet => {
        const images = displaySet.images as Array<{ imageId?: string }> | undefined;
        const imageIds = images?.map(image => image?.imageId) ?? displaySet.imageIds ?? [];
        imageIds.forEach(imageId => imageId && imageIdSet.add(imageId));
      });

      const total = imageIdSet.size;
      if (total < MIN_STACK_IMAGES_FOR_PROGRESS) {
        // Small stacks (single-frame CR/DX etc.): keep the indeterminate bar.
        return;
      }

      // Seed with images already in the cornerstone cache — those never fire
      // IMAGE_LOADED (e.g. revisiting a cached study), and without this the
      // percent would stall at 0.
      const loadedImageIds = new Set<string>();
      imageIdSet.forEach(imageId => {
        if (cache.isLoaded(imageId)) {
          loadedImageIds.add(imageId);
        }
      });
      if (loadedImageIds.size) {
        setLoadProgress({ loaded: loadedImageIds.size, total, targetText: 'images' });
      }

      const handleImageLoaded = evt => {
        const imageId = evt.detail?.image?.imageId;
        if (!imageId || !imageIdSet.has(imageId) || loadedImageIds.has(imageId)) {
          return;
        }
        loadedImageIds.add(imageId);
        setLoadProgress({ loaded: loadedImageIds.size, total, targetText: 'images' });
      };

      eventTarget.addEventListener(Enums.Events.IMAGE_LOADED, handleImageLoaded);

      return () => {
        eventTarget.removeEventListener(Enums.Events.IMAGE_LOADED, handleImageLoaded);
      };
    }, [displaySets, viewportId, viewportOptions]);

    /**
     * There are two scenarios for jump to click
     * 1. Current viewports contain the displaySet that the annotation was drawn on
     * 2. Current viewports don't contain the displaySet that the annotation was drawn on
     * and we need to change the viewports displaySet for jumping.
     * Since measurement_jump happens via events and listeners, the former case is handled
     * by the measurement_jump direct callback, but the latter case is handled first by
     * the viewportGrid to set the correct displaySet on the viewport, AND THEN we check
     * the cache for jumping to see if there is any jump queued, then we jump to the correct slice.
     */
    useEffect(() => {
      if (isJumpToMeasurementDisabled) {
        return;
      }

      const unsubscribeFromJumpToMeasurementEvents = _subscribeToJumpToMeasurementEvents(
        elementRef,
        viewportId,
        servicesManager
      );

      _checkForCachedJumpToMeasurementEvents(elementRef, viewportId, displaySets, servicesManager);

      return () => {
        unsubscribeFromJumpToMeasurementEvents();
      };
    }, [displaySets, elementRef, viewportId, isJumpToMeasurementDisabled, servicesManager]);

    // Reveal the viewport only when BOTH are true, whichever happens last:
    //  - restoration has resolved (VIEWPORT_STATE_RESTORED). The service
    //    broadcasts this as soon as it knows there is nothing to restore —
    //    for stack viewports that's before any pixel data has loaded, so the
    //    event alone must NOT reveal (a slow US would show a black canvas for
    //    the whole download);
    //  - the viewport has actually painted (IMAGE_RENDERED).
    // Fallbacks so the overlay can never get stuck:
    //  - painted but restoration event never arrives → short grace period,
    //    then reveal (keyed to the real render, so it can't race a long load);
    //  - an absolute cap clears the overlay even if nothing ever renders
    //    (e.g. a failed load), so error states stay visible.
    useEffect(() => {
      const element = elementRef.current;
      if (!element) {
        return;
      }

      let revealed = false;
      let restored = false;
      let rendered = false;
      let renderGraceTimer: ReturnType<typeof setTimeout> | null = null;

      const reveal = () => {
        if (revealed) {
          return;
        }
        revealed = true;
        if (elementRef.current) {
          elementRef.current.style.visibility = 'visible';
        }
        setShowLoadingOverlay(false);
      };

      const restorationCompleteSubscription = viewportPersistenceService?.subscribe(
        viewportPersistenceService.constructor.EVENTS.VIEWPORT_STATE_RESTORED,
        event => {
          if (event.viewportId !== viewportId) {
            return;
          }
          restored = true;
          if (rendered) {
            reveal();
          }
        }
      );

      const handleImageRendered = () => {
        rendered = true;
        if (restored) {
          reveal();
          return;
        }
        if (!renderGraceTimer && !revealed) {
          renderGraceTimer = setTimeout(reveal, 1500);
        }
      };
      element.addEventListener(Enums.Events.IMAGE_RENDERED, handleImageRendered);

      // Absolute safety net: never leave the loading overlay stuck.
      const safetyTimer = setTimeout(reveal, 10000);

      return () => {
        restorationCompleteSubscription?.unsubscribe();
        element.removeEventListener(Enums.Events.IMAGE_RENDERED, handleImageRendered);
        clearTimeout(renderGraceTimer);
        clearTimeout(safetyTimer);
      };
    }, [displaySets, viewportPersistenceService, viewportId]);

    useEffect(() => {
      if (appConfig.autoTrimCollimationBorders === false) {
        return;
      }

      const element = elementRef.current;
      if (!element) {
        return;
      }

      // Only apply to CR/DX modalities
      const modality = displaySets?.[0]?.Modality;
      if (!modality || !['CR', 'DX'].includes(modality)) {
        return;
      }

      let trimDone = false;
      let attempts = 0;
      const MAX_ATTEMPTS = 10;
      const displaySetKey = displaySets.map(ds => ds.displaySetInstanceUID).join(',');

      const readView = () => {
        const csViewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
        if (!csViewport) {
          return null;
        }
        const zoom = csViewport.getZoom?.() ?? 0;
        const pan = csViewport.getPan?.() ?? [0, 0];
        return { zoom, panX: pan[0] || 0, panY: pan[1] || 0 };
      };

      const differsFromBaseline = (view, baseline) => {
        const zoomDiff = Math.abs(view.zoom - baseline.zoom);
        const panDiff = Math.abs(view.panX - baseline.panX) + Math.abs(view.panY - baseline.panY);
        return { differs: zoomDiff > 0.01 || panDiff > 0.5, zoomDiff, panDiff };
      };

      const snapshotBaseline = () => {
        try {
          const view = readView();
          if (view) {
            baselineViewCache.set(displaySetKey, view);
          }
        } catch (error) {
          // Keep the previous baseline.
        }
      };

      const applyManualDelta = () => {
        const delta = manualViewCache.get(displaySetKey);
        if (!delta) {
          return;
        }
        try {
          const csViewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
          if (!csViewport) {
            return;
          }
          if (delta.zoomRatio && Math.abs(delta.zoomRatio - 1) > 0.01 && csViewport.setZoom) {
            csViewport.setZoom((csViewport.getZoom?.() ?? 1) * delta.zoomRatio);
          }
          if ((Math.abs(delta.panDX) > 0.5 || Math.abs(delta.panDY) > 0.5) && csViewport.setPan) {
            const pan = csViewport.getPan?.() ?? [0, 0];
            csViewport.setPan([pan[0] + delta.panDX, pan[1] + delta.panDY]);
          }
          csViewport.render?.();
        } catch (error) {
          console.warn('Failed to re-apply manual view delta:', error);
        }
      };

      const runTrim = (): boolean => {
        const result = commandsManager.runCommand('autoTrimBorders', { viewportId });
        if (result === false) {
          return false;
        }
        trimDone = true;
        // Baseline first (the untouched post-trim view), then the user's
        // manual delta on top — so the leave-time comparison measures only
        // what the user changed relative to this visit's baseline.
        snapshotBaseline();
        applyManualDelta();
        return true;
      };

      const handleImageRendered = () => {
        if (trimDone || attempts >= MAX_ATTEMPTS) {
          return;
        }
        attempts++;

        // Delay slightly to ensure image data is fully available in cache
        setTimeout(() => {
          try {
            if (trimDone) {
              return;
            }

            // In-visit protection: if the camera has moved off the last known
            // untouched baseline (user is panning/zooming right now, or the
            // restore pipeline is mid-flight), do not re-trim from this path.
            // The restore-triggered path below is the authority and ignores
            // this latch.
            const baseline = baselineViewCache.get(displaySetKey);
            const view = readView();
            if (baseline && view) {
              const { differs } = differsFromBaseline(view, baseline);
              if (differs) {
                trimDone = true;
                return;
              }
            }

            runTrim();
          } catch (error) {
            console.warn('Auto-trim borders failed:', error);
          }
        }, 100);
      };

      element.addEventListener(Enums.Events.IMAGE_RENDERED, handleImageRendered);

      // Deterministic autozoom: once viewport persistence has applied any
      // stored rotation/flip, decide about the trim on top of the restored
      // transforms — a moment when the camera is in its final state (the
      // trimDone latch from the IMAGE_RENDERED path is intentionally ignored
      // here, it can latch off a mid-transition camera).
      let restoreTrimHandled = false;
      const restorationTrimSubscription = viewportPersistenceService?.subscribe(
        viewportPersistenceService.constructor.EVENTS.VIEWPORT_STATE_RESTORED,
        event => {
          if (event.viewportId !== viewportId || restoreTrimHandled) {
            return;
          }
          restoreTrimHandled = true;
          try {
            if (!runTrim()) {
              // Image data not available yet — let the IMAGE_RENDERED path
              // (or a later restoration broadcast) try again.
              restoreTrimHandled = false;
            }
          } catch (error) {
            console.warn('Auto-trim after restore failed:', error);
            restoreTrimHandled = false;
          }
        }
      );

      // Rotate/flip commands store persistence state right after applying, so
      // this event marks "the transforms just changed". A transform
      // legitimately moves the MEASURED pan (the trim re-bases initialCamera),
      // so refresh the untouched baseline to the post-transform camera —
      // otherwise the leave-time comparison would misread the transform as a
      // manual pan and suppress the autozoom on the next visit.
      const transformBaselineSubscription = viewportPersistenceService?.subscribe(
        viewportPersistenceService.constructor.EVENTS.VIEWPORT_STATE_STORED,
        event => {
          if (event.viewportId !== viewportId || !baselineViewCache.has(displaySetKey)) {
            return;
          }
          setTimeout(snapshotBaseline, 50);
        }
      );

      return () => {
        element.removeEventListener(Enums.Events.IMAGE_RENDERED, handleImageRendered);
        restorationTrimSubscription?.unsubscribe();
        transformBaselineSubscription?.unsubscribe();

        // Leave-time verdict: record how far the user's view deviates from
        // this visit's untouched baseline. The delta (zoom ratio + pan
        // offset) is re-applied on top of the trim on the next visit; an
        // untouched view clears it. Only recorded when a trim decision
        // completed this visit (trimDone) — otherwise the camera and the
        // baseline may be in different reference frames.
        try {
          if (!trimDone) {
            return;
          }
          const baseline = baselineViewCache.get(displaySetKey);
          const view = readView();
          if (!baseline || !view) {
            return;
          }
          const { differs } = differsFromBaseline(view, baseline);
          if (!differs) {
            manualViewCache.delete(displaySetKey);
            return;
          }
          manualViewCache.set(displaySetKey, {
            zoomRatio: baseline.zoom ? view.zoom / baseline.zoom : 1,
            panDX: view.panX - baseline.panX,
            panDY: view.panY - baseline.panY,
          });
        } catch (error) {
          // Leave any previous delta in place.
        }
      };
    }, [
      viewportId,
      displaySets,
      viewportOptions,
      appConfig.autoTrimCollimationBorders,
      commandsManager,
      viewportPersistenceService,
      cornerstoneViewportService,
    ]);

    // Set up the window level action menu in the viewport action corners.
    useEffect(() => {
      // Doing an === check here because the default config value when not set is true
      if (appConfig.addWindowLevelActionMenu === false) {
        return;
      }

      const location = viewportActionCornersService.LOCATIONS.topRight;

      // TODO: In the future we should consider using the customization service
      // to determine if and in which corner various action components should go.
      viewportActionCornersService.addComponent({
        viewportId,
        id: 'windowLevelActionMenu',
        component: getWindowLevelActionMenu({
          viewportId,
          element: elementRef.current,
          displaySets,
          servicesManager,
          commandsManager,
          location,
          verticalDirection: AllInOneMenu.VerticalDirection.TopToBottom,
          horizontalDirection: AllInOneMenu.HorizontalDirection.RightToLeft,
        }),
        location,
      });

      viewportActionCornersService.addComponent({
        viewportId,
        id: 'segmentation',
        component: getViewportDataOverlaySettingsMenu({
          viewportId,
          element: elementRef.current,
          displaySets,
          servicesManager,
          commandsManager,
          location,
        }),
        location,
      });
    }, [
      displaySets,
      viewportId,
      viewportActionCornersService,
      servicesManager,
      commandsManager,
      appConfig,
    ]);

    // Disabled redundant restoration trigger for displaySet changes
    // useEffect(() => {
    //   if (!viewportPersistenceService || !cornerstoneViewportService) return;

    //   // Simple restoration when displaySets change
    //   const timer = setTimeout(() => {
    //     try {
    //       const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
    //       if (viewport?.getCurrentImageId?.()) {
    //         console.log('🔄 Triggering restoration for displaySet change');
    //         viewportPersistenceService.attemptViewportRestoration(viewportId);
    //       }
    //     } catch (error) {
    //       console.warn('Error in restoration trigger:', error);
    //     }
    //   }, 100); // Very short delay, just enough for viewport to be ready

    //   return () => clearTimeout(timer);
    // }, [viewportId, displaySets, viewportPersistenceService, cornerstoneViewportService]);

    // Disabled redundant restoration trigger for data load
    // useEffect(() => {
    //   if (!viewportPersistenceService || !cornerstoneViewportService) return;

    //   const handleViewportDataLoaded = () => {
    //     setTimeout(() => {
    //       try {
    //         const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
    //         if (viewport?.getCurrentImageId?.()) {
    //           console.log('🔄 Triggering restoration after data load');
    //           viewportPersistenceService.attemptViewportRestoration(viewportId);
    //         }
    //       } catch (error) {
    //         console.warn('Error in data load restoration:', error);
    //       }
    //     }, 200);
    //   };

    //   // Trigger on initial mount and when displaySets change
    //   if (displaySets.length > 0) {
    //     handleViewportDataLoaded();
    //   }
    // }, [displaySets, viewportId, viewportPersistenceService, cornerstoneViewportService]);

    const { ref: resizeRef } = useResizeDetector({
      onResize,
    });

    return (
      <React.Fragment>
        <div className="viewport-wrapper">
          <div
            className="cornerstone-viewport-element"
            style={{ 
              height: '100%', 
              width: '100%'
            }}
            onContextMenu={e => e.preventDefault()}
            onMouseDown={e => e.preventDefault()}
            ref={el => {
              resizeRef.current = el;
              elementRef.current = el;
            }}
          ></div>
          <CornerstoneOverlays
            viewportId={viewportId}
            toolBarService={toolbarService}
            element={elementRef.current}
            scrollbarHeight={scrollbarHeight}
            servicesManager={servicesManager}
          />
          <CinePlayer
            enabledVPElement={enabledVPElement}
            viewportId={viewportId}
            servicesManager={servicesManager}
          />
          <ActiveViewportBehavior
            viewportId={viewportId}
            servicesManager={servicesManager}
          />
          {/* Loading overlay until the image is ready with rotation/flip applied.
              Shows "Loaded X of Y" + percent when a progress signal is
              available; falls back to the indeterminate bar otherwise. */}
          {showLoadingOverlay && (
            <LoadingIndicatorTotalPercent
              className="pointer-events-none h-full w-full bg-black"
              totalNumbers={loadProgress?.total ?? null}
              percentComplete={
                loadProgress && loadProgress.total > 0
                  ? Math.min(100, Math.floor((loadProgress.loaded / loadProgress.total) * 100))
                  : null
              }
              targetText={loadProgress?.targetText}
            />
          )}
        </div>
        {/* top offset of 24px to account for ViewportActionCorners. */}
        <div className="absolute top-[24px] w-full">
          {viewportDialogState.viewportId === viewportId && (
            <Notification
              id="viewport-notification"
              message={viewportDialogState.message}
              type={viewportDialogState.type}
              actions={viewportDialogState.actions}
              onSubmit={viewportDialogState.onSubmit}
              onOutsideClick={viewportDialogState.onOutsideClick}
              onKeyPress={viewportDialogState.onKeyPress}
            />
          )}
        </div>
        {/* The OHIFViewportActionCorners follows the viewport in the DOM so that it is naturally at a higher z-index.*/}
        <OHIFViewportActionCorners viewportId={viewportId} />
      </React.Fragment>
    );
  },
  areEqual
);

function _subscribeToJumpToMeasurementEvents(elementRef, viewportId, servicesManager) {
  const { measurementService, cornerstoneViewportService } = servicesManager.services;

  const { unsubscribe } = measurementService.subscribe(
    MeasurementService.EVENTS.JUMP_TO_MEASUREMENT_VIEWPORT,
    props => {
      cacheJumpToMeasurementEvent = props;
      const { viewportId: jumpId, measurement, isConsumed } = props;
      if (!measurement || isConsumed) {
        return;
      }
      if (cacheJumpToMeasurementEvent.cornerstoneViewport === undefined) {
        // Decide on which viewport should handle this
        cacheJumpToMeasurementEvent.cornerstoneViewport =
          cornerstoneViewportService.getViewportIdToJump(jumpId, {
            displaySetInstanceUID: measurement.displaySetInstanceUID,
            ...measurement.metadata,
            referencedImageId:
              measurement.referencedImageId || measurement.metadata?.referencedImageId,
          });
      }
      if (cacheJumpToMeasurementEvent.cornerstoneViewport !== viewportId) {
        return;
      }
      _jumpToMeasurement(measurement, elementRef, viewportId, servicesManager);
    }
  );

  return unsubscribe;
}

// Check if there is a queued jumpToMeasurement event
function _checkForCachedJumpToMeasurementEvents(
  elementRef,
  viewportId,
  displaySets,
  servicesManager
) {
  if (!cacheJumpToMeasurementEvent) {
    return;
  }
  if (cacheJumpToMeasurementEvent.isConsumed) {
    cacheJumpToMeasurementEvent = null;
    return;
  }
  const displaysUIDs = displaySets.map(displaySet => displaySet.displaySetInstanceUID);
  if (!displaysUIDs?.length) {
    return;
  }

  // Jump to measurement if the measurement exists
  const { measurement } = cacheJumpToMeasurementEvent;
  if (measurement && elementRef) {
    if (displaysUIDs.includes(measurement?.displaySetInstanceUID)) {
      _jumpToMeasurement(measurement, elementRef, viewportId, servicesManager);
    }
  }
}

function _jumpToMeasurement(measurement, targetElementRef, viewportId, servicesManager) {
  const { viewportGridService } = servicesManager.services;

  const targetElement = targetElementRef.current;

  // Todo: setCornerstoneMeasurementActive should be handled by the toolGroupManager
  //  to set it properly
  // setCornerstoneMeasurementActive(measurement);

  viewportGridService.setActiveViewportId(viewportId);

  const enabledElement = getEnabledElement(targetElement);

  if (enabledElement) {
    // See how the jumpToSlice() of Cornerstone3D deals with imageIdx param.
    const viewport = enabledElement.viewport as csTypes.IStackViewport | csTypes.IVolumeViewport;

    const { metadata } = measurement;
    if (!viewport.isReferenceViewable(metadata, { withNavigation: true, withOrientation: true })) {
      return;
    }

    viewport.setViewReference(metadata);

    cs3DTools.annotation.selection.setAnnotationSelected(measurement.uid);
    // Jump to measurement consumed, remove.
    cacheJumpToMeasurementEvent?.consume?.();
    cacheJumpToMeasurementEvent = null;
  }
}

function _rehydrateSynchronizers(viewportId: string, syncGroupService: any) {
  const { synchronizersStore } = useSynchronizersStore.getState();
  const synchronizers = synchronizersStore[viewportId];

  if (!synchronizers) {
    return;
  }

  synchronizers.forEach(synchronizerObj => {
    if (!synchronizerObj.id) {
      return;
    }

    const { id, sourceViewports, targetViewports } = synchronizerObj;

    const synchronizer = syncGroupService.getSynchronizer(id);

    if (!synchronizer) {
      return;
    }

    const sourceViewportInfo = sourceViewports.find(
      sourceViewport => sourceViewport.viewportId === viewportId
    );

    const targetViewportInfo = targetViewports.find(
      targetViewport => targetViewport.viewportId === viewportId
    );

    const isSourceViewportInSynchronizer = synchronizer
      .getSourceViewports()
      .find(sourceViewport => sourceViewport.viewportId === viewportId);

    const isTargetViewportInSynchronizer = synchronizer
      .getTargetViewports()
      .find(targetViewport => targetViewport.viewportId === viewportId);

    // if the viewport was previously a source viewport, add it again
    if (sourceViewportInfo && !isSourceViewportInSynchronizer) {
      synchronizer.addSource({
        viewportId: sourceViewportInfo.viewportId,
        renderingEngineId: sourceViewportInfo.renderingEngineId,
      });
    }

    // if the viewport was previously a target viewport, add it again
    if (targetViewportInfo && !isTargetViewportInSynchronizer) {
      synchronizer.addTarget({
        viewportId: targetViewportInfo.viewportId,
        renderingEngineId: targetViewportInfo.renderingEngineId,
      });
    }
  });
}

// Component displayName
OHIFCornerstoneViewport.displayName = 'OHIFCornerstoneViewport';

function areEqual(prevProps, nextProps) {
  if (nextProps.needsRerendering) {
    console.debug('OHIFCornerstoneViewport: Rerender caused by: needsRerendering');
    return false;
  }

  if (prevProps.displaySets.length !== nextProps.displaySets.length) {
    console.debug('OHIFCornerstoneViewport: Rerender caused by: displaySets length change');
    return false;
  }

  if (prevProps.viewportOptions.orientation !== nextProps.viewportOptions.orientation) {
    console.debug('OHIFCornerstoneViewport: Rerender caused by: orientation change');
    return false;
  }

  if (prevProps.viewportOptions.toolGroupId !== nextProps.viewportOptions.toolGroupId) {
    console.debug('OHIFCornerstoneViewport: Rerender caused by: toolGroupId change');
    return false;
  }

  if (
    nextProps.viewportOptions.viewportType &&
    prevProps.viewportOptions.viewportType !== nextProps.viewportOptions.viewportType
  ) {
    console.debug('OHIFCornerstoneViewport: Rerender caused by: viewportType change');
    return false;
  }

  if (nextProps.viewportOptions.needsRerendering) {
    console.debug('OHIFCornerstoneViewport: Rerender caused by: viewportOptions.needsRerendering');
    return false;
  }

  const prevDisplaySets = prevProps.displaySets;
  const nextDisplaySets = nextProps.displaySets;

  if (prevDisplaySets.length !== nextDisplaySets.length) {
    console.debug('OHIFCornerstoneViewport: Rerender caused by: displaySets length mismatch');
    return false;
  }

  for (let i = 0; i < prevDisplaySets.length; i++) {
    const prevDisplaySet = prevDisplaySets[i];

    // More robust displaySet matching - don't fail if displaySet is temporarily unavailable
    const foundDisplaySet = nextDisplaySets.find(
      nextDisplaySet =>
        nextDisplaySet?.displaySetInstanceUID === prevDisplaySet?.displaySetInstanceUID
    );

    if (!foundDisplaySet) {
      // Check if this is just a temporary unavailability during navigation
      // If the displaySetInstanceUID exists but the object is incomplete, wait
      const hasMatchingUID = nextDisplaySets.some(
        ds => ds?.displaySetInstanceUID === prevDisplaySet?.displaySetInstanceUID
      );

      if (hasMatchingUID) {
        console.debug(
          'OHIFCornerstoneViewport: DisplaySet temporarily incomplete, allowing re-render'
        );
        return false;
      }

      console.debug('OHIFCornerstoneViewport: Rerender caused by: displaySet not found', {
        prevUID: prevDisplaySet?.displaySetInstanceUID,
        nextUIDs: nextDisplaySets.map(ds => ds?.displaySetInstanceUID),
      });
      return false;
    }

    // Only check image arrays if both displaySets have them
    if (foundDisplaySet.images?.length && prevDisplaySet.images?.length) {
      // check they contain the same image count
      if (foundDisplaySet.images.length !== prevDisplaySet.images.length) {
        console.debug('OHIFCornerstoneViewport: Rerender caused by: images length mismatch');
        return false;
      }

      // check if their imageIds are the same (sample check for performance)
      // Only check first and last images to avoid expensive full array comparison
      const samplesToCheck = [0];
      if (foundDisplaySet.images.length > 1) {
        samplesToCheck.push(foundDisplaySet.images.length - 1);
      }

      for (const sampleIndex of samplesToCheck) {
        if (
          foundDisplaySet.images[sampleIndex]?.imageId !==
          prevDisplaySet.images[sampleIndex]?.imageId
        ) {
          console.debug(
            'OHIFCornerstoneViewport: Rerender caused by: imageId mismatch at sample',
            sampleIndex
          );
          return false;
        }
      }
    } else if (foundDisplaySet.images?.length !== prevDisplaySet.images?.length) {
      // Only fail if one has images and the other doesn't, or if lengths are definitively different
      console.debug('OHIFCornerstoneViewport: Rerender caused by: images array structure change');
      return false;
    }
  }

  return true;
}

// Helper function to check if display sets have changed
function haveDisplaySetsChanged(prevDisplaySets, currentDisplaySets) {
  if (prevDisplaySets.length !== currentDisplaySets.length) {
    return true;
  }

  return currentDisplaySets.some((currentDS, index) => {
    const prevDS = prevDisplaySets[index];
    return currentDS.displaySetInstanceUID !== prevDS.displaySetInstanceUID;
  });
}

export default OHIFCornerstoneViewport;
