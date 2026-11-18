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
// Auto groups only. The manual button's group is exactly SYNC_ID_PREFIX, and
// regrouping must leave it alone, or a click made while images are still
// loading is undone by the next regroup.
const AUTO_GROUP_PREFIX = `${SYNC_ID_PREFIX}_GROUP_`;
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

/** The slice normal from ImageOrientationPatient, or null. */
function getSliceNormal(displaySet) {
  const iop = displaySet.instances?.[0]?.ImageOrientationPatient?.map(Number);
  if (!iop || iop.length !== 6 || !iop.every(Number.isFinite)) {
    return null;
  }
  return [
    iop[1] * iop[5] - iop[2] * iop[4],
    iop[2] * iop[3] - iop[0] * iop[5],
    iop[0] * iop[4] - iop[1] * iop[3],
  ];
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Min and max slice position along `normal`, in mm, or null. */
function getSliceExtent(displaySet, normal) {
  const positions = displaySet.instances
    .map(({ ImagePositionPatient: ipp }) => (ipp?.length === 3 ? dot(ipp.map(Number), normal) : NaN))
    .filter(Number.isFinite);
  return positions.length > 1 ? [Math.min(...positions), Math.max(...positions)] : null;
}

/**
 * Looks at each pair of series open in stack viewports that no sync group
 * links. A pair position sync would line up correctly (usually thin vs thick
 * slices of the same scan: same study and frame of reference, same plane,
 * the shorter one at least 80% inside the other) wins as `syncable`.
 * Otherwise the first pair from the same scan's study says why it would not
 * line up. Returns null when there is no unlinked pair to talk about.
 */
export function findUnlinkedSyncablePair({ servicesManager }): {
  descriptions: [string, string];
  reason: 'syncable' | 'differentScan' | 'differentPlane' | 'differentAnatomy';
} | null {
  const { viewportGridService, displaySetService, syncGroupService } = servicesManager.services;
  const shown = [...viewportGridService.getState().viewports.values()]
    .map(viewport => {
      // MPR and 3D views show reformats, not the acquired slices.
      const { viewportId, viewportType } = viewport.viewportOptions ?? {};
      if (viewportType && viewportType !== 'stack') {
        return null;
      }
      // Empty viewports have no UID, and getDisplaySetByUID throws on undefined.
      const uid = viewport.displaySetInstanceUIDs?.[0];
      if (!uid) {
        return null;
      }
      const displaySet = displaySetService.getDisplaySetByUID(uid);
      const metadata = displaySet?.isReconstructable
        ? getViewportMetadata(viewport, displaySetService)
        : null;
      const normal = metadata && getSliceNormal(displaySet);
      if (!normal || !getSliceExtent(displaySet, normal)) {
        return null;
      }
      const syncIds = new Set(
        syncGroupService
          .getSynchronizersForViewport(viewportId)
          .filter(sync => sync.id.startsWith(SYNC_ID_PREFIX) && !sync.isDisabled())
          .map(sync => sync.id)
      );
      return { metadata, displaySet, normal, syncIds };
    })
    .filter(Boolean);

  let mismatch = null;
  for (let i = 0; i < shown.length; i++) {
    for (let j = i + 1; j < shown.length; j++) {
      const a = shown[i];
      const b = shown[j];
      const [ma, mb] = [a.metadata, b.metadata];
      if (
        ma.SeriesInstanceUID === mb.SeriesInstanceUID ||
        ma.StudyInstanceUID !== mb.StudyInstanceUID ||
        // Without both frames of reference we can't tell either way.
        !ma.FrameOfReferenceUID ||
        !mb.FrameOfReferenceUID ||
        [...a.syncIds].some(id => b.syncIds.has(id))
      ) {
        continue;
      }
      // Same plane even if one series runs the other way (normals opposite).
      const samePlane = Math.abs(dot(a.normal, b.normal)) > 0.99;
      // Both measured along a's normal, so a reversed series still overlaps.
      const extentA = getSliceExtent(a.displaySet, a.normal);
      const extentB = getSliceExtent(b.displaySet, a.normal);
      const overlap = Math.min(extentA[1], extentB[1]) - Math.max(extentA[0], extentB[0]);
      const shorter = Math.min(extentA[1] - extentA[0], extentB[1] - extentB[0]);
      const reason =
        ma.FrameOfReferenceUID !== mb.FrameOfReferenceUID
          ? 'differentScan'
          : !samePlane
            ? 'differentPlane'
            : overlap < 0.8 * shorter
              ? 'differentAnatomy'
              : 'syncable';
      const descriptions: [string, string] = [ma.SeriesDescription, mb.SeriesDescription];
      if (reason === 'syncable') {
        return { descriptions, reason };
      }
      mismatch ??= { descriptions, reason };
    }
  }
  return mismatch;
}

/** Tear down existing auto sync groups and regroup all populated viewports. */
export function forceEnableImageSliceSync({ servicesManager }) {
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
        if (syncState.id.startsWith(AUTO_GROUP_PREFIX)) {
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

    const syncId = `${AUTO_GROUP_PREFIX}${groupIndex}`;

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
  const { viewportGridService, toolbarService } = servicesManager.services;
  let syncTimeout = null;
  // The sync button's hint depends on the groups just built.
  const refreshSyncButton = () =>
    toolbarService?.refreshToolbarState({ viewportId: viewportGridService.getActiveViewportId() });

  const enableImageSliceSyncForAll = () => {
    const { viewports } = viewportGridService.getState();

    if (viewports.size > 1) {
      if (syncTimeout) {
        clearTimeout(syncTimeout);
      }

      syncTimeout = setTimeout(() => {
        forceEnableImageSliceSync({ servicesManager });
        refreshSyncButton();
      }, 300);
    }
  };

  const handleLayoutChange = event => {
    const { numRows, numCols } = event;

    if (numRows * numCols > 1) {
      setTimeout(() => {
        forceEnableImageSliceSync({ servicesManager });
        refreshSyncButton();
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
