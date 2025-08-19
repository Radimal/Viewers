import {
  getEnabledElement,
  StackViewport,
  VolumeViewport,
  utilities as csUtils,
  Types as CoreTypes,
  BaseVolumeViewport,
} from '@cornerstonejs/core';
import {
  ToolGroupManager,
  Enums,
  utilities as cstUtils,
  ReferenceLinesTool,
} from '@cornerstonejs/tools';

import { Types as OhifTypes } from '@ohif/core';
import {
  callLabelAutocompleteDialog,
  showLabelAnnotationPopup,
  createReportAsync,
  callInputDialog,
  colorPickerDialog,
} from '@ohif/extension-default';
import { vec3, mat4 } from 'gl-matrix';
import { Enums as CornerstoneEnums, eventTarget } from '@cornerstonejs/core';

import CornerstoneViewportDownloadForm from './utils/CornerstoneViewportDownloadForm';
import toggleImageSliceSync from './utils/imageSliceSync/toggleImageSliceSync';
import { getFirstAnnotationSelected } from './utils/measurementServiceMappings/utils/selection';
import getActiveViewportEnabledElement from './utils/getActiveViewportEnabledElement';
import toggleVOISliceSync from './utils/toggleVOISliceSync';
import { usePositionPresentationStore, useSegmentationPresentationStore } from './stores';

const toggleSyncFunctions = {
  imageSlice: toggleImageSliceSync,
  voi: toggleVOISliceSync,
};
function commandsModule({
  servicesManager,
  extensionManager,
  commandsManager,
}: OhifTypes.Extensions.ExtensionParams): OhifTypes.Extensions.CommandsModule {
  const {
    viewportGridService,
    toolGroupService,
    cineService,
    uiDialogService,
    cornerstoneViewportService,
    uiNotificationService,
    measurementService,
    customizationService,
    colorbarService,
    hangingProtocolService,
    syncGroupService,
  } = servicesManager.services;

  const setupAutoImageSliceSync = () => {
    let syncTimeout = null;
    
    const enableImageSliceSyncForAll = () => {
      const { viewports } = viewportGridService.getState();
      const totalViewports = viewports.size;
      
      if (totalViewports > 1) {
        if (syncTimeout) {
          clearTimeout(syncTimeout);
        }
        
        syncTimeout = setTimeout(() => {
          forceEnableImageSliceSync({ servicesManager });
        }, 300);
      }
    };

    const handleLayoutChange = (event) => {
      const { numRows, numCols } = event;
      const totalViewports = numRows * numCols;
      
      if (totalViewports > 1) {
        setTimeout(() => {
          forceEnableImageSliceSync({ servicesManager });
        }, 200);
      }
    };

    const handleViewportsReady = () => {
      enableImageSliceSyncForAll();
    };

    const handleNewImageSet = () => {
      enableImageSliceSyncForAll();
    };

    const handleImageRendered = () => {
      enableImageSliceSyncForAll();
    };

    const handleGridStateChanged = () => {
      enableImageSliceSyncForAll();
    };

    const handleActiveViewportChanged = () => {
      enableImageSliceSyncForAll();
    };

    viewportGridService.subscribe(
      viewportGridService.EVENTS.LAYOUT_CHANGED,
      handleLayoutChange
    );
    
    viewportGridService.subscribe(
      viewportGridService.EVENTS.VIEWPORTS_READY,
      handleViewportsReady
    );

    viewportGridService.subscribe(
      viewportGridService.EVENTS.GRID_STATE_CHANGED,
      handleGridStateChanged
    );

    viewportGridService.subscribe(
      viewportGridService.EVENTS.ACTIVE_VIEWPORT_ID_CHANGED,
      handleActiveViewportChanged
    );

    eventTarget.addEventListener(
      CornerstoneEnums.Events.VIEWPORT_NEW_IMAGE_SET,
      handleNewImageSet
    );

    eventTarget.addEventListener(
      CornerstoneEnums.Events.IMAGE_RENDERED,
      handleImageRendered
    );

    eventTarget.addEventListener(
      CornerstoneEnums.Events.STACK_NEW_IMAGE,
      enableImageSliceSyncForAll
    );

    eventTarget.addEventListener(
      CornerstoneEnums.Events.VOLUME_LOADED,
      enableImageSliceSyncForAll
    );
  };

  // Force enable image slice sync for compatible viewports, grouped intelligently
  const forceEnableImageSliceSync = ({ servicesManager }) => {
    const { syncGroupService, viewportGridService, displaySetService, cornerstoneViewportService } =
      servicesManager.services;

    // Get all viewports
    let { viewports } = viewportGridService.getState();
    viewports = [...viewports.values()];
    
    // Filter empty viewports
    viewports = viewports.filter(
      viewport => viewport.displaySetInstanceUIDs && viewport.displaySetInstanceUIDs.length
    );

    // Filter for stack/volume viewports that can potentially be synchronized
    viewports = viewports.filter(viewport => {
      const { displaySetInstanceUIDs } = viewport;

      for (const displaySetInstanceUID of displaySetInstanceUIDs) {
        const displaySet = displaySetService.getDisplaySetByUID(displaySetInstanceUID);

        // Include both reconstructable volumes and stack viewports
        if (displaySet && (displaySet.isReconstructable || displaySet.Modality)) {
          return true;
        }
      }
      return false;
    });

    // Only proceed if we have multiple viewports to sync
    if (viewports.length < 2) {
      return;
    }

    viewports.forEach(gridViewport => {
      const { viewportId } = gridViewport.viewportOptions;
      const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
      
      if (viewport) {
        const syncStates = syncGroupService.getSynchronizersForViewport(viewportId);
        syncStates.forEach(syncState => {
          if (syncState.id.startsWith('IMAGE_SLICE_SYNC')) {
            try {
              syncGroupService.removeViewportFromSyncGroup(
                viewportId,
                viewport.getRenderingEngine().id,
                syncState.id
              );
            } catch (error) {
              console.warn(`Failed to remove viewport ${viewportId} from sync group:`, error);
            }
          }
        });
      }
    });

    // Group viewports by spatial compatibility
    const syncGroups = groupViewportsByCompatibility(viewports, displaySetService);

    syncGroups.forEach((viewportGroup, groupIndex) => {
      if (viewportGroup.length < 2) {
        return;
      }

      const syncId = `IMAGE_SLICE_SYNC_GROUP_${groupIndex}`;

      viewportGroup.forEach((gridViewport) => {
        const { viewportId } = gridViewport.viewportOptions;
        const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
        
        if (!viewport) {
          return;
        }

        try {
          syncGroupService.addViewportToSyncGroup(viewportId, viewport.getRenderingEngine().id, {
            type: 'imageSlice',
            id: syncId,
            source: true,
            target: true,
          });
        } catch (error) {
          console.warn(`Failed to add viewport ${viewportId} to sync group:`, error);
        }
      });
    });
  };

  // Group viewports by spatial compatibility (same study, frame of reference, etc.)
  const groupViewportsByCompatibility = (viewports, displaySetService) => {
    const groups = [];
    const processed = new Set();

    viewports.forEach((viewport, index) => {
      if (processed.has(index)) {
        return;
      }

      const currentGroup = [viewport];
      processed.add(index);

      const currentMetadata = getViewportMetadata(viewport, displaySetService);
      
      if (!currentMetadata) {
        groups.push(currentGroup);
        return;
      }

      viewports.forEach((otherViewport, otherIndex) => {
        if (otherIndex === index || processed.has(otherIndex)) {
          return;
        }

        const otherMetadata = getViewportMetadata(otherViewport, displaySetService);
        
        if (otherMetadata) {
          const isCompatibleWithGroup = currentGroup.some(groupViewport => {
            const groupMetadata = getViewportMetadata(groupViewport, displaySetService);
            return groupMetadata && areViewportsCompatibleForSync(groupMetadata, otherMetadata);
          });
          
          if (isCompatibleWithGroup) {
            currentGroup.push(otherViewport);
            processed.add(otherIndex);
          }
        }
      });

      groups.push(currentGroup);
    });

    return groups;
  };

  // Get relevant metadata for sync compatibility checking
  const getViewportMetadata = (viewport, displaySetService) => {
    const { displaySetInstanceUIDs } = viewport;
    
    if (!displaySetInstanceUIDs || displaySetInstanceUIDs.length === 0) {
      return null;
    }

    const displaySet = displaySetService.getDisplaySetByUID(displaySetInstanceUIDs[0]);
    
    if (!displaySet) {
      return null;
    }

    const firstInstance = displaySet.instances?.[0];
    
    if (!firstInstance) {
      return null;
    }

    return {
      StudyInstanceUID: firstInstance.StudyInstanceUID,
      SeriesInstanceUID: firstInstance.SeriesInstanceUID,
      FrameOfReferenceUID: firstInstance.FrameOfReferenceUID,
      Modality: firstInstance.Modality,
      ImageOrientationPatient: firstInstance.ImageOrientationPatient,
      PatientID: firstInstance.PatientID,
      PatientName: firstInstance.PatientName,
      SeriesDescription: firstInstance.SeriesDescription,
      isReconstructable: displaySet.isReconstructable,
      numImages: displaySet.instances?.length || 1
    };
  };

  const areViewportsCompatibleForSync = (metadata1, metadata2) => {
    if (metadata1.PatientID && metadata2.PatientID && 
        metadata1.PatientID !== metadata2.PatientID) {
      return false;
    }

    if (metadata1.SeriesInstanceUID === metadata2.SeriesInstanceUID) {
      return true;
    }

    if (metadata1.StudyInstanceUID && metadata2.StudyInstanceUID &&
        metadata1.StudyInstanceUID !== metadata2.StudyInstanceUID) {
      return false;
    }

    const frameDifference = Math.abs(metadata1.numImages - metadata2.numImages);
    const frameTolerancePercent = 0.05;
    const maxFrameTolerance = Math.min(metadata1.numImages, metadata2.numImages) * frameTolerancePercent;
    
    if (frameDifference > maxFrameTolerance && frameDifference > 2) {
      return false;
    }

    const seriesDesc1 = (metadata1.SeriesDescription || '').toLowerCase();
    const seriesDesc2 = (metadata2.SeriesDescription || '').toLowerCase();
    
    const anatomyKeywords = ['head', 'brain', 'chest', 'thorax', 'thx', 'abdomen', 'pelvis', 'spine', 'neck'];
    
    let anatomy1 = null;
    let anatomy2 = null;
    
    for (const keyword of anatomyKeywords) {
      if (seriesDesc1.includes(keyword)) anatomy1 = keyword;
      if (seriesDesc2.includes(keyword)) anatomy2 = keyword;
    }
    
    if (anatomy1 && anatomy2 && anatomy1 !== anatomy2) {
      return false;
    }

    if (anatomy1 && anatomy2 && anatomy1 === anatomy2 && frameDifference <= maxFrameTolerance) {
      return true;
    }

    const isContrastPair = (
      (seriesDesc1.includes('head') && seriesDesc2.includes('head')) ||
      (seriesDesc1.includes('brain') && seriesDesc2.includes('brain'))
    ) && (
      (seriesDesc1.includes('+c') || seriesDesc1.includes('contrast')) !==
      (seriesDesc2.includes('+c') || seriesDesc2.includes('contrast'))
    );

    if (isContrastPair && frameDifference <= maxFrameTolerance) {
      return true;
    }

    if (metadata1.ImageOrientationPatient && metadata2.ImageOrientationPatient) {
      const iop1 = metadata1.ImageOrientationPatient;
      const iop2 = metadata2.ImageOrientationPatient;
      
      const tolerance = 0.01;
      const orientationMatch = iop1.every((value, index) => 
        Math.abs(value - iop2[index]) < tolerance
      );
      
      if (!orientationMatch) {
        return false;
      }
    }

    if (!anatomy1 || !anatomy2 || anatomy1 === anatomy2) {
      if (frameDifference <= maxFrameTolerance) {
        return true;
      }
    }

    return false;
  };


  const { measurementServiceSource } = this;

  function _getActiveViewportEnabledElement() {
    return getActiveViewportEnabledElement(viewportGridService);
  }

  function _getActiveViewportToolGroupId() {
    const viewport = _getActiveViewportEnabledElement();
    return toolGroupService.getToolGroupForViewport(viewport.id);
  }

  const directWheelZoom = event => {
    const viewportElement = event.target.closest('.cornerstone-viewport-element');
    if (!viewportElement) return;

    const scrollWheelTool = localStorage.getItem('scrollWheelTool');
    if (scrollWheelTool !== 'Zoom') return;

    if (
      event.target.classList.contains('tool-active') ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    )
      return;

    event.preventDefault();
    event.stopPropagation();

    const getZoomFactor = () => {
      try {
        const saved = localStorage.getItem('zoomSpeed');
        const factor = saved && saved !== 'NaN' ? parseFloat(saved) : 0.1;
        const validFactor = isNaN(factor) ? 0.1 : factor;

        if (validFactor <= 0.075) return 0.5;
        if (validFactor <= 0.15) return 1;
        if (validFactor <= 0.29) return 2;
        if (validFactor <= 0.39) return 3;
        return 4;
      } catch (error) {
        return 1;
      }
    };

    try {
      const enabledElement = getEnabledElement(viewportElement);
      if (enabledElement && enabledElement.viewport) {
        const { viewport } = enabledElement;
        if (
          viewport &&
          typeof viewport.getZoom === 'function' &&
          typeof viewport.setZoom === 'function'
        ) {
          const currentZoom = viewport.getZoom();

          const zoomFactor = getZoomFactor();
          const baseStep = 0.05 * 0.75;
          const zoomStep = baseStep * zoomFactor;

          const direction = event.deltaY > 0 ? -zoomStep : zoomStep;
          const newZoom = currentZoom * (1 + direction);

          const clampedZoom = newZoom;

          const camera = viewport.getCamera();
          const { parallelScale } = camera;
          const zoomRatio = clampedZoom / currentZoom;
          const newParallelScale = parallelScale / zoomRatio;
          
          const updatedCamera = {
            ...camera,
            parallelScale: newParallelScale
          };
          
          viewport.setCamera(updatedCamera);
          viewport.render();
          
          const viewportId = viewport.id;
          if (viewportId) {
            cornerstoneViewportService.storePresentation({ viewportId });
          }
        }
      }
    } catch (error) {
    }
  };

  if (typeof document !== 'undefined') {
    document.removeEventListener('wheel', directWheelZoom);
    document.addEventListener('wheel', directWheelZoom, { passive: false });
  }

  const actions = {
    /**
     * Generates the selector props for the context menu, specific to
     * the cornerstone viewport, and then runs the context menu.
     */
    showCornerstoneContextMenu: options => {
      const element = _getActiveViewportEnabledElement()?.viewport?.element;

      const optionsToUse = { ...options, element };
      const { useSelectedAnnotation, nearbyToolData, event } = optionsToUse;

      // This code is used to invoke the context menu via keyboard shortcuts
      if (useSelectedAnnotation && !nearbyToolData) {
        const firstAnnotationSelected = getFirstAnnotationSelected(element);
        // filter by allowed selected tools from config property (if there is any)
        const isToolAllowed =
          !optionsToUse.allowedSelectedTools ||
          optionsToUse.allowedSelectedTools.includes(firstAnnotationSelected?.metadata?.toolName);
        if (isToolAllowed) {
          optionsToUse.nearbyToolData = firstAnnotationSelected;
        } else {
          return;
        }
      }

      optionsToUse.defaultPointsPosition = [];
      // if (optionsToUse.nearbyToolData) {
      //   optionsToUse.defaultPointsPosition = commandsManager.runCommand(
      //     'getToolDataActiveCanvasPoints',
      //     { toolData: optionsToUse.nearbyToolData }
      //   );
      // }

      // TODO - make the selectorProps richer by including the study metadata and display set.
      optionsToUse.selectorProps = {
        toolName: optionsToUse.nearbyToolData?.metadata?.toolName,
        value: optionsToUse.nearbyToolData,
        uid: optionsToUse.nearbyToolData?.annotationUID,
        nearbyToolData: optionsToUse.nearbyToolData,
        event,
        ...optionsToUse.selectorProps,
      };

      commandsManager.run(options, optionsToUse);
    },
    updateStoredSegmentationPresentation: ({ displaySet, type }) => {
      const { addSegmentationPresentationItem } = useSegmentationPresentationStore.getState();

      const referencedDisplaySetInstanceUID = displaySet.referencedDisplaySetInstanceUID;
      addSegmentationPresentationItem(referencedDisplaySetInstanceUID, {
        segmentationId: displaySet.displaySetInstanceUID,
        hydrated: true,
        type,
      });
    },
    updateStoredPositionPresentation: ({ viewportId, displaySetInstanceUID }) => {
      const presentations = cornerstoneViewportService.getPresentations(viewportId);
      const { positionPresentationStore, setPositionPresentation, getPositionPresentationId } =
        usePositionPresentationStore.getState();

      // Look inside positionPresentationStore and find the key that includes the displaySetInstanceUID
      // and the value has viewportId as activeViewportId.
      const previousReferencedDisplaySetStoreKey = Object.entries(positionPresentationStore).find(
        ([key, value]) => key.includes(displaySetInstanceUID) && value.viewportId === viewportId
      )?.[0];

      if (previousReferencedDisplaySetStoreKey) {
        setPositionPresentation(
          previousReferencedDisplaySetStoreKey,
          presentations.positionPresentation
        );

        return;
      }

      // if not found means we have not visited that referencedDisplaySetInstanceUID before
      // so we need to grab the positionPresentationId directly from the store,
      // Todo: this is really hacky, we should have a better way for this

      const positionPresentationId = getPositionPresentationId({
        displaySetInstanceUIDs: [displaySetInstanceUID],
        viewportId,
      });

      setPositionPresentation(positionPresentationId, presentations.positionPresentation);
    },
    getNearbyToolData({ nearbyToolData, element, canvasCoordinates }) {
      return nearbyToolData ?? cstUtils.getAnnotationNearPoint(element, canvasCoordinates);
    },
    getNearbyAnnotation({ element, canvasCoordinates }) {
      const nearbyToolData = actions.getNearbyToolData({
        nearbyToolData: null,
        element,
        canvasCoordinates,
      });

      const isAnnotation = toolName => {
        const enabledElement = getEnabledElement(element);

        if (!enabledElement) {
          return;
        }

        const { renderingEngineId, viewportId } = enabledElement;
        const toolGroup = ToolGroupManager.getToolGroupForViewport(viewportId, renderingEngineId);

        const toolInstance = toolGroup.getToolInstance(toolName);

        return toolInstance?.constructor?.isAnnotation ?? true;
      };

      return nearbyToolData?.metadata?.toolName && isAnnotation(nearbyToolData.metadata.toolName)
        ? nearbyToolData
        : null;
    },
    /** Delete the given measurement */
    deleteMeasurement: ({ uid }) => {
      if (uid) {
        measurementServiceSource.remove(uid);
      }
    },
    /**
     * Show the measurement labelling input dialog and update the label
     * on the measurement with a response if not cancelled.
     */
    setMeasurementLabel: ({ uid }) => {
      const labelConfig = customizationService.get('measurementLabels');
      const measurement = measurementService.getMeasurement(uid);
      showLabelAnnotationPopup(measurement, uiDialogService, labelConfig).then(
        (val: Map<any, any>) => {
          measurementService.update(
            uid,
            {
              ...val,
            },
            true
          );
        }
      );
    },

    /**
     *
     * @param props - containing the updates to apply
     * @param props.measurementKey - chooses the measurement key to apply the
     *        code to.  This will typically be finding or site to apply a
     *        finding code or a findingSites code.
     * @param props.code - A coding scheme value from DICOM, including:
     *       * CodeValue - the language independent code, for example '1234'
     *       * CodingSchemeDesignator - the issue of the code value
     *       * CodeMeaning - the text value shown to the user
     *       * ref - a string reference in the form `<designator>:<codeValue>`
     *       * Other fields
     *     Note it is a valid option to remove the finding or site values by
     *     supplying null for the code.
     * @param props.uid - the measurement UID to find it with
     * @param props.label - the text value for the code.  Has NOTHING to do with
     *        the measurement label, which can be set with textLabel
     * @param props.textLabel is the measurement label to apply.  Set to null to
     *            delete.
     *
     * If the measurementKey is `site`, then the code will also be added/replace
     * the 0 element of findingSites.  This behaviour is expected to be enhanced
     * in the future with ability to set other site information.
     */
    updateMeasurement: props => {
      const { code, uid, textLabel, label } = props;
      const measurement = measurementService.getMeasurement(uid);
      const updatedMeasurement = {
        ...measurement,
      };
      // Call it textLabel as the label value
      // TODO - remove the label setting when direct rendering of findingSites is enabled
      if (textLabel !== undefined) {
        updatedMeasurement.label = textLabel;
      }
      if (code !== undefined) {
        const measurementKey = code.type || 'finding';

        if (code.ref && !code.CodeValue) {
          const split = code.ref.indexOf(':');
          code.CodeValue = code.ref.substring(split + 1);
          code.CodeMeaning = code.text || label;
          code.CodingSchemeDesignator = code.ref.substring(0, split);
        }
        updatedMeasurement[measurementKey] = code;
        // TODO - remove this line once the measurements table customizations are in
        if (measurementKey !== 'finding') {
          if (updatedMeasurement.findingSites) {
            updatedMeasurement.findingSites = updatedMeasurement.findingSites.filter(
              it => it.type !== measurementKey
            );
            updatedMeasurement.findingSites.push(code);
          } else {
            updatedMeasurement.findingSites = [code];
          }
        }
      }
      measurementService.update(updatedMeasurement.uid, updatedMeasurement, true);
    },

    // Retrieve value commands
    getActiveViewportEnabledElement: _getActiveViewportEnabledElement,

    setViewportActive: ({ viewportId }) => {
      const viewportInfo = cornerstoneViewportService.getViewportInfo(viewportId);
      if (!viewportInfo) {
        console.warn('No viewport found for viewportId:', viewportId);
        return;
      }

      viewportGridService.setActiveViewportId(viewportId);
    },
    arrowTextCallback: ({ callback, data, uid }) => {
      const labelConfig = customizationService.get('measurementLabels');
      callLabelAutocompleteDialog(uiDialogService, callback, {}, labelConfig);
    },
    toggleCine: () => {
      const { viewports } = viewportGridService.getState();
      const { isCineEnabled } = cineService.getState();
      cineService.setIsCineEnabled(!isCineEnabled);
      viewports.forEach((_, index) => cineService.setCine({ id: index, isPlaying: false }));
    },

    /**
     * Toggle viewport overlay (the information panel shown on the four corners
     * of the viewport)
     * @see ViewportOverlay and CustomizableViewportOverlay components
     */
    toggleOverlays: () => {
      const overlays = document.getElementsByClassName('viewport-overlay');
      for (let i = 0; i < overlays.length; i++) {
        overlays.item(i).classList.toggle('hidden');
      }
    },

    setViewportWindowLevel({ viewportId, window, level }) {
      // convert to numbers
      const windowWidthNum = Number(window);
      const windowCenterNum = Number(level);

      // get actor from the viewport
      const renderingEngine = cornerstoneViewportService.getRenderingEngine();
      const viewport = renderingEngine.getViewport(viewportId);

      const { lower, upper } = csUtils.windowLevel.toLowHighRange(windowWidthNum, windowCenterNum);

      viewport.setProperties({
        voiRange: {
          upper,
          lower,
        },
      });
      viewport.render();
    },

    toggleViewportColorbar: ({ viewportId, displaySetInstanceUIDs, options = {} }) => {
      const hasColorbar = colorbarService.hasColorbar(viewportId);
      if (hasColorbar) {
        colorbarService.removeColorbar(viewportId);
        return;
      }
      colorbarService.addColorbar(viewportId, displaySetInstanceUIDs, options);
    },

    setWindowLevel(props) {
      const { toolGroupId } = props;
      const { viewportId } = _getActiveViewportEnabledElement();
      const viewportToolGroupId = toolGroupService.getToolGroupForViewport(viewportId);

      if (toolGroupId && toolGroupId !== viewportToolGroupId) {
        return;
      }

      actions.setViewportWindowLevel({ ...props, viewportId });
    },
    setToolEnabled: ({ toolName, toggle, toolGroupId }) => {
      const { viewports } = viewportGridService.getState();

      if (!viewports.size) {
        return;
      }

      const toolGroup = toolGroupService.getToolGroup(toolGroupId ?? null);

      if (!toolGroup || !toolGroup.hasTool(toolName)) {
        return;
      }

      const toolIsEnabled = toolGroup.getToolOptions(toolName).mode === Enums.ToolModes.Enabled;

      // Toggle the tool's state only if the toggle is true
      if (toggle) {
        toolIsEnabled ? toolGroup.setToolDisabled(toolName) : toolGroup.setToolEnabled(toolName);
      } else {
        toolGroup.setToolEnabled(toolName);
      }

      const renderingEngine = cornerstoneViewportService.getRenderingEngine();
      renderingEngine.render();
    },
    toggleEnabledDisabledToolbar({ value, itemId, toolGroupId }) {
      const toolName = itemId || value;
      toolGroupId = toolGroupId ?? _getActiveViewportToolGroupId();

      const toolGroup = toolGroupService.getToolGroup(toolGroupId);
      if (!toolGroup || !toolGroup.hasTool(toolName)) {
        return;
      }

      const toolIsEnabled = toolGroup.getToolOptions(toolName).mode === Enums.ToolModes.Enabled;

      toolIsEnabled ? toolGroup.setToolDisabled(toolName) : toolGroup.setToolEnabled(toolName);
    },
    toggleActiveDisabledToolbar({ value, itemId, toolGroupId }) {
      const toolName = itemId || value;
      toolGroupId = toolGroupId ?? _getActiveViewportToolGroupId();
      const toolGroup = toolGroupService.getToolGroup(toolGroupId);
      if (!toolGroup || !toolGroup.hasTool(toolName)) {
        return;
      }

      const toolIsActive = [
        Enums.ToolModes.Active,
        Enums.ToolModes.Enabled,
        Enums.ToolModes.Passive,
      ].includes(toolGroup.getToolOptions(toolName).mode);

      toolIsActive
        ? toolGroup.setToolDisabled(toolName)
        : actions.setToolActive({ toolName, toolGroupId });

      // we should set the previously active tool to active after we set the
      // current tool disabled
      if (toolIsActive) {
        const prevToolName = toolGroup.getPrevActivePrimaryToolName();
        if (prevToolName !== toolName) {
          actions.setToolActive({ toolName: prevToolName, toolGroupId });
        }
      }
    },
    setToolActiveToolbar: ({ value, itemId, toolName, toolGroupIds = [] }) => {
      // Sometimes it is passed as value (tools with options), sometimes as itemId (toolbar buttons)
      toolName = toolName || itemId || value;

      toolGroupIds = toolGroupIds.length ? toolGroupIds : toolGroupService.getToolGroupIds();

      toolGroupIds.forEach(toolGroupId => {
        actions.setToolActive({ toolName, toolGroupId });
      });
    },
    setToolActive: ({ toolName, toolGroupId = null }) => {
      const { viewports } = viewportGridService.getState();

      if (!viewports.size) {
        return;
      }

      const toolGroup = toolGroupService.getToolGroup(toolGroupId);

      if (!toolGroup) {
        return;
      }

      if (!toolGroup.hasTool(toolName)) {
        return;
      }

      const activeToolName = toolGroup.getActivePrimaryMouseButtonTool();

      if (activeToolName) {
        const activeToolOptions = toolGroup.getToolConfiguration(activeToolName);
        activeToolOptions?.disableOnPassive
          ? toolGroup.setToolDisabled(activeToolName)
          : toolGroup.setToolPassive(activeToolName);
      }

      // Set the new toolName to be active
      toolGroup.setToolActive(toolName, {
        bindings: [
          {
            mouseButton: Enums.MouseBindings.Primary,
          },
        ],
      });
    },
    showDownloadViewportModal: () => {
      const { activeViewportId } = viewportGridService.getState();

      if (!cornerstoneViewportService.getCornerstoneViewport(activeViewportId)) {
        // Cannot download a non-cornerstone viewport (image).
        uiNotificationService.show({
          title: 'Download Image',
          message: 'Image cannot be downloaded',
          type: 'error',
        });
        return;
      }

      const { uiModalService } = servicesManager.services;

      if (uiModalService) {
        uiModalService.show({
          content: CornerstoneViewportDownloadForm,
          title: 'Download High Quality Image',
          contentProps: {
            activeViewportId,
            onClose: uiModalService.hide,
            cornerstoneViewportService,
          },
          containerDimensions: 'w-[70%] max-w-[900px]',
        });
      }
    },
    openNewWindow: () => {
      let windows = JSON.parse(localStorage.getItem('windowData')) || [];
      const existingWindow = windows.find(win => win.closed && win.id !== 'viewerWindow');

      if (existingWindow) {
        const { width, height, x, y, id, closed } = existingWindow;

        const newWin = window.open(
          window.location.href,
          id,
          `width=${width},height=${height},left=${x},top=${y}`
        );

        if (newWin) {
          existingWindow.closed = false;
          localStorage.setItem('windowData', JSON.stringify(windows));
        }
      } else {
        const newId = `viewerWindow-${Date.now()}`;
        const newWin = window.open(window.location.href, newId);
        if (newWin) {
          const newWindowData = {
            id: newId,
            x: window.screenX,
            y: window.screenY,
            width: window.outerWidth,
            height: window.outerHeight,
            closed: false,
          };

          windows.push(newWindowData);
          localStorage.setItem('windowData', JSON.stringify(windows));
        }
      }
    },
    closeWindows: () => {
      let windows = JSON.parse(localStorage.getItem('windowData')) || [];
      windows.forEach(win => {
        const childWindow = window.open('', win.id);
        if (childWindow) {
          childWindow.close();
          win.closed = true;
        }
      });
      localStorage.setItem('windowData', JSON.stringify(windows));
      window.close(); // Close the current window
    },
    rotateViewport: ({ rotation }) => {
      const enabledElement = _getActiveViewportEnabledElement();
      if (!enabledElement) {
        return;
      }

      const { viewport } = enabledElement;

      if (viewport instanceof BaseVolumeViewport) {
        const camera = viewport.getCamera();
        const rotAngle = (rotation * Math.PI) / 180;
        const rotMat = mat4.identity(new Float32Array(16));
        mat4.rotate(rotMat, rotMat, rotAngle, camera.viewPlaneNormal);
        const rotatedViewUp = vec3.transformMat4(vec3.create(), camera.viewUp, rotMat);
        viewport.setCamera({ viewUp: rotatedViewUp as CoreTypes.Point3 });
        viewport.render();
      } else if (viewport.getRotation !== undefined) {
        const presentation = viewport.getViewPresentation();
        const currentRotation = presentation.rotation || 0;
        const newRotation = (currentRotation + rotation + 360) % 360;
        viewport.setViewPresentation({ rotation: newRotation });
        viewport.render();
      }

      try {
        if (servicesManager?.services?.viewportPersistenceService && enabledElement.viewport?.id) {
          const viewportPersistenceService = servicesManager.services.viewportPersistenceService;
          if (typeof viewportPersistenceService.storeRotationFlipState === 'function') {
            viewportPersistenceService.storeRotationFlipState(enabledElement.viewport.id);
          }
        }
      } catch (error) {
        console.warn('❌ Failed to store rotation state:', error);
      }
    },

    flipViewportHorizontal: () => {
      const enabledElement = _getActiveViewportEnabledElement();
      if (!enabledElement) {
        return;
      }

      const { viewport } = enabledElement;
      const { flipHorizontal } = viewport.getCamera();
      viewport.setCamera({ flipHorizontal: !flipHorizontal });
      viewport.render();

      try {
        if (servicesManager?.services?.viewportPersistenceService && viewport?.id) {
          const viewportPersistenceService = servicesManager.services.viewportPersistenceService;
          if (typeof viewportPersistenceService.storeRotationFlipState === 'function') {
            viewportPersistenceService.storeRotationFlipState(viewport.id);
          }
        }
      } catch (error) {
      }
    },

    flipViewportVertical: () => {
      const enabledElement = _getActiveViewportEnabledElement();
      if (!enabledElement) {
        return;
      }

      const { viewport } = enabledElement;
      const { flipVertical } = viewport.getCamera();
      viewport.setCamera({ flipVertical: !flipVertical });
      viewport.render();

      try {
        if (servicesManager?.services?.viewportPersistenceService && viewport?.id) {
          const viewportPersistenceService = servicesManager.services.viewportPersistenceService;
          if (typeof viewportPersistenceService.storeRotationFlipState === 'function') {
            viewportPersistenceService.storeRotationFlipState(viewport.id);
          }
        }
      } catch (error) {
      }
    },
    invertViewport: ({ element }) => {
      let enabledElement;

      if (element === undefined) {
        enabledElement = _getActiveViewportEnabledElement();
      } else {
        enabledElement = element;
      }

      if (!enabledElement) {
        return;
      }

      const { viewport } = enabledElement;

      const { invert } = viewport.getProperties();
      viewport.setProperties({ invert: !invert });
      viewport.render();
    },
    resetViewport: () => {
      const enabledElement = _getActiveViewportEnabledElement();

      if (!enabledElement) {
        return;
      }

      const { viewport } = enabledElement;

      viewport.resetProperties?.();
      viewport.resetCamera();

      viewport.render();
    },
    scaleViewport: ({ direction }) => {
      const enabledElement = _getActiveViewportEnabledElement();

      const getZoomSpeed = () => {
        try {
          const saved = localStorage.getItem('zoomSpeed');
          return saved ? parseFloat(saved) : 0.1; // Default 10% zoom
        } catch (error) {
          console.warn('Failed to load zoom speed preference:', error);
          return 0.1;
        }
      };

      const zoomSpeed = getZoomSpeed();
      const scaleFactor = direction > 0 ? 1 - zoomSpeed : 1 + zoomSpeed;

      if (!enabledElement) {
        return;
      }
      const { viewport } = enabledElement;

      if (viewport instanceof StackViewport) {
        if (direction) {
          const { parallelScale } = viewport.getCamera();
          viewport.setCamera({ parallelScale: parallelScale * scaleFactor });
          viewport.render();
        } else {
          viewport.resetCamera();
          viewport.render();
        }
      }
    },

    /** Jumps the active viewport or the specified one to the given slice index */
    jumpToImage: ({ imageIndex, viewport: gridViewport }): void => {
      // Get current active viewport (return if none active)
      let viewport;
      if (!gridViewport) {
        const enabledElement = _getActiveViewportEnabledElement();
        if (!enabledElement) {
          return;
        }
        viewport = enabledElement.viewport;
      } else {
        viewport = cornerstoneViewportService.getCornerstoneViewport(gridViewport.id);
      }

      // Get number of slices
      // -> Copied from cornerstone3D jumpToSlice\_getImageSliceData()
      let numberOfSlices = 0;

      if (viewport instanceof StackViewport) {
        numberOfSlices = viewport.getImageIds().length;
      } else if (viewport instanceof VolumeViewport) {
        numberOfSlices = csUtils.getImageSliceDataForVolumeViewport(viewport).numberOfSlices;
      } else {
        throw new Error('Unsupported viewport type');
      }

      const jumpIndex = imageIndex < 0 ? numberOfSlices + imageIndex : imageIndex;
      if (jumpIndex >= numberOfSlices || jumpIndex < 0) {
        throw new Error(`Can't jump to ${imageIndex}`);
      }

      // Set slice to last slice
      const options = { imageIndex: jumpIndex };
      csUtils.jumpToSlice(viewport.element, options);
    },
    scroll: ({ direction }) => {
      const enabledElement = _getActiveViewportEnabledElement();

      if (!enabledElement) {
        return;
      }

      const { viewport } = enabledElement;
      const options = { delta: direction };

      csUtils.scroll(viewport, options);
    },
    setViewportColormap: ({
      viewportId,
      displaySetInstanceUID,
      colormap,
      opacity = 1,
      immediate = false,
    }) => {
      const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);

      let hpOpacity;
      // Retrieve active protocol's viewport match details
      const { viewportMatchDetails } = hangingProtocolService.getActiveProtocol();
      // Get display set options for the specified viewport ID
      const displaySetsInfo = viewportMatchDetails.get(viewportId)?.displaySetsInfo;

      if (displaySetsInfo) {
        // Find the display set that matches the given UID
        const matchingDisplaySet = displaySetsInfo.find(
          displaySet => displaySet.displaySetInstanceUID === displaySetInstanceUID
        );
        // If a matching display set is found, update the opacity with its value
        hpOpacity = matchingDisplaySet?.displaySetOptions?.options?.colormap?.opacity;
      }

      // HP takes priority over the default opacity
      colormap = { ...colormap, opacity: hpOpacity || opacity };

      if (viewport instanceof StackViewport) {
        viewport.setProperties({ colormap });
      }

      if (viewport instanceof VolumeViewport) {
        if (!displaySetInstanceUID) {
          const { viewports } = viewportGridService.getState();
          displaySetInstanceUID = viewports.get(viewportId)?.displaySetInstanceUIDs[0];
        }

        const volumeId = viewport.getVolumeId();
        viewport.setProperties({ colormap }, volumeId);
      }

      if (immediate) {
        viewport.render();
      }
    },
    changeActiveViewport: ({ direction = 1 }) => {
      const { activeViewportId, viewports } = viewportGridService.getState();
      const viewportIds = Array.from(viewports.keys());
      const currentIndex = viewportIds.indexOf(activeViewportId);
      const nextViewportIndex =
        (currentIndex + direction + viewportIds.length) % viewportIds.length;
      viewportGridService.setActiveViewportId(viewportIds[nextViewportIndex] as string);
    },
    /**
     * If the syncId is given and a synchronizer with that ID already exists, it will
     * toggle it on/off for the provided viewports. If not, it will attempt to create
     * a new synchronizer using the given syncId and type for the specified viewports.
     * If no viewports are provided, you may notice some default behavior.
     * - 'voi' type, we will aim to synchronize all viewports with the same modality
     * -'imageSlice' type, we will aim to synchronize all viewports with the same orientation.
     *
     * @param options
     * @param options.viewports - The viewports to synchronize
     * @param options.syncId - The synchronization group ID
     * @param options.type - The type of synchronization to perform
     */
    toggleSynchronizer: ({ type, viewports, syncId }) => {
      const synchronizer = syncGroupService.getSynchronizer(syncId);

      if (synchronizer) {
        synchronizer.isDisabled() ? synchronizer.setEnabled(true) : synchronizer.setEnabled(false);
        return;
      }

      const fn = toggleSyncFunctions[type];

      if (fn) {
        fn({
          servicesManager,
          viewports,
          syncId,
        });
      }
    },
    setSourceViewportForReferenceLinesTool: ({ viewportId }) => {
      if (!viewportId) {
        const { activeViewportId } = viewportGridService.getState();
        viewportId = activeViewportId ?? 'default';
      }

      const toolGroup = toolGroupService.getToolGroupForViewport(viewportId);

      toolGroup?.setToolConfiguration(
        ReferenceLinesTool.toolName,
        {
          sourceViewportId: viewportId,
        },
        true // overwrite
      );

      const renderingEngine = cornerstoneViewportService.getRenderingEngine();
      renderingEngine.render();
    },
    storePresentation: ({ viewportId }) => {
      cornerstoneViewportService.storePresentation({ viewportId });
    },
    updateVolumeData: ({ volume }) => {
      // update vtkOpenGLTexture and imageData of computed volume
      const { imageData, vtkOpenGLTexture } = volume;
      const numSlices = imageData.getDimensions()[2];
      const slicesToUpdate = [...Array(numSlices).keys()];
      slicesToUpdate.forEach(i => {
        vtkOpenGLTexture.setUpdatedFrame(i);
      });
      imageData.modified();
    },

    attachProtocolViewportDataListener: ({ protocol, stageIndex }) => {
      const EVENT = cornerstoneViewportService.EVENTS.VIEWPORT_DATA_CHANGED;
      const command = protocol.callbacks.onViewportDataInitialized;
      const numPanes = protocol.stages?.[stageIndex]?.viewports.length ?? 1;
      let numPanesWithData = 0;
      const { unsubscribe } = cornerstoneViewportService.subscribe(EVENT, evt => {
        numPanesWithData++;

        if (numPanesWithData === numPanes) {
          commandsManager.run(...command);

          // Unsubscribe from the event
          unsubscribe(EVENT);
        }
      });
    },

    setViewportPreset: ({ viewportId, preset }) => {
      const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
      if (!viewport) {
        return;
      }
      viewport.setProperties({
        preset,
      });
      viewport.render();
    },

    /**
     * Sets the volume quality for a given viewport.
     * @param {string} viewportId - The ID of the viewport to set the volume quality.
     * @param {number} volumeQuality - The desired quality level of the volume rendering.
     */

    setVolumeRenderingQulaity: ({ viewportId, volumeQuality }) => {
      const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
      const { actor } = viewport.getActors()[0];
      const mapper = actor.getMapper();
      const image = mapper.getInputData();
      const dims = image.getDimensions();
      const spacing = image.getSpacing();
      const spatialDiagonal = vec3.length(
        vec3.fromValues(dims[0] * spacing[0], dims[1] * spacing[1], dims[2] * spacing[2])
      );

      let sampleDistance = spacing.reduce((a, b) => a + b) / 3.0;
      sampleDistance /= volumeQuality > 1 ? 0.5 * volumeQuality ** 2 : 1.0;
      const samplesPerRay = spatialDiagonal / sampleDistance + 1;
      mapper.setMaximumSamplesPerRay(samplesPerRay);
      mapper.setSampleDistance(sampleDistance);
      viewport.render();
    },

    /**
     * Shifts opacity points for a given viewport id.
     * @param {string} viewportId - The ID of the viewport to set the mapping range.
     * @param {number} shift - The shift value to shift the points by.
     */
    shiftVolumeOpacityPoints: ({ viewportId, shift }) => {
      const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
      const { actor } = viewport.getActors()[0];
      const ofun = actor.getProperty().getScalarOpacity(0);

      const opacityPointValues = []; // Array to hold values
      // Gather Existing Values
      const size = ofun.getSize();
      for (let pointIdx = 0; pointIdx < size; pointIdx++) {
        const opacityPointValue = [0, 0, 0, 0];
        ofun.getNodeValue(pointIdx, opacityPointValue);
        // opacityPointValue now holds [xLocation, opacity, midpoint, sharpness]
        opacityPointValues.push(opacityPointValue);
      }
      // Add offset
      opacityPointValues.forEach(opacityPointValue => {
        opacityPointValue[0] += shift; // Change the location value
      });
      // Set new values
      ofun.removeAllPoints();
      opacityPointValues.forEach(opacityPointValue => {
        ofun.addPoint(...opacityPointValue);
      });
      viewport.render();
    },

    /**
     * Sets the volume lighting settings for a given viewport.
     * @param {string} viewportId - The ID of the viewport to set the lighting settings.
     * @param {Object} options - The lighting settings to be set.
     * @param {boolean} options.shade - The shade setting for the lighting.
     * @param {number} options.ambient - The ambient setting for the lighting.
     * @param {number} options.diffuse - The diffuse setting for the lighting.
     * @param {number} options.specular - The specular setting for the lighting.
     **/

    setVolumeLighting: ({ viewportId, options }) => {
      const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
      const { actor } = viewport.getActors()[0];
      const property = actor.getProperty();

      if (options.shade !== undefined) {
        property.setShade(options.shade);
      }

      if (options.ambient !== undefined) {
        property.setAmbient(options.ambient);
      }

      if (options.diffuse !== undefined) {
        property.setDiffuse(options.diffuse);
      }

      if (options.specular !== undefined) {
        property.setSpecular(options.specular);
      }

      viewport.render();
    },
    resetCrosshairs: ({ viewportId }) => {
      const crosshairInstances = [];

      const getCrosshairInstances = toolGroupId => {
        const toolGroup = toolGroupService.getToolGroup(toolGroupId);
        crosshairInstances.push(toolGroup.getToolInstance('Crosshairs'));
      };

      if (!viewportId) {
        const toolGroupIds = toolGroupService.getToolGroupIds();
        toolGroupIds.forEach(getCrosshairInstances);
      } else {
        const toolGroup = toolGroupService.getToolGroupForViewport(viewportId);
        getCrosshairInstances(toolGroup.id);
      }

      crosshairInstances.forEach(ins => {
        ins?.computeToolCenter();
      });
    },
    /**
     * Creates a labelmap for the active viewport
     */
    createLabelmapForViewport: async ({ viewportId, options = {} }) => {
      const { viewportGridService, displaySetService, segmentationService } =
        servicesManager.services;
      const { viewports } = viewportGridService.getState();
      const targetViewportId = viewportId;

      const viewport = viewports.get(targetViewportId);

      // Todo: add support for multiple display sets
      const displaySetInstanceUID =
        options.displaySetInstanceUID || viewport.displaySetInstanceUIDs[0];

      const segs = segmentationService.getSegmentations();

      const label = options.label || `Segmentation ${segs.length + 1}`;
      const segmentationId = options.segmentationId || `${csUtils.uuidv4()}`;

      const displaySet = displaySetService.getDisplaySetByUID(displaySetInstanceUID);

      const generatedSegmentationId = await segmentationService.createLabelmapForDisplaySet(
        displaySet,
        {
          label,
          segmentationId,
          segments: options.createInitialSegment
            ? {
                1: {
                  label: 'Segment 1',
                  active: true,
                },
              }
            : {},
        }
      );

      await segmentationService.addSegmentationRepresentation(viewportId, {
        segmentationId,
        type: Enums.SegmentationRepresentations.Labelmap,
      });

      return generatedSegmentationId;
    },

    /**
     * Sets the active segmentation for a viewport
     * @param props.segmentationId - The ID of the segmentation to set as active
     */
    setActiveSegmentation: ({ segmentationId }) => {
      const { viewportGridService, segmentationService } = servicesManager.services;
      segmentationService.setActiveSegmentation(
        viewportGridService.getActiveViewportId(),
        segmentationId
      );
    },

    /**
     * Adds a new segment to a segmentation
     * @param props.segmentationId - The ID of the segmentation to add the segment to
     */
    addSegmentCommand: ({ segmentationId }) => {
      const { segmentationService } = servicesManager.services;
      segmentationService.addSegment(segmentationId);
    },

    /**
     * Sets the active segment and jumps to its center
     * @param props.segmentationId - The ID of the segmentation
     * @param props.segmentIndex - The index of the segment to activate
     */
    setActiveSegmentAndCenterCommand: ({ segmentationId, segmentIndex }) => {
      const { segmentationService } = servicesManager.services;
      segmentationService.setActiveSegment(segmentationId, segmentIndex);
      segmentationService.jumpToSegmentCenter(segmentationId, segmentIndex);
    },

    /**
     * Toggles the visibility of a segment
     * @param props.segmentationId - The ID of the segmentation
     * @param props.segmentIndex - The index of the segment
     * @param props.type - The type of visibility to toggle
     */
    toggleSegmentVisibilityCommand: ({ segmentationId, segmentIndex, type }) => {
      const { segmentationService, viewportGridService } = servicesManager.services;
      segmentationService.toggleSegmentVisibility(
        viewportGridService.getActiveViewportId(),
        segmentationId,
        segmentIndex,
        type
      );
    },

    /**
     * Toggles the lock state of a segment
     * @param props.segmentationId - The ID of the segmentation
     * @param props.segmentIndex - The index of the segment
     */
    toggleSegmentLockCommand: ({ segmentationId, segmentIndex }) => {
      const { segmentationService } = servicesManager.services;
      segmentationService.toggleSegmentLocked(segmentationId, segmentIndex);
    },

    /**
     * Toggles the visibility of a segmentation representation
     * @param props.segmentationId - The ID of the segmentation
     * @param props.type - The type of representation
     */
    toggleSegmentationVisibilityCommand: ({ segmentationId, type }) => {
      const { segmentationService, viewportGridService } = servicesManager.services;
      segmentationService.toggleSegmentationRepresentationVisibility(
        viewportGridService.getActiveViewportId(),
        { segmentationId, type }
      );
    },

    /**
     * Downloads a segmentation
     * @param props.segmentationId - The ID of the segmentation to download
     */
    downloadSegmentationCommand: ({ segmentationId }) => {
      const { segmentationService } = servicesManager.services;
      segmentationService.downloadSegmentation(segmentationId);
    },

    /**
     * Stores a segmentation and shows it in the viewport
     * @param props.segmentationId - The ID of the segmentation to store
     */
    storeSegmentationCommand: async ({ segmentationId }) => {
      const { segmentationService, viewportGridService } = servicesManager.services;
      const datasources = extensionManager.getActiveDataSource();

      const displaySetInstanceUIDs = await createReportAsync({
        servicesManager,
        getReport: () =>
          commandsManager.runCommand('storeSegmentation', {
            segmentationId,
            dataSource: datasources[0],
          }),
        reportType: 'Segmentation',
      });

      if (displaySetInstanceUIDs) {
        segmentationService.remove(segmentationId);
        viewportGridService.setDisplaySetsForViewport({
          viewportId: viewportGridService.getActiveViewportId(),
          displaySetInstanceUIDs,
        });
      }
    },

    /**
     * Downloads a segmentation as RTSS
     * @param props.segmentationId - The ID of the segmentation
     */
    downloadRTSSCommand: ({ segmentationId }) => {
      const { segmentationService } = servicesManager.services;
      segmentationService.downloadRTSS(segmentationId);
    },

    /**
     * Sets the style for a segmentation
     * @param props.segmentationId - The ID of the segmentation
     * @param props.type - The type of style
     * @param props.key - The style key to set
     * @param props.value - The style value
     */
    setSegmentationStyleCommand: ({ type, key, value }) => {
      const { segmentationService } = servicesManager.services;
      segmentationService.setStyle({ type }, { [key]: value });
    },

    /**
     * Deletes a segment from a segmentation
     * @param props.segmentationId - The ID of the segmentation
     * @param props.segmentIndex - The index of the segment to delete
     */
    deleteSegmentCommand: ({ segmentationId, segmentIndex }) => {
      const { segmentationService } = servicesManager.services;
      segmentationService.removeSegment(segmentationId, segmentIndex);
    },

    /**
     * Deletes an entire segmentation
     * @param props.segmentationId - The ID of the segmentation to delete
     */
    deleteSegmentationCommand: ({ segmentationId }) => {
      const { segmentationService } = servicesManager.services;
      segmentationService.remove(segmentationId);
    },

    /**
     * Removes a segmentation from the viewport
     * @param props.segmentationId - The ID of the segmentation to remove
     */
    removeSegmentationFromViewportCommand: ({ segmentationId }) => {
      const { segmentationService, viewportGridService } = servicesManager.services;
      segmentationService.removeSegmentationRepresentations(
        viewportGridService.getActiveViewportId(),
        { segmentationId }
      );
    },

    /**
     * Toggles rendering of inactive segmentations
     */
    toggleRenderInactiveSegmentationsCommand: () => {
      const { segmentationService, viewportGridService } = servicesManager.services;
      const viewportId = viewportGridService.getActiveViewportId();
      const renderInactive = segmentationService.getRenderInactiveSegmentations(viewportId);
      segmentationService.setRenderInactiveSegmentations(viewportId, !renderInactive);
    },

    /**
     * Sets the fill alpha value for a segmentation type
     * @param props.type - The type of segmentation
     * @param props.value - The alpha value to set
     */
    setFillAlphaCommand: ({ type, value }) => {
      const { segmentationService } = servicesManager.services;
      segmentationService.setStyle({ type }, { fillAlpha: value });
    },

    /**
     * Sets the outline width for a segmentation type
     * @param props.type - The type of segmentation
     * @param props.value - The width value to set
     */
    setOutlineWidthCommand: ({ type, value }) => {
      const { segmentationService } = servicesManager.services;
      segmentationService.setStyle({ type }, { outlineWidth: value });
    },

    /**
     * Sets whether to render fill for a segmentation type
     * @param props.type - The type of segmentation
     * @param props.value - Whether to render fill
     */
    setRenderFillCommand: ({ type, value }) => {
      const { segmentationService } = servicesManager.services;
      segmentationService.setStyle({ type }, { renderFill: value });
    },

    /**
     * Sets whether to render outline for a segmentation type
     * @param props.type - The type of segmentation
     * @param props.value - Whether to render outline
     */
    setRenderOutlineCommand: ({ type, value }) => {
      const { segmentationService } = servicesManager.services;
      segmentationService.setStyle({ type }, { renderOutline: value });
    },

    /**
     * Sets the fill alpha for inactive segmentations
     * @param props.type - The type of segmentation
     * @param props.value - The alpha value to set
     */
    setFillAlphaInactiveCommand: ({ type, value }) => {
      const { segmentationService } = servicesManager.services;
      segmentationService.setStyle({ type }, { fillAlphaInactive: value });
    },

    editSegmentLabel: ({ segmentationId, segmentIndex }) => {
      const { segmentationService, uiDialogService } = servicesManager.services;
      const segmentation = segmentationService.getSegmentation(segmentationId);

      if (!segmentation) {
        return;
      }

      const segment = segmentation.segments[segmentIndex];
      const { label } = segment;

      const callback = (label, actionId) => {
        if (label === '') {
          return;
        }

        segmentationService.setSegmentLabel(segmentationId, segmentIndex, label);
      };

      callInputDialog(uiDialogService, label, callback, false, {
        dialogTitle: 'Edit Segment Label',
        inputLabel: 'Enter new label',
      });
    },

    editSegmentationLabel: ({ segmentationId }) => {
      const { segmentationService, uiDialogService } = servicesManager.services;
      const segmentation = segmentationService.getSegmentation(segmentationId);

      if (!segmentation) {
        return;
      }

      const { label } = segmentation;

      const callback = (label, actionId) => {
        if (label === '') {
          return;
        }

        segmentationService.addOrUpdateSegmentation({ segmentationId, label });
      };

      callInputDialog(uiDialogService, label, callback, false, {
        dialogTitle: 'Edit Segmentation Label',
        inputLabel: 'Enter new label',
      });
    },

    editSegmentColor: ({ segmentationId, segmentIndex }) => {
      const { segmentationService, uiDialogService, viewportGridService } =
        servicesManager.services;
      const viewportId = viewportGridService.getActiveViewportId();
      const color = segmentationService.getSegmentColor(viewportId, segmentationId, segmentIndex);

      const rgbaColor = {
        r: color[0],
        g: color[1],
        b: color[2],
        a: color[3] / 255.0,
      };

      colorPickerDialog(uiDialogService, rgbaColor, (newRgbaColor, actionId) => {
        if (actionId === 'cancel') {
          return;
        }

        const color = [newRgbaColor.r, newRgbaColor.g, newRgbaColor.b, newRgbaColor.a * 255.0];
        segmentationService.setSegmentColor(viewportId, segmentationId, segmentIndex, color);
      });
    },

    getRenderInactiveSegmentations: () => {
      const { segmentationService, viewportGridService } = servicesManager.services;
      return segmentationService.getRenderInactiveSegmentations(
        viewportGridService.getActiveViewportId()
      );
    },

    applyMouseButtonBindings: ({ primaryTool, secondaryTool, auxiliaryTool }) => {
      try {
        const { toolGroupService } = servicesManager.services;
        const toolGroupIds = toolGroupService.getToolGroupIds();
        
        toolGroupIds.forEach(toolGroupId => {
          try {
            const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
            if (!toolGroup) {
              return;
            }
            
            // Step 1: Set the three core tools to passive to clear bindings
            const coreTools = ['WindowLevel', 'Pan', 'Zoom'];
            coreTools.forEach(tool => {
              if (toolGroup.hasTool(tool)) {
                try {
                  toolGroup.setToolPassive(tool);
                } catch (e) {
                  // Ignore errors
                }
              }
            });
            
            // Step 2: Ensure our target tools exist
            [primaryTool, secondaryTool, auxiliaryTool].forEach(tool => {
              if (tool && tool !== 'None' && !toolGroup.hasTool(tool)) {
                try {
                  toolGroup.addTool(tool);
                } catch (e) {
                }
              }
            });
            
            // Step 3: Activate tools with specific mouse button bindings
            if (primaryTool && primaryTool !== 'None') {
              toolGroup.setToolActive(primaryTool, {
                bindings: [{ mouseButton: Enums.MouseBindings.Primary }]
              });
            }
            
            if (secondaryTool && secondaryTool !== 'None') {
              toolGroup.setToolActive(secondaryTool, {
                bindings: [{ mouseButton: Enums.MouseBindings.Secondary }]
              });
            }
            
            if (auxiliaryTool && auxiliaryTool !== 'None') {
              toolGroup.setToolActive(auxiliaryTool, {
                bindings: [{ mouseButton: Enums.MouseBindings.Auxiliary }]
              });
            }
            
          } catch (error) {
            console.error(`Error configuring tool group ${toolGroupId}:`, error);
          }
        });
        
      } catch (error) {
        console.error('Error in applyMouseButtonBindings:', error);
      }
    },

    refreshPageToApplyToolBindings: () => {
      try {
        window.location.reload();
      } catch (error) {
        console.error('Error refreshing page:', error);
      }
    },
  };

  const definitions = {
    // The command here is to show the viewer context menu, as being the
    // context menu
    clearViewportPersistence: {
      commandFn: ({ servicesManager, viewportId }) => {
        const { ViewportPersistenceService, ViewportService } = servicesManager.services;

        if (ViewportPersistenceService && viewportId) {
          const viewport = ViewportService.getViewport(viewportId);
          if (viewport) {
            const hash = ViewportPersistenceService.generateViewportHash(viewport);
            ViewportPersistenceService.clearViewportState(hash);
          }
        }
      },
    },

    clearAllViewportPersistence: {
      commandFn: ({ servicesManager }) => {
        const { ViewportPersistenceService } = servicesManager.services;
        if (ViewportPersistenceService) {
          ViewportPersistenceService.clearAllViewportStates();
        }
      },
    },
    showCornerstoneContextMenu: {
      commandFn: actions.showCornerstoneContextMenu,
      options: {
        menuCustomizationId: 'measurementsContextMenu',
        commands: [
          {
            commandName: 'showContextMenu',
          },
        ],
      },
    },

    getNearbyToolData: {
      commandFn: actions.getNearbyToolData,
    },
    getNearbyAnnotation: {
      commandFn: actions.getNearbyAnnotation,
      storeContexts: [],
      options: {},
    },
    toggleViewportColorbar: {
      commandFn: actions.toggleViewportColorbar,
    },
    deleteMeasurement: {
      commandFn: actions.deleteMeasurement,
    },
    setMeasurementLabel: {
      commandFn: actions.setMeasurementLabel,
    },
    updateMeasurement: {
      commandFn: actions.updateMeasurement,
    },
    setViewportWindowLevel: {
      commandFn: actions.setViewportWindowLevel,
    },
    setWindowLevel: {
      commandFn: actions.setWindowLevel,
    },
    setToolActive: {
      commandFn: actions.setToolActive,
    },
    setToolActiveToolbar: {
      commandFn: actions.setToolActiveToolbar,
    },
    setToolEnabled: {
      commandFn: actions.setToolEnabled,
    },
    rotateViewportCW: {
      commandFn: actions.rotateViewport,
      options: { rotation: 90 },
    },
    rotateViewportCCW: {
      commandFn: actions.rotateViewport,
      options: { rotation: -90 },
    },
    incrementActiveViewport: {
      commandFn: actions.changeActiveViewport,
    },
    decrementActiveViewport: {
      commandFn: actions.changeActiveViewport,
      options: { direction: -1 },
    },
    flipViewportHorizontal: {
      commandFn: actions.flipViewportHorizontal,
    },
    flipViewportVertical: {
      commandFn: actions.flipViewportVertical,
    },
    invertViewport: {
      commandFn: actions.invertViewport,
    },
    resetViewport: {
      commandFn: actions.resetViewport,
    },
    scaleUpViewport: {
      commandFn: actions.scaleViewport,
      options: { direction: 1 },
    },
    scaleDownViewport: {
      commandFn: actions.scaleViewport,
      options: { direction: -1 },
    },
    fitViewportToWindow: {
      commandFn: actions.scaleViewport,
      options: { direction: 0 },
    },
    nextImage: {
      commandFn: actions.scroll,
      options: { direction: 1 },
    },
    previousImage: {
      commandFn: actions.scroll,
      options: { direction: -1 },
    },
    firstImage: {
      commandFn: actions.jumpToImage,
      options: { imageIndex: 0 },
    },
    lastImage: {
      commandFn: actions.jumpToImage,
      options: { imageIndex: -1 },
    },
    jumpToImage: {
      commandFn: actions.jumpToImage,
    },
    showDownloadViewportModal: {
      commandFn: actions.showDownloadViewportModal,
    },
    openNewWindow: {
      commandFn: actions.openNewWindow,
    },
    closeWindows: {
      commandFn: actions.closeWindows,
    },
    toggleCine: {
      commandFn: actions.toggleCine,
    },
    toggleOverlays: {
      commandFn: actions.toggleOverlays,
    },
    arrowTextCallback: {
      commandFn: actions.arrowTextCallback,
    },
    setViewportActive: {
      commandFn: actions.setViewportActive,
    },
    setViewportColormap: {
      commandFn: actions.setViewportColormap,
    },
    setSourceViewportForReferenceLinesTool: {
      commandFn: actions.setSourceViewportForReferenceLinesTool,
    },
    storePresentation: {
      commandFn: actions.storePresentation,
    },
    attachProtocolViewportDataListener: {
      commandFn: actions.attachProtocolViewportDataListener,
    },
    setViewportPreset: {
      commandFn: actions.setViewportPreset,
    },
    setVolumeRenderingQulaity: {
      commandFn: actions.setVolumeRenderingQulaity,
    },
    shiftVolumeOpacityPoints: {
      commandFn: actions.shiftVolumeOpacityPoints,
    },
    setVolumeLighting: {
      commandFn: actions.setVolumeLighting,
    },
    resetCrosshairs: {
      commandFn: actions.resetCrosshairs,
    },
    toggleSynchronizer: {
      commandFn: actions.toggleSynchronizer,
    },
    updateVolumeData: {
      commandFn: actions.updateVolumeData,
    },
    toggleEnabledDisabledToolbar: {
      commandFn: actions.toggleEnabledDisabledToolbar,
    },
    toggleActiveDisabledToolbar: {
      commandFn: actions.toggleActiveDisabledToolbar,
    },
    updateStoredPositionPresentation: {
      commandFn: actions.updateStoredPositionPresentation,
    },
    updateStoredSegmentationPresentation: {
      commandFn: actions.updateStoredSegmentationPresentation,
    },
    createLabelmapForViewport: {
      commandFn: actions.createLabelmapForViewport,
    },
    setActiveSegmentation: {
      commandFn: actions.setActiveSegmentation,
    },
    addSegment: {
      commandFn: actions.addSegmentCommand,
    },
    setActiveSegmentAndCenter: {
      commandFn: actions.setActiveSegmentAndCenterCommand,
    },
    toggleSegmentVisibility: {
      commandFn: actions.toggleSegmentVisibilityCommand,
    },
    toggleSegmentLock: {
      commandFn: actions.toggleSegmentLockCommand,
    },
    toggleSegmentationVisibility: {
      commandFn: actions.toggleSegmentationVisibilityCommand,
    },
    downloadSegmentation: {
      commandFn: actions.downloadSegmentationCommand,
    },
    storeSegmentation: {
      commandFn: actions.storeSegmentationCommand,
    },
    downloadRTSS: {
      commandFn: actions.downloadRTSSCommand,
    },
    setSegmentationStyle: {
      commandFn: actions.setSegmentationStyleCommand,
    },
    deleteSegment: {
      commandFn: actions.deleteSegmentCommand,
    },
    deleteSegmentation: {
      commandFn: actions.deleteSegmentationCommand,
    },
    removeSegmentationFromViewport: {
      commandFn: actions.removeSegmentationFromViewportCommand,
    },
    toggleRenderInactiveSegmentations: {
      commandFn: actions.toggleRenderInactiveSegmentationsCommand,
    },
    setFillAlpha: {
      commandFn: actions.setFillAlphaCommand,
    },
    setOutlineWidth: {
      commandFn: actions.setOutlineWidthCommand,
    },
    setRenderFill: {
      commandFn: actions.setRenderFillCommand,
    },
    setRenderOutline: {
      commandFn: actions.setRenderOutlineCommand,
    },
    setFillAlphaInactive: {
      commandFn: actions.setFillAlphaInactiveCommand,
    },
    editSegmentLabel: {
      commandFn: actions.editSegmentLabel,
    },
    editSegmentationLabel: {
      commandFn: actions.editSegmentationLabel,
    },
    editSegmentColor: {
      commandFn: actions.editSegmentColor,
    },
    getRenderInactiveSegmentations: {
      commandFn: actions.getRenderInactiveSegmentations,
    },
    applyMouseButtonBindings: {
      commandFn: actions.applyMouseButtonBindings,
    },
    refreshPageToApplyToolBindings: {
      commandFn: actions.refreshPageToApplyToolBindings,
    },
  };

  setupAutoImageSliceSync();

  return {
    actions,
    definitions,
    defaultContext: 'CORNERSTONE',
  };
}

export default commandsModule;
