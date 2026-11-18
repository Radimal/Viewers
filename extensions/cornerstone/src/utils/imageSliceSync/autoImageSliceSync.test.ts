jest.mock('@cornerstonejs/core', () => ({ eventTarget: {}, Enums: { Events: {} } }));

import { findUnlinkedSyncablePair, forceEnableImageSliceSync } from './autoImageSliceSync';

const AXIAL = [1, 0, 0, 0, 1, 0];
const CORONAL = [1, 0, 0, 0, 0, -1];

// A series of `count` slices from z0 at `spacing` mm along the axial normal.
const series = (uid, desc, count, z0, spacing, extra = {}) => ({
  displaySetInstanceUID: uid,
  isReconstructable: true,
  instances: Array.from({ length: count }, (_, i) => ({
    StudyInstanceUID: 'study',
    SeriesInstanceUID: uid,
    FrameOfReferenceUID: 'for',
    ImageOrientationPatient: AXIAL,
    ImagePositionPatient: [0, 0, z0 + i * spacing],
    SeriesDescription: desc,
    ...extra,
  })),
});

const run = (displaySets, syncs = {}, viewportTypes = []) =>
  findUnlinkedSyncablePair({
    servicesManager: {
      services: {
        viewportGridService: {
          getState: () => ({
            viewports: new Map(
              displaySets.map((ds, i) => [
                `vp${i}`,
                {
                  displaySetInstanceUIDs: [ds.displaySetInstanceUID],
                  viewportOptions: { viewportId: `vp${i}`, viewportType: viewportTypes[i] },
                },
              ])
            ),
          }),
        },
        displaySetService: {
          // Like the real service: throws on a non-string UID.
          getDisplaySetByUID: uid => {
            if (typeof uid !== 'string') {
              throw new Error('displaySetInstanceUid must be a string');
            }
            return displaySets.find(ds => ds.displaySetInstanceUID === uid);
          },
        },
        syncGroupService: {
          getSynchronizersForViewport: id =>
            (syncs[id] || []).map(syncId => ({ id: syncId, isDisabled: () => false })),
        },
      },
    },
  } as never);

describe('findUnlinkedSyncablePair', () => {
  const thin = series('thin', 'THINS', 400, 0, 0.625);
  const thick = series('thick', 'STD', 100, 0, 2.5);
  const reason = (...args: Parameters<typeof run>) => run(...args)?.reason ?? null;

  it('flags thin and thick slices of the same scan', () => {
    expect(run([thin, thick])).toEqual({ descriptions: ['THINS', 'STD'], reason: 'syncable' });
  });

  it('says nothing about a pair that is already synced', () => {
    expect(reason([thin, thick], { vp0: ['IMAGE_SLICE_SYNC'], vp1: ['IMAGE_SLICE_SYNC'] })).toBe(
      null
    );
  });

  it('explains why a pair would not line up', () => {
    expect(reason([thin, series('thorax', 'THORAX', 100, 200, 2.5)])).toBe('differentAnatomy');
    expect(reason([thin, series('b', 'B', 100, 0, 2.5, { FrameOfReferenceUID: 'other' })])).toBe(
      'differentScan'
    );
    expect(
      reason([thin, series('c', 'C', 100, 0, 2.5, { ImageOrientationPatient: CORONAL })])
    ).toBe('differentPlane');
  });

  it('prefers a syncable pair over a mismatched one', () => {
    expect(reason([series('thorax', 'THORAX', 100, 200, 2.5), thin, thick])).toBe('syncable');
  });

  it('ignores the same series twice and other studies', () => {
    expect(reason([thin, thin])).toBe(null);
    expect(reason([thin, series('prior', 'PRIOR', 100, 0, 2.5, { StudyInstanceUID: 'p' })])).toBe(
      null
    );
  });

  it('treats a reversed series in the same plane as the same plane', () => {
    const reversed = series('rev', 'REV', 100, 0, 2.5, {
      ImageOrientationPatient: [-1, 0, 0, 0, 1, 0],
    });
    expect(reason([thin, reversed])).toBe('syncable');
  });

  it('says nothing when a frame of reference is missing', () => {
    const noFor = s => ({
      ...s,
      instances: s.instances.map(i => ({ ...i, FrameOfReferenceUID: undefined })),
    });
    expect(reason([noFor(thin), noFor(thick)])).toBe(null);
  });

  it('skips empty viewports instead of throwing', () => {
    expect(reason([thin, {}, thick])).toBe('syncable');
  });

  it('ignores MPR and 3D viewports', () => {
    expect(reason([thin, thick], {}, ['stack', 'volume'])).toBe(null);
  });
});

describe('forceEnableImageSliceSync', () => {
  it('regroups auto sync but keeps the manual IMAGE_SLICE_SYNC group', () => {
    const removed = [];
    const displaySets = [
      { displaySetInstanceUID: 'a', isReconstructable: true, instances: [{}] },
      { displaySetInstanceUID: 'b', isReconstructable: true, instances: [{}] },
    ];
    forceEnableImageSliceSync({
      servicesManager: {
        services: {
          viewportGridService: {
            getState: () => ({
              viewports: new Map(
                displaySets.map((ds, i) => [
                  `vp${i}`,
                  {
                    displaySetInstanceUIDs: [ds.displaySetInstanceUID],
                    viewportOptions: { viewportId: `vp${i}` },
                  },
                ])
              ),
            }),
          },
          displaySetService: {
            getDisplaySetByUID: uid => displaySets.find(ds => ds.displaySetInstanceUID === uid),
          },
          cornerstoneViewportService: {
            getCornerstoneViewport: () => ({ getRenderingEngine: () => ({ id: 're' }) }),
          },
          syncGroupService: {
            getSynchronizersForViewport: () => [
              { id: 'IMAGE_SLICE_SYNC' },
              { id: 'IMAGE_SLICE_SYNC_GROUP_0' },
            ],
            removeViewportFromSyncGroup: (viewportId, engineId, syncId) => removed.push(syncId),
            addViewportToSyncGroup: () => {},
          },
        },
      },
    });
    expect(removed).toContain('IMAGE_SLICE_SYNC_GROUP_0');
    expect(removed).not.toContain('IMAGE_SLICE_SYNC');
  });
});
