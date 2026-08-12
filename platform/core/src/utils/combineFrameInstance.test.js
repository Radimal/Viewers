import combineFrameInstance from './combineFrameInstance';

// Builds a synthetic multi-frame DICOM instance with `numFrames` frames where
// frame N has imagePositionPatient = [0, 0, N] (1-indexed) — easy to assert
// against. SharedFunctionalGroupsSequence and PerFrameFunctionalGroupsSequence
// match the shape combineFrameInstance reads.
function makeMultiFrameInstance(numFrames, overrides = {}) {
  return {
    SOPInstanceUID: 'test.sop',
    NumberOfFrames: numFrames,
    ImageOrientationPatient: [1, 0, 0, 0, 1, 0],
    SharedFunctionalGroupsSequence: [
      {
        PlaneOrientationSequence: [{ ImageOrientationPatient: [1, 0, 0, 0, 1, 0] }],
      },
    ],
    PerFrameFunctionalGroupsSequence: Array.from({ length: numFrames }, (_, i) => ({
      PlanePositionSequence: [{ ImagePositionPatient: [0, 0, i + 1] }],
    })),
    ...overrides,
  };
}

describe('combineFrameInstance', () => {
  describe('multi-frame DICOM', () => {
    test('returns the per-frame ImagePositionPatient for the requested frame', () => {
      const instance = makeMultiFrameInstance(5);
      const result = combineFrameInstance(3, instance);
      expect(result.ImagePositionPatient).toEqual([0, 0, 3]);
    });

    // The original bug: calling for frame 2 right after frame 1 returned
    // frame 1's IPP because the shared instance had been mutated. Regression
    // test that locks this in.
    test('returns the CURRENT frame IPP even after a prior call for a different frame', () => {
      const instance = makeMultiFrameInstance(19);
      combineFrameInstance(1, instance);
      const result = combineFrameInstance(2, instance);
      expect(result.ImagePositionPatient).toEqual([0, 0, 2]);
    });

    // Iteration sequence used by cs3d's _getClosestImageIdIndex: scan every
    // frame in order. Each one must return its own per-frame IPP.
    test('returns correct per-frame IPPs across a full forward iteration', () => {
      const instance = makeMultiFrameInstance(19);
      for (let i = 1; i <= 19; i++) {
        const result = combineFrameInstance(i, instance);
        expect(result.ImagePositionPatient).toEqual([0, 0, i]);
      }
    });

    // Order independence: same expectation when iterating in reverse.
    test('returns correct per-frame IPPs across a reverse iteration', () => {
      const instance = makeMultiFrameInstance(19);
      for (let i = 19; i >= 1; i--) {
        const result = combineFrameInstance(i, instance);
        expect(result.ImagePositionPatient).toEqual([0, 0, i]);
      }
    });

    test('does not mutate ImagePositionPatient on the shared store instance', () => {
      const instance = makeMultiFrameInstance(5);
      // No root-level ImagePositionPatient on the original.
      expect(instance.ImagePositionPatient).toBeUndefined();

      combineFrameInstance(1, instance);
      combineFrameInstance(3, instance);
      combineFrameInstance(5, instance);

      // After several queries, the shared instance must still have its root
      // ImagePositionPatient untouched. The previous implementation would
      // leave it set to frame 5's IPP, which leaked across other callers.
      expect(instance.ImagePositionPatient).toBeUndefined();
    });

    test('does not mutate ImageOrientationPatient on the shared store instance', () => {
      const instance = makeMultiFrameInstance(3);
      const originalIOP = instance.ImageOrientationPatient;
      combineFrameInstance(2, instance);
      // Same reference, same value — no replacement, no mutation.
      expect(instance.ImageOrientationPatient).toBe(originalIOP);
    });

    test('synthesizes a default IPP when no per-frame data is present', () => {
      const instance = {
        NumberOfFrames: 3,
        // No PerFrame / Shared / DetectorInformation — completely empty.
      };
      const result = combineFrameInstance(2, instance);
      // Falls through to the [0, 0, frameNumber] synthetic default.
      expect(result.ImagePositionPatient).toEqual([0, 0, 2]);
    });
  });

  describe('memoization', () => {
    // MetadataProvider calls combineFrameInstance for every metaData.get() —
    // ~10 module queries per frame while a loop buffers. The combined result
    // must be built once per (instance, frame), not per query.
    test('returns the same object for repeated calls with the same instance and frame', () => {
      const instance = makeMultiFrameInstance(5);
      const first = combineFrameInstance(3, instance);
      const second = combineFrameInstance(3, instance);
      expect(second).toBe(first);
    });

    test('caches per frame — different frames get distinct, correct objects', () => {
      const instance = makeMultiFrameInstance(5);
      const frame2 = combineFrameInstance(2, instance);
      const frame4 = combineFrameInstance(4, instance);
      expect(frame4).not.toBe(frame2);
      expect(frame2.ImagePositionPatient).toEqual([0, 0, 2]);
      expect(frame4.ImagePositionPatient).toEqual([0, 0, 4]);
      // Cache hits still return the right frame's data.
      expect(combineFrameInstance(2, instance)).toBe(frame2);
      expect(combineFrameInstance(4, instance)).toBe(frame4);
    });

    test('caches per instance identity — a re-naturalized instance gets a fresh combine', () => {
      const instanceA = makeMultiFrameInstance(5);
      const instanceB = makeMultiFrameInstance(5);
      const fromA = combineFrameInstance(3, instanceA);
      const fromB = combineFrameInstance(3, instanceB);
      expect(fromB).not.toBe(fromA);
      expect(fromB.ImagePositionPatient).toEqual(fromA.ImagePositionPatient);
    });

    test('does not write any cache properties onto the shared store instance', () => {
      const instance = makeMultiFrameInstance(5);
      const keysBefore = [
        ...Object.getOwnPropertyNames(instance),
        ...Object.getOwnPropertySymbols(instance),
      ];
      combineFrameInstance(1, instance);
      combineFrameInstance(2, instance);
      const keysAfter = [
        ...Object.getOwnPropertyNames(instance),
        ...Object.getOwnPropertySymbols(instance),
      ];
      expect(keysAfter).toEqual(keysBefore);
    });
  });

  describe('NM DetectorInformationSequence fallback', () => {
    // NM (Nuclear Medicine) multi-frame DICOMs often carry only a single
    // top-level ImagePositionPatient in DetectorInformationSequence and rely
    // on SpacingBetweenSlices to derive per-frame positions. Our fix preserves
    // that fallback computed locally (without mutating the shared instance).
    test('computes per-frame IPP from DetectorInformationSequence + SpacingBetweenSlices', () => {
      const instance = {
        NumberOfFrames: 5,
        SpacingBetweenSlices: 2,
        DetectorInformationSequence: [
          {
            ImagePositionPatient: [0, 0, 0],
            ImageOrientationPatient: [1, 0, 0, 0, 1, 0],
          },
        ],
        // No PerFrame data with explicit per-frame IPP — the fallback must
        // kick in for frame 3.
        PerFrameFunctionalGroupsSequence: [{}, {}, {}, {}, {}],
      };

      const result = combineFrameInstance(3, instance);
      // Normal vector to [1,0,0] x [0,1,0] = [0,0,1]; scaled by spacing 2 *
      // (frame - 1) = 4 → IPP at [0, 0, 4].
      expect(result.ImagePositionPatient).toEqual([0, 0, 4]);
    });

    test('does not mutate ImageOrientationPatient when filling it from DetectorInfo', () => {
      const instance = {
        NumberOfFrames: 3,
        SpacingBetweenSlices: 1,
        DetectorInformationSequence: [
          {
            ImagePositionPatient: [0, 0, 0],
            ImageOrientationPatient: [1, 0, 0, 0, 1, 0],
          },
        ],
        PerFrameFunctionalGroupsSequence: [{}, {}, {}],
      };
      combineFrameInstance(2, instance);
      // Root instance still has no top-level ImageOrientationPatient — the
      // previous implementation wrote it onto the shared store object.
      expect(instance.ImageOrientationPatient).toBeUndefined();
    });
  });

  describe('single-frame DICOM', () => {
    test('returns the instance unchanged when NumberOfFrames is missing / 1', () => {
      const instance = {
        SOPInstanceUID: 'single.frame',
        ImagePositionPatient: [10, 20, 30],
      };
      const result = combineFrameInstance(1, instance);
      // No PerFrame, no NumberOfFrames > 1 → early return of the instance ref.
      expect(result).toBe(instance);
    });
  });
});
