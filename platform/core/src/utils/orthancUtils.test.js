import {
  isValidOrthancStudyId,
  generateOrthancStudyUUID,
  resolveDownloadStudyId,
} from './orthancUtils';

// jsdom provides neither WebCrypto nor TextEncoder, and the real SHA-1 digest is the point of
// these tests — that hash is what makes an Orthanc study id self-certifying — so use Node's.
beforeAll(() => {
  if (typeof globalThis.TextEncoder === 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { TextEncoder } = require('util');
    globalThis.TextEncoder = TextEncoder;
  }
  if (!globalThis.crypto?.subtle) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { webcrypto } = require('crypto');
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  }
});

const PATIENT_ID = 'uey53zeb';
const STUDY_UID = '1.2.410.200067.100.1.202607281547410895.29800';
const OTHER_ID = 'aaaaaaaa-bbbbbbbb-cccccccc-dddddddd-eeeeeeee';

describe('reporterOriginFor', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { reporterOriginFor } = require('./orthancUtils');

  it('routes every staging viewer origin to the staging reporter', () => {
    // veg-view.stage-1 fell through the old exact-match ladders to PRODUCTION, so VEG staging
    // downloads asked the prod reporter about studies only staging knows — and always failed.
    expect(reporterOriginFor('https://veg-view.stage-1.radimal.ai')).toBe(
      'https://reporter-staging.onrender.com'
    );
    expect(reporterOriginFor('https://viewer.stage-1.radimal.ai')).toBe(
      'https://reporter-staging.onrender.com'
    );
    expect(reporterOriginFor('https://view.stage-1.radimal.ai')).toBe(
      'https://reporter-staging.onrender.com'
    );
  });

  it('routes production origins, VEG included, to the production reporter', () => {
    expect(reporterOriginFor('https://view.radimal.ai')).toBe(
      'https://radimal-reporter.onrender.com'
    );
    expect(reporterOriginFor('https://veg-view.radimal.ai')).toBe(
      'https://radimal-reporter.onrender.com'
    );
  });

  it('routes local development to the local reporter', () => {
    expect(reporterOriginFor('http://localhost:3000')).toBe('http://localhost:5007');
  });
});

describe('isValidOrthancStudyId', () => {
  it('accepts five dash-separated 8-char lowercase hex groups', () => {
    expect(isValidOrthancStudyId('c171e359-c01c9ba5-4d07ebf3-0b05d028-e82ca438')).toBe(true);
  });

  it('rejects the truncation that caused the production incident', () => {
    expect(isValidOrthancStudyId('c171e359')).toBe(false);
  });

  it('rejects near-misses', () => {
    expect(isValidOrthancStudyId('c171e359-c01c9ba5-4d07ebf3-0b05d028')).toBe(false); // 4 groups
    expect(isValidOrthancStudyId('C171E359-C01C9BA5-4D07EBF3-0B05D028-E82CA438')).toBe(false); // upper
    expect(isValidOrthancStudyId('c171e359-c01c9ba5-4d07ebf3-0b05d028-e82ca43g')).toBe(false); // non-hex
    expect(isValidOrthancStudyId(undefined)).toBe(false);
    expect(isValidOrthancStudyId('')).toBe(false);
  });
});

describe('resolveDownloadStudyId', () => {
  let derived;

  beforeAll(async () => {
    derived = await generateOrthancStudyUUID(PATIENT_ID, STUDY_UID);
  });

  it('derives an id that matches Orthanc’s own five-group format', () => {
    expect(isValidOrthancStudyId(derived)).toBe(true);
  });

  it('uses a well-formed studyId that agrees with the derived one', async () => {
    const result = await resolveDownloadStudyId({
      studyId: derived,
      patientId: PATIENT_ID,
      studyInstanceUID: STUDY_UID,
    });

    expect(result).toEqual({ studyId: derived });
  });

  it('uses a well-formed studyId when there is nothing to check it against', async () => {
    const result = await resolveDownloadStudyId({ studyId: OTHER_ID });

    expect(result).toEqual({ studyId: OTHER_ID });
  });

  it('refuses when a well-formed studyId contradicts the study on screen', async () => {
    const result = await resolveDownloadStudyId({
      studyId: OTHER_ID,
      patientId: PATIENT_ID,
      studyInstanceUID: STUDY_UID,
    });

    expect(result.studyId).toBeUndefined();
    expect(result.error).toMatch(/different study/i);
    expect(result.detail).toContain(OTHER_ID);
  });

  it('recovers from a truncated studyId when the URL still names the study', async () => {
    const result = await resolveDownloadStudyId({
      studyId: 'c171e359',
      patientId: PATIENT_ID,
      studyInstanceUID: STUDY_UID,
    });

    expect(result.studyId).toBe(derived);
    expect(result.recoveredFrom).toBe('c171e359');
  });

  it('refuses a truncated studyId with nothing to derive from — the incident URL', async () => {
    // The single cut at the first hyphen removed the studyId tail AND the trailing patientId.
    const result = await resolveDownloadStudyId({
      studyId: 'c171e359',
      studyInstanceUID: STUDY_UID,
    });

    expect(result.studyId).toBeUndefined();
    expect(result.error).toMatch(/incomplete/i);
  });

  it('derives when no studyId is supplied at all', async () => {
    const result = await resolveDownloadStudyId({
      patientId: PATIENT_ID,
      studyInstanceUID: STUDY_UID,
    });

    expect(result).toEqual({ studyId: derived });
  });

  it('returns nothing to act on when the URL carries no identity', async () => {
    expect(await resolveDownloadStudyId({})).toEqual({});
  });

  it('does not block a download when the digest is unavailable', async () => {
    const realCrypto = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true });

    const result = await resolveDownloadStudyId({
      studyId: OTHER_ID,
      patientId: PATIENT_ID,
      studyInstanceUID: STUDY_UID,
    });

    Object.defineProperty(globalThis, 'crypto', { value: realCrypto, configurable: true });
    // Cannot verify, so the supplied id stands rather than the download failing outright.
    expect(result).toEqual({ studyId: OTHER_ID });
  });
});
