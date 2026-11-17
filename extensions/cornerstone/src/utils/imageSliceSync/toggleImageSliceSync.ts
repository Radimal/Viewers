import { DisplaySetService, ViewportGridService } from '@ohif/core';

const IMAGE_SLICE_SYNC_NAME = 'IMAGE_SLICE_SYNC';

export default function toggleImageSliceSync({
  servicesManager,
  viewports: providedViewports,
  syncId,
}: withAppTypes) {
  const { syncGroupService, viewportGridService, displaySetService, cornerstoneViewportService } =
    servicesManager.services;

  syncId ||= IMAGE_SLICE_SYNC_NAME;

  const viewports =
    providedViewports || getReconstructableStackViewports(viewportGridService, displaySetService);

  // Radimal: on/off is the synchronizer itself, not the viewports on screen
  // now. A viewport that has since switched to a non-reconstructable series
  // still holds the sync, and the button reads the same state
  // (isImageSliceSyncOn), so it can't show on after a click turned it off.
  if (isImageSliceSyncOn(syncGroupService, syncId)) {
    return disableSync(syncId, servicesManager);
  }

  // create synchronization group and add the viewports to it.
  viewports.forEach(gridViewport => {
    const { viewportId } = gridViewport.viewportOptions;
    const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
    if (!viewport) {
      return;
    }
    syncGroupService.addViewportToSyncGroup(viewportId, viewport.getRenderingEngine().id, {
      type: 'imageSlice',
      id: syncId,
      source: true,
      target: true,
    });
  });
}

/** True while the manual image slice sync links any viewport. */
export function isImageSliceSyncOn(syncGroupService, syncId = IMAGE_SLICE_SYNC_NAME): boolean {
  const synchronizer = syncGroupService.getSynchronizer(syncId);
  return (
    !!synchronizer &&
    !synchronizer.isDisabled() &&
    synchronizer.getSourceViewports().length + synchronizer.getTargetViewports().length > 0
  );
}

/** Remove every viewport the sync holds, whatever it shows now. */
function disableSync(syncName, servicesManager: AppTypes.ServicesManager) {
  const { syncGroupService } = servicesManager.services;
  const synchronizer = syncGroupService.getSynchronizer(syncName);
  if (!synchronizer) {
    return;
  }
  const held = [...synchronizer.getSourceViewports(), ...synchronizer.getTargetViewports()];
  new Map(held.map(vp => [`${vp.renderingEngineId}:${vp.viewportId}`, vp])).forEach(
    ({ viewportId, renderingEngineId }) =>
      syncGroupService.removeViewportFromSyncGroup(viewportId, renderingEngineId, syncName)
  );
}

/**
 * Gets the consistent spacing stack viewport types, which are the ones which
 * can be navigated using the stack image sync right now.
 */
function getReconstructableStackViewports(
  viewportGridService: ViewportGridService,
  displaySetService: DisplaySetService
) {
  let { viewports } = viewportGridService.getState();

  viewports = [...viewports.values()];
  // filter empty viewports
  viewports = viewports.filter(
    viewport => viewport.displaySetInstanceUIDs && viewport.displaySetInstanceUIDs.length
  );

  // filter reconstructable viewports
  viewports = viewports.filter(viewport => {
    const { displaySetInstanceUIDs } = viewport;

    for (const displaySetInstanceUID of displaySetInstanceUIDs) {
      const displaySet = displaySetService.getDisplaySetByUID(displaySetInstanceUID);

      // TODO - add a better test than isReconstructable
      if (displaySet && displaySet.isReconstructable) {
        return true;
      }

      return false;
    }
  });
  return viewports;
}
