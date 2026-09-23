import { utilities } from '@cornerstonejs/tools';

const { getCalibratedLengthUnitsAndScale } = utilities;

// Regression for the calibration bug caught on the canary (2026-09-23):
// upstream getCalibratedUnits clobbered the X-axis scale with the RAW user
// calibration ratio (dropping the pixel-spacing division) while scaleY kept
// it — user-calibrated lengths on images WITH pixel spacing came out wrong by
// an angle-dependent factor (observed: scale 12.172 vs scaleY 86.94 on a
// 0.14mm DR). Fixed by patches/@cornerstonejs__tools@*.patch, which removes
// the clobber. These inputs are the exact runtime dump from the incident.
describe('getCalibratedLengthUnitsAndScale user calibration (vendor patch)', () => {
  const image = {
    calibration: { type: 'User', scale: 12.172 },
    hasPixelSpacing: true,
    spacing: [0.14, 0.14, 0.001],
  };

  it('divides pixel spacing into BOTH axes', () => {
    const { scale, scaleY, unit } = getCalibratedLengthUnitsAndScale(image, []);
    expect(scale).toBeCloseTo(12.172 / 0.14, 6);
    expect(scaleY).toBeCloseTo(12.172 / 0.14, 6);
    expect(scale).toBeCloseTo(scaleY, 6);
    expect(unit).toBe('mm User');
  });

  it('reproduces the incident geometry correctly once isotropic', () => {
    // The 63.97mm line: 456.9px at 0.14mm spacing, calibrated 60.86mm -> 5mm.
    const { scale } = getCalibratedLengthUnitsAndScale(image, []);
    const lengthMM = 456.9 / scale;
    expect(lengthMM).toBeCloseTo(5.26, 2);
  });

  it('leaves uncalibrated images alone', () => {
    const { scale, scaleY } = getCalibratedLengthUnitsAndScale(
      { calibration: null, hasPixelSpacing: true, spacing: [0.14, 0.14, 0.001] },
      []
    );
    expect(scale).toBeCloseTo(1 / 0.14, 6);
    expect(scaleY).toBeCloseTo(1 / 0.14, 6);
  });
});
