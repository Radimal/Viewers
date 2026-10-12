import { loadRotationFlip, saveRotationFlip } from './rotationFlipStorage';

const ds = [{ StudyInstanceUID: '1.2', SeriesInstanceUID: '3.4' }];
const legacy = (instance, rotationFlip, timestamp) =>
  localStorage.setItem(
    `ohif_viewport_state_1.2-3.4-${instance}`,
    JSON.stringify({ rotationFlip, timestamp })
  );

beforeEach(() => localStorage.clear());

it('falls back to the newest 3.10 per-instance entry for the series', () => {
  legacy('5.6', { rotation: 90 }, 1);
  legacy('5.7', { rotation: 180, flipHorizontal: true }, 2);
  localStorage.setItem(
    'ohif_viewport_state_1.2-3.40-5.8',
    JSON.stringify({ rotationFlip: { rotation: 270 }, timestamp: 3 })
  ); // different series sharing a prefix

  expect(loadRotationFlip(ds)).toEqual({ rotation: 180, flipHorizontal: true });
});

it('prefers the 3.13 series entry over 3.10 ones', () => {
  legacy('5.6', { rotation: 90 }, 1);
  saveRotationFlip(ds, { rotation: 270 });

  expect(loadRotationFlip(ds)).toEqual({ rotation: 270 });
});

it('a reset after the fallback does not bring the 3.10 rotation back', () => {
  legacy('5.6', { rotation: 90 }, 1);
  expect(loadRotationFlip(ds)).toEqual({ rotation: 90 });

  saveRotationFlip(ds, { rotation: 0, flipHorizontal: false, flipVertical: false });

  expect(loadRotationFlip(ds)).toBeNull();
});
