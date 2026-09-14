import {
  isValidOrthancStudyId,
  generateOrthancStudyUUID,
  resolveDownloadStudyId,
  renderedThumbnailUrlFor,
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

describe('renderedThumbnailUrlFor', () => {
  const FRAME_ID =
    'wadors:https://cdn.example.com/dicom-web/studies/1.2.3/series/4.5.6/instances/7.8.9/frames/1';

  it('appends /rendered to the frame request', () => {
    expect(renderedThumbnailUrlFor(FRAME_ID)).toBe(
      'https://cdn.example.com/dicom-web/studies/1.2.3/series/4.5.6/instances/7.8.9/frames/1/rendered?viewport=256,256'
    );
  });

  it('honours a caller-supplied size', () => {
    expect(renderedThumbnailUrlFor(FRAME_ID, 128)).toContain('viewport=128,128');
  });

  // The study browser picks the MIDDLE frame of a multiframe instance, so the frame number has to
  // survive. Collapsing to the instance-level resource renders frame 1 of every cine loop.
  it('preserves the requested frame number', () => {
    const middleFrame = FRAME_ID.replace('/frames/1', '/frames/42');

    expect(renderedThumbnailUrlFor(middleFrame)).toBe(
      'https://cdn.example.com/dicom-web/studies/1.2.3/series/4.5.6/instances/7.8.9/frames/42/rendered?viewport=256,256'
    );
  });

  it('gives a different URL per frame of the same instance', () => {
    // Distinctness is the property that breaks if the frame segment is ever stripped again: every
    // frame of a cine loop would collapse onto one instance-level URL.
    const frame42 = renderedThumbnailUrlFor(FRAME_ID.replace('/frames/1', '/frames/42'));

    expect(frame42).not.toBe(renderedThumbnailUrlFor(FRAME_ID));
    expect(frame42).toContain('/frames/42/rendered');
  });

  // Fail closed: every one of these must keep the caller on the existing full-frame path rather
  // than inventing a URL the origin will 404.
  it.each([
    ['a wadouri imageId', 'dicomweb:https://cdn.example.com/wado?requestType=WADO&objectUID=7.8.9'],
    ['an instance-level wadors imageId', 'wadors:https://cdn.example.com/dicom-web/instances/7.8.9'],
    ['a frame segment that is not numeric', `${FRAME_ID.replace('/frames/1', '/frames/first')}`],
    ['a trailing slash after the frame number', `${FRAME_ID}/`],
    // Isolates the scheme check specifically: this one DOES end in /frames/<n>, so only the
    // `wadors:` guard can reject it. Without that guard the 7-character slice chops a 9-character
    // `dicomweb:` prefix and emits a corrupt URL instead of failing closed.
    [
      'a non-wadors scheme that still ends in a frame segment',
      'dicomweb:https://cdn.example.com/dicom-web/studies/1.2.3/series/4.5.6/instances/7.8.9/frames/1',
    ],
    ['an empty string', ''],
    ['a non-string', undefined],
  ])('returns null for %s', (_label, input) => {
    expect(renderedThumbnailUrlFor(input)).toBeNull();
  });
});
