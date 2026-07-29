import { selectStudyInfo } from './useStudyInfo';

const CURRENT = '1.2.410.200067.100.1.202607281547410895.29800';
const PRIOR = '1.2.410.200067.100.1.202501011200000000.11111';

const displaySet = (studyInstanceUID, patientID) => ({
  StudyInstanceUID: studyInstanceUID,
  instances: [{ StudyInstanceUID: studyInstanceUID, PatientID: patientID }],
});

describe('selectStudyInfo', () => {
  it('picks the requested study even when a prior study is first in the array', () => {
    // A prior study expanded in the left panel, or a re-sort, puts another study at index 0.
    const displaySets = [
      displaySet(PRIOR, 'prior-patient'),
      displaySet(CURRENT, 'current-patient'),
    ];

    expect(selectStudyInfo(displaySets, CURRENT)).toEqual({
      StudyInstanceUID: CURRENT,
      PatientID: 'current-patient',
    });
  });

  it('is unaffected by the order of the display sets', () => {
    const a = displaySet(PRIOR, 'prior-patient');
    const b = displaySet(CURRENT, 'current-patient');

    expect(selectStudyInfo([a, b], CURRENT)).toEqual(selectStudyInfo([b, a], CURRENT));
  });

  it('reports the requested UID with no PatientID before its metadata arrives', () => {
    // The duplicate-StudyInstanceUID case: WADO 404s so nothing loads. Cache invalidation still
    // gets the right UID, and no caller can derive an Orthanc id from another study's patient.
    expect(selectStudyInfo([displaySet(PRIOR, 'prior-patient')], CURRENT)).toEqual({
      StudyInstanceUID: CURRENT,
      PatientID: '',
    });
  });

  it('never borrows a PatientID from a study other than the requested one', () => {
    const { PatientID } = selectStudyInfo([displaySet(PRIOR, 'prior-patient')], CURRENT);

    expect(PatientID).toBe('');
  });

  it('falls back to the first display set when no study was requested', () => {
    expect(selectStudyInfo([displaySet(CURRENT, 'current-patient')], '')).toEqual({
      StudyInstanceUID: CURRENT,
      PatientID: 'current-patient',
    });
  });

  it('reads identity off the display set when it carries no instances', () => {
    const bare = { StudyInstanceUID: CURRENT, PatientID: 'current-patient' };

    expect(selectStudyInfo([bare], CURRENT)).toEqual({
      StudyInstanceUID: CURRENT,
      PatientID: 'current-patient',
    });
  });

  it('handles an empty or missing display-set list', () => {
    expect(selectStudyInfo([], CURRENT)).toEqual({ StudyInstanceUID: CURRENT, PatientID: '' });
    expect(selectStudyInfo(undefined, CURRENT)).toEqual({
      StudyInstanceUID: CURRENT,
      PatientID: '',
    });
    expect(selectStudyInfo([], '')).toEqual({ StudyInstanceUID: '', PatientID: '' });
  });
});
