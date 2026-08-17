import { eventTarget, Enums as CornerstoneEnums } from '@cornerstonejs/core';

/**
 * Radimal automatic image-slice sync.
 *
 * Stock OHIF only offers slice sync as a manual toolbar toggle. This module
 * watches the grid and image lifecycle and automatically (re)builds slice
 * sync groups so multi-viewport layouts scroll in lockstep without user
 * action. Viewports are grouped by spatial compatibility:
 * - same patient required; different studies never sync; same series always
 * - frame counts within 5% (or <=2 frames)
 * - anatomy keywords in SeriesDescription must not conflict
 * - head/brain contrast pairs (with/without +c) sync deliberately
 * - ImageOrientationPatient must match within tolerance when present
 *
 * The ImageSliceSync toolbar button remains available as a manual override.
 * Ported from the fork's setupAutoImageSliceSync (v3.10.0.73.radimal).
 */

const SYNC_ID_PREFIX = 'IMAGE_SLICE_SYNC';
const ANATOMY_KEYWORDS = [
  'head',
  'brain',
  'chest',
  'thorax',
  'thx',
  'abdomen',
  'pelvis',
  'spine',
  'neck',
];

function getViewportMetadata(viewport, displaySetService) {
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
    numImages: displaySet.instances?.length || 1,
  };
}

function areViewportsCompatibleForSync(metadata1, metadata2) {
  if (
    metadata1.PatientID &&
    metadata2.PatientID &&
    metadata1.PatientID !== metadata2.PatientID
  ) {
    return false;
  }

  if (metadata1.SeriesInstanceUID === metadata2.SeriesInstanceUID) {
    return true;
  }

  if (
    metadata1.StudyInstanceUID &&
    metadata2.StudyInstanceUID &&
    metadata1.StudyInstanceUID !== metadata2.StudyInstanceUID
  ) {
    return false;
  }

  const frameDifference = Math.abs(metadata1.numImages - metadata2.numImages);
  const frameTolerancePercent = 0.05;
  const maxFrameTolerance =
    Math.min(metadata1.numImages, metadata2.numImages) * frameTolerancePercent;

  if (frameDifference > maxFrameTolerance && frameDifference > 2) {
    return false;
  }

  const seriesDesc1 = (metadata1.SeriesDescription || '').toLowerCase();
  const seriesDesc2 = (metadata2.SeriesDescription || '').toLowerCase();

  let anatomy1 = null;
  let anatomy2 = null;

  for (const keyword of ANATOMY_KEYWORDS) {
    if (seriesDesc1.includes(keyword)) {
      anatomy1 = keyword;
    }
    if (seriesDesc2.includes(keyword)) {
      anatomy2 = keyword;
    }
  }

  if (anatomy1 && anatomy2 && anatomy1 !== anatomy2) {
    return false;
  }

  if (anatomy1 && anatomy2 && anatomy1 === anatomy2 && frameDifference <= maxFrameTolerance) {
    return true;
  }

  const isContrastPair =
    ((seriesDesc1.includes('head') && seriesDesc2.includes('head')) ||
      (seriesDesc1.includes('brain') && seriesDesc2.includes('brain'))) &&
    (seriesDesc1.includes('+c') || seriesDesc1.includes('contrast')) !==
      (seriesDesc2.includes('+c') || seriesDesc2.includes('contrast'));

  if (isContrastPair && frameDifference <= maxFrameTolerance) {
    return true;
  }

  if (metadata1.ImageOrientationPatient && metadata2.ImageOrientationPatient) {
    const iop1 = metadata1.ImageOrientationPatient;
    const iop2 = metadata2.ImageOrientationPatient;

    const tolerance = 0.01;
    const orientationMatch = iop1.every((value, index) => Math.abs(value - iop2[index]) < tolerance);

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
}

function groupViewportsByCompatibility(viewports, displaySetService) {
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
}

/** Tear down existing auto sync groups and regroup all populated viewports. */
function forceEnableImageSliceSync({ servicesManager }) {
  const { syncGroupService, viewportGridService, displaySetService, cornerstoneViewportService } =
    servicesManager.services;

  let { viewports } = viewportGridService.getState();
  viewports = [...viewports.values()];

  viewports = viewports.filter(
    viewport => viewport.displaySetInstanceUIDs && viewport.displaySetInstanceUIDs.length
  );

  viewports = viewports.filter(viewport => {
    const { displaySetInstanceUIDs } = viewport;

    for (const displaySetInstanceUID of displaySetInstanceUIDs) {
      const displaySet = displaySetService.getDisplaySetByUID(displaySetInstanceUID);

      if (displaySet && (displaySet.isReconstructable || displaySet.Modality)) {
        return true;
      }
    }
    return false;
  });

  if (viewports.length < 2) {
    return;
  }

  viewports.forEach(gridViewport => {
    const { viewportId } = gridViewport.viewportOptions;
    const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);

    if (viewport) {
      const syncStates = syncGroupService.getSynchronizersForViewport(viewportId);
      syncStates.forEach(syncState => {
        if (syncState.id.startsWith(SYNC_ID_PREFIX)) {
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

  const syncGroups = groupViewportsByCompatibility(viewports, displaySetService);

  syncGroups.forEach((viewportGroup, groupIndex) => {
    if (viewportGroup.length < 2) {
      return;
    }

    const syncId = `${SYNC_ID_PREFIX}_GROUP_${groupIndex}`;

    viewportGroup.forEach(gridViewport => {
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
}

export default function setupAutoImageSliceSync({ servicesManager }) {
  const { viewportGridService } = servicesManager.services;
  let syncTimeout = null;

  const enableImageSliceSyncForAll = () => {
    const { viewports } = viewportGridService.getState();

    if (viewports.size > 1) {
      if (syncTimeout) {
        clearTimeout(syncTimeout);
      }

      syncTimeout = setTimeout(() => {
        forceEnableImageSliceSync({ servicesManager });
      }, 300);
    }
  };

  const handleLayoutChange = event => {
    const { numRows, numCols } = event;

    if (numRows * numCols > 1) {
      setTimeout(() => {
        forceEnableImageSliceSync({ servicesManager });
      }, 200);
    }
  };

  viewportGridService.subscribe(viewportGridService.EVENTS.LAYOUT_CHANGED, handleLayoutChange);
  viewportGridService.subscribe(
    viewportGridService.EVENTS.VIEWPORTS_READY,
    enableImageSliceSyncForAll
  );
  viewportGridService.subscribe(
    viewportGridService.EVENTS.GRID_STATE_CHANGED,
    enableImageSliceSyncForAll
  );
  viewportGridService.subscribe(
    viewportGridService.EVENTS.ACTIVE_VIEWPORT_ID_CHANGED,
    enableImageSliceSyncForAll
  );

  eventTarget.addEventListener(
    CornerstoneEnums.Events.VIEWPORT_NEW_IMAGE_SET,
    enableImageSliceSyncForAll
  );
  eventTarget.addEventListener(CornerstoneEnums.Events.IMAGE_RENDERED, enableImageSliceSyncForAll);
  eventTarget.addEventListener(CornerstoneEnums.Events.STACK_NEW_IMAGE, enableImageSliceSyncForAll);
  eventTarget.addEventListener(CornerstoneEnums.Events.VOLUME_LOADED, enableImageSliceSyncForAll);
}
