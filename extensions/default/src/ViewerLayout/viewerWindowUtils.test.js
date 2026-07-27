import {
  VIEWER_WINDOW_NAME,
  closeAllViewerWindows,
  openSavedViewerWindows,
  readFamilyWindowData,
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
      expect(openSpy).toHaveBeenCalledWith(
        window.location.href,
        secondaryEntry.id,
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
});
