import combineFrameInstance from './combineFrameInstance';

/**
 * Radimal regression test for the cross-frame leak the 3.10 fork patched:
 * per-frame values (ImagePositionPatient especially) must stay isolated per
 * frame. On the old implementation, per-frame data was written onto the
 * shared instance object, so reading frame A after frame B returned frame
 * B's position and cs3d spatial sync mis-positioned NM multiframes.
 * 3.13 rewrote the file around per-frame cached objects; if this suite is
 * green the fork's patch is confirmed obsolete.
 */
describe('combineFrameInstance cross-frame isolation (Radimal regression)', () => {
  const makeInstance = () => ({
    SOPInstanceUID: '1.2.3',
    NumberOfFrames: 3,
    Rows: 64,
    Columns: 64,
    SharedFunctionalGroupsSequence: [
      {
        PlaneOrientationSequence: [{ ImageOrientationPatient: [1, 0, 0, 0, 1, 0] }],
      },
    ],
    PerFrameFunctionalGroupsSequence: [
      { PlanePositionSequence: [{ ImagePositionPatient: [0, 0, 10] }] },
      { PlanePositionSequence: [{ ImagePositionPatient: [0, 0, 20] }] },
      { PlanePositionSequence: [{ ImagePositionPatient: [0, 0, 30] }] },
    ],
  });

  it('returns per-frame ImagePositionPatient without cross-frame leakage', () => {
    const instance = makeInstance();

    const frame1 = combineFrameInstance(1, instance);
    const frame3 = combineFrameInstance(3, instance);

    expect(frame1.ImagePositionPatient).toEqual([0, 0, 10]);
    expect(frame3.ImagePositionPatient).toEqual([0, 0, 30]);

    // The original bug: re-reading frame 1 after frame 3 returned frame 3's
    // position because per-frame data was written to a shared object.
    const frame1Again = combineFrameInstance(1, instance);
    expect(frame1Again.ImagePositionPatient).toEqual([0, 0, 10]);
    expect(frame3.ImagePositionPatient).toEqual([0, 0, 30]);
  });

  it('keeps concurrently-held frame objects independent', () => {
    const instance = makeInstance();
    const frames = [1, 2, 3].map(n => combineFrameInstance(n, instance));

    expect(frames.map(f => f.ImagePositionPatient)).toEqual([
      [0, 0, 10],
      [0, 0, 20],
      [0, 0, 30],
    ]);
    expect(frames.map(f => f.frameNumber)).toEqual([1, 2, 3]);
  });

  it('inherits shared functional groups on every frame', () => {
    const instance = makeInstance();

    const frame2 = combineFrameInstance(2, instance);
    expect(frame2.ImageOrientationPatient).toEqual([1, 0, 0, 0, 1, 0]);
  });

  it('synthesizes a per-frame position when none is provided', () => {
    const instance = makeInstance();
    delete instance.PerFrameFunctionalGroupsSequence;
    delete instance.SharedFunctionalGroupsSequence;

    const frame1 = combineFrameInstance(1, instance);
    const frame2 = combineFrameInstance(2, instance);
    expect(frame1.ImagePositionPatient).not.toEqual(frame2.ImagePositionPatient);
  });
});
