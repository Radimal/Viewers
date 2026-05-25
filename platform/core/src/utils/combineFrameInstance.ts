import { vec3 } from 'gl-matrix';

/**
 * Combine the Per instance frame data, the shared frame data
 * and the root data objects.
 * The data is combined by taking nested sequence objects within
 * the functional group sequences.  Data that is directly contained
 * within the functional group sequences, such as private creators
 * will be ignored.
 * This can be safely called with an undefined frame in order to handle
 * single frame data. (eg frame is undefined is the same as frame===1).
 *
 * Implementation note: this function MUST NOT mutate the shared
 * DicomMetadataStore `instance` it receives. Mutating the shared object causes
 * per-frame metadata (ImagePositionPatient, etc.) to leak across consecutive
 * calls for the same SOPInstance — every call would observe the previously-
 * queried frame's data on the shared instance, producing off-by-one IPPs in
 * cs3d's spatial-sync close-match iteration. OHIF master fixed this in
 * PR #5264 / #4792 / #5811; this is a minimal port of that fix.
 */
const combineFrameInstance = (frame, instance) => {
  const {
    PerFrameFunctionalGroupsSequence,
    SharedFunctionalGroupsSequence,
    NumberOfFrames,
    SpacingBetweenSlices,
  } = instance;

  if (PerFrameFunctionalGroupsSequence || NumberOfFrames > 1) {
    const frameNumber = Number.parseInt(frame || 1);
    const shared = SharedFunctionalGroupsSequence
      ? Object.values(SharedFunctionalGroupsSequence[0])
          .filter(Boolean)
          .map(it => it[0])
          .filter(it => typeof it === 'object')
      : [];

    const perFrame = PerFrameFunctionalGroupsSequence
      ? Object.values(PerFrameFunctionalGroupsSequence[frameNumber - 1])
          .filter(Boolean)
          .map(it => it[0])
          .filter(it => typeof it === 'object')
      : [];

    // NM-multiframe fallback for orientation: derive from DetectorInformationSequence
    // when the instance doesn't carry a top-level ImageOrientationPatient. Compute
    // into a local — the previous version mutated `instance.ImageOrientationPatient`,
    // which leaks across calls for the same SOPInstance.
    let imageOrientationPatientForFrame = instance.ImageOrientationPatient;
    if (!imageOrientationPatientForFrame && instance.DetectorInformationSequence) {
      imageOrientationPatientForFrame =
        instance.DetectorInformationSequence[0].ImageOrientationPatient;
    }

    // NM-multiframe fallback for position: compute via DetectorInformationSequence
    // + SpacingBetweenSlices when the instance has no top-level ImagePositionPatient.
    let ImagePositionPatientFromDetectorInfo: number[] | undefined;
    if (!instance.ImagePositionPatient && instance.DetectorInformationSequence) {
      const detectorIPP = instance.DetectorInformationSequence[0].ImagePositionPatient;

      if (imageOrientationPatientForFrame && SpacingBetweenSlices) {
        const rowOrientation = vec3.fromValues(
          imageOrientationPatientForFrame[0],
          imageOrientationPatientForFrame[1],
          imageOrientationPatientForFrame[2]
        );

        const colOrientation = vec3.fromValues(
          imageOrientationPatientForFrame[3],
          imageOrientationPatientForFrame[4],
          imageOrientationPatientForFrame[5]
        );

        const normalVector = vec3.cross(vec3.create(), rowOrientation, colOrientation);

        const position = vec3.scaleAndAdd(
          vec3.create(),
          detectorIPP,
          normalVector,
          SpacingBetweenSlices * (frameNumber - 1)
        );

        ImagePositionPatientFromDetectorInfo = [position[0], position[1], position[2]];
      }
    }

    // Build a shallow copy and layer per-frame data on top. Per-frame mutations
    // land on `newInstance` (the copy) — the shared store object is untouched.
    const newInstance: any = { ...instance, frameNumber };
    if (imageOrientationPatientForFrame && !newInstance.ImageOrientationPatient) {
      newInstance.ImageOrientationPatient = imageOrientationPatientForFrame;
    }

    [...shared, ...perFrame].forEach(item => {
      Object.entries(item).forEach(([key, value]) => {
        newInstance[key] = value;
      });
    });

    // Priority: the per-frame ImagePositionPatient from the
    // PerFrameFunctionalGroupsSequence (now sitting on `newInstance` after the
    // loop above) wins. For NM datasets that have no per-frame IPP, fall back
    // to the value computed from DetectorInformationSequence. Default last.
    return {
      ...newInstance,
      ImagePositionPatient:
        newInstance.ImagePositionPatient ??
        ImagePositionPatientFromDetectorInfo ?? [0, 0, frameNumber],
    };
  } else {
    return instance;
  }
};

export default combineFrameInstance;
