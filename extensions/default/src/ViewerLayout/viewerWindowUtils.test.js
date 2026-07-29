import {
  DOCUMENT_STARTED_AT,
  VIEWER_WINDOW_NAME,
  WINDOW_STARTED_AT,
  closeAllViewerWindows,
  openSavedViewerWindows,
  publishFamilyDeparture,
  publishFamilyStudy,
  readFamilyWindowData,
  readFamilyDepartureSinceLoad,
  readFamilyStudyPublishedSinceLoad,
  stripCaseScopedParams,
} from './viewerWindowUtils';

const primaryEntry = {
  id: VIEWER_WINDOW_NAME,
  x: 0,
  y: 0,
  width: 1920,
  height: 1080,
  closed: false,
};

const secondaryEntry = {
  id: 'viewerWindow-1700000000000',
  x: 1920,
  y: 0,
  width: 1920,
  height: 1080,
  closed: false,
};

describe('viewerWindowUtils', () => {
  let openSpy;
  let closeSpy;

  beforeEach(() => {
    localStorage.clear();
    window.name = VIEWER_WINDOW_NAME;
    global.BroadcastChannel = jest.fn().mockImplementation(() => ({
      postMessage: jest.fn(),
      close: jest.fn(),
    }));
    openSpy = jest.spyOn(window, 'open').mockReturnValue({ close: jest.fn() });
    closeSpy = jest.spyOn(window, 'close').mockImplementation(() => {});
  });

  afterEach(() => {
    openSpy.mockRestore();
    closeSpy.mockRestore();
    jest.useRealTimers();
  });

  describe('closeAllViewerWindows', () => {
    it('saves primary and secondary windows to windowsArray when both are open', () => {
      localStorage.setItem('windowData', JSON.stringify([primaryEntry, secondaryEntry]));

      closeAllViewerWindows();

      const saved = JSON.parse(localStorage.getItem('windowsArray'));
      expect(saved.map(win => win.id)).toEqual([primaryEntry.id, secondaryEntry.id]);
    });

    it('does not overwrite a saved layout when only the primary is open', () => {
      const savedLayout = [primaryEntry, secondaryEntry];
      localStorage.setItem('windowsArray', JSON.stringify(savedLayout));
      localStorage.setItem('windowData', JSON.stringify([primaryEntry]));

      closeAllViewerWindows();

      expect(JSON.parse(localStorage.getItem('windowsArray'))).toEqual(savedLayout);
    });

    it('skips already-closed windows when saving the layout', () => {
      localStorage.setItem(
        'windowData',
        JSON.stringify([primaryEntry, { ...secondaryEntry, closed: true }])
      );
      localStorage.setItem('windowsArray', JSON.stringify([primaryEntry, secondaryEntry]));

      closeAllViewerWindows();

      // The only open window was the primary, so the saved two-window layout survives.
      const saved = JSON.parse(localStorage.getItem('windowsArray'));
      expect(saved.map(win => win.id)).toEqual([primaryEntry.id, secondaryEntry.id]);
    });

    it('marks every open window closed in windowData and closes self', () => {
      localStorage.setItem('windowData', JSON.stringify([primaryEntry, secondaryEntry]));

      closeAllViewerWindows();

      expect(readFamilyWindowData().every(win => win.closed)).toBe(true);
      expect(closeSpy).toHaveBeenCalled();
    });
  });

  describe('openSavedViewerWindows', () => {
    it('reopens saved secondary windows at their saved geometry and skips the primary', () => {
      jest.useFakeTimers();
      localStorage.setItem('windowsArray', JSON.stringify([primaryEntry, secondaryEntry]));

      openSavedViewerWindows();
      jest.runAllTimers();

      expect(openSpy).toHaveBeenCalledTimes(1);
      // Restored by canonical position rather than the saved id: per-origin ids never match a
      // monitor that followed a cross-origin case switch (816eddd5).
      expect(openSpy).toHaveBeenCalledWith(
        window.location.href,
        `${VIEWER_WINDOW_NAME}-1`,
        `width=${secondaryEntry.width},height=${secondaryEntry.height},left=${secondaryEntry.x},top=${secondaryEntry.y}`
      );
    });

    it('ignores non-family entries and malformed storage', () => {
      jest.useFakeTimers();
      localStorage.setItem(
        'windowsArray',
        JSON.stringify([{ id: '' }, { id: 'unrelated' }, null, secondaryEntry])
      );

      openSavedViewerWindows();
      jest.runAllTimers();

      expect(openSpy).toHaveBeenCalledTimes(1);

      openSpy.mockClear();
      localStorage.setItem('windowsArray', 'not-json');
      openSavedViewerWindows();
      jest.runAllTimers();
      expect(openSpy).not.toHaveBeenCalled();
    });

    it('reports blocked windows through onBlocked when window.open returns null', () => {
      jest.useFakeTimers();
      openSpy.mockReturnValue(null);
      localStorage.setItem(
        'windowsArray',
        JSON.stringify([secondaryEntry, { ...secondaryEntry, id: 'viewerWindow-1700000000001' }])
      );
      const onBlocked = jest.fn();

      openSavedViewerWindows(onBlocked);
      jest.runAllTimers();

      expect(onBlocked).toHaveBeenCalledTimes(1);
      expect(onBlocked).toHaveBeenCalledWith(2);
    });
  });

  describe('family study publication', () => {
    it('reports a study published after this document started loading', () => {
      publishFamilyStudy('1.2.3');

      expect(localStorage.getItem('currentStudyId')).toBe('1.2.3');
      expect(readFamilyStudyPublishedSinceLoad()).toBe('1.2.3');
    });

    it('ignores a study published before this document started loading', () => {
      // The regular -> VEG -> regular case: this origin's entry is recent in wall-clock terms but
      // predates our navigation, so the URL we were handed already supersedes it. Following it
      // would send a monitor back to the previous patient.
      publishFamilyStudy('1.2.3');
      localStorage.setItem('currentStudyIdAt', String(DOCUMENT_STARTED_AT - 1));

      expect(readFamilyStudyPublishedSinceLoad()).toBeNull();
      // Still readable by builds that only know the untimestamped key.
      expect(localStorage.getItem('currentStudyId')).toBe('1.2.3');
    });

    it('ignores a study written by an older build with no timestamp', () => {
      localStorage.setItem('currentStudyId', '1.2.3');

      expect(readFamilyStudyPublishedSinceLoad()).toBeNull();
    });

    it('returns null when nothing has been published', () => {
      expect(readFamilyStudyPublishedSinceLoad()).toBeNull();
    });
  });

  describe('family departure', () => {
    // Sibling production origins: both report to vet.radimal.ai.
    const HERE = 'https://view.radimal.ai';
    const target = 'https://veg-view.radimal.ai/viewer/?StudyInstanceUIDs=1.2.3';

    it('round-trips a departure published after this document started loading', () => {
      publishFamilyDeparture(target);

      const departure = readFamilyDepartureSinceLoad(HERE);
      expect(departure?.url).toBe(target);
      expect(departure.at).toBeGreaterThanOrEqual(DOCUMENT_STARTED_AT);
    });

    it('ignores a departure published before this document started loading', () => {
      // An old note from a switch that predates this window: the URL this window was handed
      // already reflects it (or supersedes it), so following it would go backward.
      localStorage.setItem(
        'familyDepartureTarget',
        JSON.stringify({ url: target, at: DOCUMENT_STARTED_AT - 1 })
      );

      expect(readFamilyDepartureSinceLoad(HERE)).toBeNull();
    });

    it('honors a departure written after navigation start but before scripts ran', () => {
      // The observed field failure: refresh a monitor, switch the case before the new document's
      // JS evaluates. The note postdates the navigation (so the URL cannot reflect it) but
      // predates module evaluation — a module-eval gate silently discarded exactly these.
      localStorage.setItem(
        'familyDepartureTarget',
        JSON.stringify({ url: target, at: WINDOW_STARTED_AT - 1 })
      );

      expect(readFamilyDepartureSinceLoad(HERE)?.url).toBe(target);
    });

    it("refuses a target that does not report to this window's own vet app", () => {
      publishFamilyDeparture('https://evil.example.com/viewer/?StudyInstanceUIDs=1.2.3');
      expect(readFamilyDepartureSinceLoad(HERE)).toBeNull();

      // A real viewer origin, but paired with a different vet than this window's.
      publishFamilyDeparture(target);
      expect(readFamilyDepartureSinceLoad('http://localhost:3000')).toBeNull();
    });

    it('returns null for malformed or absent notes', () => {
      expect(readFamilyDepartureSinceLoad(HERE)).toBeNull();

      localStorage.setItem('familyDepartureTarget', 'not-json');
      expect(readFamilyDepartureSinceLoad(HERE)).toBeNull();

      localStorage.setItem(
        'familyDepartureTarget',
        JSON.stringify({ url: 'not a url', at: Date.now() })
      );
      expect(readFamilyDepartureSinceLoad(HERE)).toBeNull();
    });
  });

  describe('stripCaseScopedParams', () => {
    it('drops the previous case Orthanc study id so the download button cannot reuse it', () => {
      const url = new URL(
        'https://view.radimal.ai/viewer/?StudyInstanceUIDs=1.2.3.new&studyId=c171e359-c01c9ba5-4d07ebf3-0b05d028-e82ca438&patientId=old-patient'
      );

      stripCaseScopedParams(url);

      expect(url.searchParams.get('studyId')).toBeNull();
      expect(url.searchParams.get('patientId')).toBeNull();
      expect(url.searchParams.get('StudyInstanceUIDs')).toBe('1.2.3.new');
    });

    it('keeps distinct_id, which identifies the user rather than the case', () => {
      const url = new URL(
        'https://view.radimal.ai/viewer/?StudyInstanceUIDs=1.2.3&distinct_id=radimal_vet&studyId=abc'
      );

      stripCaseScopedParams(url);

      expect(url.searchParams.get('distinct_id')).toBe('radimal_vet');
      expect(url.searchParams.get('studyId')).toBeNull();
    });

    it('drops initial series/SOP params, which reference the previous study series', () => {
      const url = new URL(
        'https://view.radimal.ai/viewer/?StudyInstanceUIDs=1.2.3&initialseriesinstanceuid=1.2.3.4&initialsopinstanceuid=1.2.3.4.5'
      );

      stripCaseScopedParams(url);

      expect(url.searchParams.get('initialseriesinstanceuid')).toBeNull();
      expect(url.searchParams.get('initialsopinstanceuid')).toBeNull();
    });
  });
});
