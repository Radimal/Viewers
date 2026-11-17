import toggleImageSliceSync, { isImageSliceSyncOn } from './toggleImageSliceSync';

// A sync group holding vp0 (reconstructable) and vp1, which now shows a
// non-reconstructable series (e.g. the scout).
function setup() {
  let held = [
    { viewportId: 'vp0', renderingEngineId: 're' },
    { viewportId: 'vp1', renderingEngineId: 're' },
  ];
  let synchronizer = {
    id: 'IMAGE_SLICE_SYNC',
    isDisabled: () => false,
    getSourceViewports: () => held,
    getTargetViewports: () => held,
  };
  const syncGroupService = {
    getSynchronizer: id => (id === 'IMAGE_SLICE_SYNC' ? synchronizer : undefined),
    getSynchronizersForViewport: id =>
      synchronizer && held.some(v => v.viewportId === id) ? [synchronizer] : [],
    removeViewportFromSyncGroup: viewportId => {
      held = held.filter(v => v.viewportId !== viewportId);
      if (!held.length) {
        synchronizer = undefined; // the service destroys an empty group
      }
    },
    addViewportToSyncGroup: jest.fn(),
  };
  const displaySets = { a: { isReconstructable: true }, scout: { isReconstructable: false } };
  const servicesManager = {
    services: {
      syncGroupService,
      viewportGridService: {
        getState: () => ({
          viewports: new Map([
            ['vp0', { displaySetInstanceUIDs: ['a'], viewportOptions: { viewportId: 'vp0' } }],
            ['vp1', { displaySetInstanceUIDs: ['scout'], viewportOptions: { viewportId: 'vp1' } }],
          ]),
        }),
      },
      displaySetService: { getDisplaySetByUID: uid => displaySets[uid] },
      cornerstoneViewportService: {
        getCornerstoneViewport: () => ({ getRenderingEngine: () => ({ id: 're' }) }),
      },
    },
  };
  return { servicesManager, syncGroupService };
}

describe('toggleImageSliceSync', () => {
  it('turning off removes the sync from every viewport, including non-reconstructable ones', () => {
    const { servicesManager, syncGroupService } = setup();
    expect(isImageSliceSyncOn(syncGroupService)).toBe(true);

    toggleImageSliceSync({ servicesManager } as never);

    expect(isImageSliceSyncOn(syncGroupService)).toBe(false);
    expect(syncGroupService.getSynchronizersForViewport('vp1')).toEqual([]);
    expect(syncGroupService.addViewportToSyncGroup).not.toHaveBeenCalled();
  });
});
