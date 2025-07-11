import React, { useEffect, useRef, useCallback, useState } from 'react';
import { useResizeDetector } from 'react-resize-detector';
import * as cs3DTools from '@cornerstonejs/tools';
import { Enums, eventTarget, getEnabledElement } from '@cornerstonejs/core';
import { MeasurementService } from '@ohif/core';
import { AllInOneMenu, Notification, useViewportDialog } from '@ohif/ui';
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

/**
 * Caches the jump to measurement operation, so that if display set is shown,
 * it can jump to the measurement.
 */
let cacheJumpToMeasurementEvent;

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
    const [showBlackScreen, setShowBlackScreen] = useState(true); // Start with black screen
    const [isImageReady, setIsImageReady] = useState(false);
    useEffect(() => {
      const isVolumeViewport = viewportOptions.viewportType === 'volume';
      const isMultiFrame = displaySets?.[0]?.images?.length > 1; // CT scans have multiple frames
      const isSlowLoading = isVolumeViewport || isMultiFrame;
      
      if (isSlowLoading && displaySets && displaySets.length > 0) {
        const emergencyTimer = setTimeout(() => {
          setIsImageReady(true);
          setShowBlackScreen(false);
          
          const element = elementRef.current;
          if (element) {
            element.style.visibility = 'visible';
          }
        }, 1000); // 1 second for slow-loading images to match standard timing
        
        return () => clearTimeout(emergencyTimer);
      }
    }, [viewportId, viewportOptions.viewportType, displaySets]);
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

    useEffect(() => {
      const element = elementRef.current;
      if (!element) {
        return;
      }

      element.style.visibility = 'hidden';
      
      const isVolumeViewport = viewportOptions.viewportType === 'volume';
      if (isVolumeViewport) {
        const volumeShowTimer = setTimeout(() => {
          const element = elementRef.current;
          if (element) {
            element.style.visibility = 'visible';
            setIsImageReady(true);
            setShowBlackScreen(false);
            
            try {
              const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
              if (viewport) {
                viewportPersistenceService?.storeRotationFlipState(viewportId);
              }
            } catch (error) {
              console.warn('Error storing volume state:', error);
            }
          }
        }, 1000); // 1 second delay for volumes
        
        return () => {
          clearTimeout(volumeShowTimer);
        };
      }
      
      return () => {
      };
    }, [displaySets, viewportOptions.viewportType, viewportId, cornerstoneViewportService, viewportPersistenceService]);

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

    // Manage black screen during displaySet transitions
    useEffect(() => {
      if (displaySets && displaySets.length > 0) {
        setShowBlackScreen(true);
        setIsImageReady(false);
        
        const storeCurrentState = () => {
          try {
            const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
            if (viewport?.getCurrentImageId?.()) {
              viewportPersistenceService?.storeRotationFlipState(viewportId);
            }
          } catch (error) {
            console.warn('Error storing current state during transition:', error);
          }
        };
        
        storeCurrentState();
      } else {
        setShowBlackScreen(true);
        setIsImageReady(false);
      }
    }, [displaySets, viewportId, viewportOptions.viewportType, cornerstoneViewportService, viewportPersistenceService]);

    // Listen for restoration events and image loading to clear black screen
    useEffect(() => {
      if (!viewportPersistenceService) return;

      const restorationCompleteSubscription = viewportPersistenceService.subscribe(
        viewportPersistenceService.constructor.EVENTS.VIEWPORT_STATE_RESTORED,
        event => {
          if (event.viewportId === viewportId) {
            
            setTimeout(() => {
              const element = elementRef.current;
              if (element) {
                element.style.visibility = 'visible';
              }
              setIsImageReady(true);
              setShowBlackScreen(false);
            }, 50);
          }
        }
      );

      const isVolumeViewport = viewportOptions.viewportType === 'volume';
      const fallbackDelay = isVolumeViewport ? 2000 : 2000; // Same for both, but volume gets additional checks above
      const fallbackTimer = setTimeout(() => {
        const element = elementRef.current;
        if (element) {
          element.style.visibility = 'visible';
        }
        setIsImageReady(true);
        setShowBlackScreen(false);
        
        if (isVolumeViewport) {
          try {
            const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
            if (viewport) {
              viewportPersistenceService?.storeRotationFlipState(viewportId);
            }
          } catch (error) {
            console.warn('Error storing volume viewport state in fallback:', error);
          }
        }
      }, fallbackDelay);

      return () => {
        restorationCompleteSubscription?.unsubscribe();
        clearTimeout(fallbackTimer);
      };
    }, [viewportPersistenceService, viewportId]);

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
          {/* Black screen overlay until image is ready */}
          {showBlackScreen && (
            <div className="pointer-events-none absolute top-0 left-0 z-50 h-full w-full bg-black">
              <div className="flex h-full items-center justify-center text-white">
                {/* Optional: Add loading indicator */}
              </div>
            </div>
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
