import React, { useEffect, useState, useCallback, useRef } from 'react';
import PropTypes from 'prop-types';

import { LoadingIndicatorProgress, InvestigationalUseDialog } from '@ohif/ui';
import { HangingProtocolService, CommandsManager, DicomMetadataStore } from '@ohif/core';
import { useAppConfig } from '@state';
import ViewerHeader from './ViewerHeader';
import SidePanelWithServices from '../Components/SidePanelWithServices';
import { Onboarding } from '@ohif/ui-next';
import {
  VIEWER_WINDOW_NAME,
  WINDOW_INSTANCE_ID,
  WINDOW_STARTED_AT,
  closeAllViewerWindows,
  closeOtherFamilyWindows,
  getVetOrigin,
  isManagedViewerWindow,
  openSavedViewerWindows,
  readFamilyWindowData,
  vetOriginFor,
} from './viewerWindowUtils';

function ViewerLayout({
  // From Extension Module Params
  extensionManager,
  servicesManager,
  hotkeysManager,
  commandsManager,
  // From Modes
  viewports,
  ViewportGridComp,
  leftPanelClosed = false,
  rightPanelClosed = false,
}: withAppTypes): React.FunctionComponent {
  const [appConfig] = useAppConfig();

  const { panelService, hangingProtocolService } = servicesManager.services;
  const [showLoadingIndicator, setShowLoadingIndicator] = useState(appConfig.showLoadingIndicator);
  // Series-metadata retrieval progress for the app-level loading overlay.
  // undefined until the first SERIES_ADDED announces a series count (indeterminate bar).
  const [seriesProgress, setSeriesProgress] = useState<
    { loaded: number; total: number } | undefined
  >();

  const hasPanels = useCallback(
    (side): boolean => !!panelService.getPanels(side).length,
    [panelService]
  );

  const [hasRightPanels, setHasRightPanels] = useState(hasPanels('right'));
  const [hasLeftPanels, setHasLeftPanels] = useState(hasPanels('left'));
  const [leftPanelClosedState, setLeftPanelClosed] = useState(leftPanelClosed);
  const [rightPanelClosedState, setRightPanelClosed] = useState(rightPanelClosed);
  const [fade, setFade] = useState(false);
  const fadeRef = useRef(fade);
  fadeRef.current = fade;

  /**
   * Set body classes (tailwindcss) that don't allow vertical
   * or horizontal overflow (no scrolling). Also guarantee window
   * is sized to our viewport.
   */
  useEffect(() => {
    document.body.classList.add('bg-black');
    document.body.classList.add('overflow-hidden');
    return () => {
      document.body.classList.remove('bg-black');
      document.body.classList.remove('overflow-hidden');
    };
  }, []);

  const getComponent = id => {
    const entry = extensionManager.getModuleEntry(id);

    if (!entry || !entry.component) {
      throw new Error(
        `${id} is not valid for an extension module or no component found from extension ${id}. Please verify your configuration or ensure that the extension is properly registered. It's also possible that your mode is utilizing a module from an extension that hasn't been included in its dependencies (add the extension to the "extensionDependencies" array in your mode's index.js file). Check the reference string to the extension in your Mode configuration`
      );
    }

    return { entry, content: entry.component };
  };

  useEffect(() => {
    const { unsubscribe } = hangingProtocolService.subscribe(
      HangingProtocolService.EVENTS.PROTOCOL_CHANGED,

      // Todo: right now to set the loading indicator to false, we need to wait for the
      // hangingProtocolService to finish applying the viewport matching to each viewport,
      // however, this might not be the only approach to set the loading indicator to false. we need to explore this further.
      () => {
        setShowLoadingIndicator(false);
      }
    );

    return () => {
      unsubscribe();
    };
  }, [hangingProtocolService]);

  // Real progress for the app-level loading overlay, driven by series-metadata
  // retrieval: SERIES_ADDED fires once per study with the study's full series
  // list (known up-front from QIDO), and INSTANCES_ADDED fires once per series
  // as its WADO-RS metadata completes. With lazy loading the overlay hides at
  // PROTOCOL_CHANGED after only the hanging-protocol-required series have
  // loaded, so the bar may disappear before reaching 100% — the accompanying
  // text describes the metadata phase truthfully rather than promising 100%.
  // Gated on showLoadingIndicator: it never returns to true within a mount
  // (single setShowLoadingIndicator(false) call site at PROTOCOL_CHANGED), so
  // once the overlay hides this effect re-runs, cleanup unsubscribes, and
  // background series loads (remaining promises, later prior-study loads) can
  // no longer trigger layout-wide re-renders through setSeriesProgress.
  useEffect(() => {
    if (!showLoadingIndicator) {
      return;
    }

    const countedStudyUIDs = new Set<string>();
    const loadedSeriesUIDs = new Set<string>();
    let totalSeries = 0;

    const updateProgress = () => {
      if (totalSeries > 0) {
        setSeriesProgress({ loaded: loadedSeriesUIDs.size, total: totalSeries });
      }
    };

    const seriesAddedSubscription = DicomMetadataStore.subscribe(
      DicomMetadataStore.EVENTS.SERIES_ADDED,
      ({ StudyInstanceUID, seriesSummaryMetadata }) => {
        // Dedupe by study in case SERIES_ADDED re-fires for the same study.
        if (countedStudyUIDs.has(StudyInstanceUID)) {
          return;
        }
        countedStudyUIDs.add(StudyInstanceUID);
        totalSeries += seriesSummaryMetadata.length;
        updateProgress();
      }
    );

    const instancesAddedSubscription = DicomMetadataStore.subscribe(
      DicomMetadataStore.EVENTS.INSTANCES_ADDED,
      ({ StudyInstanceUID, SeriesInstanceUID }) => {
        // Only count series belonging to studies included in the denominator.
        if (!countedStudyUIDs.has(StudyInstanceUID)) {
          return;
        }
        loadedSeriesUIDs.add(SeriesInstanceUID);
        updateProgress();
      }
    );

    return () => {
      seriesAddedSubscription.unsubscribe();
      instancesAddedSubscription.unsubscribe();
    };
  }, [showLoadingIndicator]);

  const getViewportComponentData = viewportComponent => {
    const { entry } = getComponent(viewportComponent.namespace);

    return {
      component: entry.component,
      displaySetsToDisplay: viewportComponent.displaySetsToDisplay,
    };
  };

  useEffect(() => {
    const { unsubscribe } = panelService.subscribe(
      panelService.EVENTS.PANELS_CHANGED,
      ({ options }) => {
        setHasLeftPanels(hasPanels('left'));
        setHasRightPanels(hasPanels('right'));
        if (options?.leftPanelClosed !== undefined) {
          setLeftPanelClosed(options.leftPanelClosed);
        }
        if (options?.rightPanelClosed !== undefined) {
          setRightPanelClosed(options.rightPanelClosed);
        }
      }
    );

    return () => {
      unsubscribe();
    };
  }, [panelService, hasPanels]);

  useEffect(() => {
    // Standalone viewers (empty window.name) must not take part in family window bookkeeping:
    // an { id: '' } entry in windowData gets reused by "Duplicate Window", producing a nameless
    // child that no close/sync mechanism can reach.
    if (!isManagedViewerWindow()) {
      return;
    }

    // Captured at load: a vet-opened window always starts with an opener, a standalone one never
    // does. Lets us tell "opener tab closed" apart from "never had an opener".
    const hadOpener = !!window.opener;
    let openerGoneTicks = 0;

    const saveWindowData = () => {
      const windowData = {
        id: window.name,
        x: window.screenX,
        y: window.screenY,
        width: window.outerWidth,
        height: window.outerHeight,
        closed: false,
      };
      // The window that owns us is gone — the radimal-vet tab for the primary, the window we
      // were duplicated from for a monitor window. Close rather than leaving a stale study on
      // screen: an orphaned window has no path back to radimal-vet and would silently stop
      // following case changes. Chrome nulls window.opener once the opener is destroyed, so
      // check for null as well as closed; navigation/reload of the opener trips neither, and
      // requiring two consecutive ticks avoids acting on a transient state. The primary takes
      // its whole family with it; a monitor window closes only itself (its own duplicates
      // cascade the same way), so a takeover primary's new family is never collateral damage.
      if (hadOpener && (!window.opener || window.opener.closed)) {
        openerGoneTicks += 1;
        if (openerGoneTicks >= 2) {
          if (window.name === VIEWER_WINDOW_NAME) {
            closeAllViewerWindows();
          } else {
            window.close();
          }
          return;
        }
      } else {
        openerGoneTicks = 0;
      }

      // Heartbeat: the primary reports presence, geometry, current study, and fade state to the
      // radimal-vet opener on every tick — even when nothing changed — so the opener can tell
      // the viewer is open without probing for it (probing via window.open would create one).
      // Runs before the localStorage bookkeeping so nothing can starve it.
      if (window.name === VIEWER_WINDOW_NAME && window.opener && !window.opener.closed) {
        const origin = getVetOrigin();
        if (origin) {
          const studyUid = new URLSearchParams(window.location.search).get('StudyInstanceUIDs');
          window.opener.postMessage({ ...windowData, studyUid, faded: fadeRef.current }, origin);
        }
      }

      try {
        const windows = readFamilyWindowData();

        const index = windows.findIndex(win => win.id === windowData.id);

        if (index !== -1) {
          const existingData = windows[index];
          const geometryChanged =
            existingData.x !== windowData.x ||
            existingData.y !== windowData.y ||
            existingData.width !== windowData.width ||
            existingData.height !== windowData.height;
          // beforeunload marks this entry closed on ANY unload, including in-place reloads
          // (banner refresh, F5) where geometry never changes — heal the flag, or every
          // close-by-name mechanism (cross-origin case switch, Close Windows) skips a window
          // that is actually open. A window running this heartbeat is by definition open.
          if (geometryChanged || existingData.closed) {
            windows[index] = windowData;
            localStorage.setItem('windowData', JSON.stringify(windows));
          }
        } else {
          windows.push(windowData);
          localStorage.setItem('windowData', JSON.stringify(windows));
        }
      } catch (error) {
        console.error('Error saving window data:', error);
      }
    };

    saveWindowData();

    const interval = setInterval(saveWindowData, 1000);

    window.addEventListener('resize', saveWindowData);
    window.addEventListener('beforeunload', () => {
      const windows = readFamilyWindowData();
      const index = windows.findIndex(win => win.id === window.name);
      if (index !== -1) {
        windows[index].closed = true;
        localStorage.setItem('windowData', JSON.stringify(windows));
        localStorage.setItem('usingViewer', 'false');
      }
    });

    return () => {
      window.removeEventListener('resize', saveWindowData);
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const channel = new BroadcastChannel('window_channel');
    setFade(false);
    const handleMessage = (event: MessageEvent) => {
      const allowedOrigins = [
        'http://localhost:8000',
        'https://radimal-vet-staging.onrender.com',
        'https://vet.radimal.ai',
      ];

      if (!allowedOrigins.includes(event.origin)) return;
      console.log('Received message:', event.data);
      if (event.data && event.data.type === 'FADE') {
        console.log('Received fade event:', event.data);
        channel.postMessage(event.data);
        setFade(event.data.value);
      } else if (event.data && event.data.type === 'CLOSE') {
        console.log('Received close event:', event.data);
        // closeAllViewerWindows broadcasts CLOSE to the rest of the family itself.
        closeAllViewerWindows();
      } else if (
        event.data &&
        event.data.type === 'LOAD_STUDY' &&
        typeof event.data.url === 'string'
      ) {
        // radimal-vet changed cases; navigate to the new study. Any sibling viewer origin that
        // reports to our vet app is allowed — a VEG↔non-VEG case switch navigates this window
        // cross-origin (e.g. view.radimal.ai → veg-view.radimal.ai). Same-origin, additional
        // monitor windows follow via the currentStudyId storage event once this window reloads;
        // cross-origin they can't (storage events are per-origin), so close them first.
        console.log('Received load study event:', event.data);
        try {
          const url = new URL(event.data.url, window.location.origin);
          const targetVet = vetOriginFor(url.origin);
          if (targetVet && targetVet === getVetOrigin()) {
            if (url.origin !== window.location.origin) {
              closeOtherFamilyWindows();
            }
            window.location.href = url.toString();
          }
        } catch (error) {
          console.error('Invalid LOAD_STUDY url:', event.data.url);
        }
      } else {
        setFade(false);
      }
    };

    window.addEventListener('message', handleMessage);

    return () => {
      window.removeEventListener('message', handleMessage);
      channel.close();
    };
  }, []);

  useEffect(() => {
    const resetViewer = localStorage.getItem('resetViewerStorage');
    if (!resetViewer || resetViewer !== 'false') {
      localStorage.setItem('resetViewerStorage', 'false');
      localStorage.removeItem('windowData');
      localStorage.removeItem('windowsArray');
    }
    // on "first" load - delete all windowData + windowsArray from localStorage
  }, []);

  // "Open Additional Windows On Start" (User Preferences): the primary opened from radimal-vet
  // restores the saved multi-monitor layout automatically. Only the primary restores — a
  // standalone or secondary window re-running this would fight over the same named windows.
  useEffect(() => {
    if (window.name !== VIEWER_WINDOW_NAME) {
      return;
    }
    let openOnStart = false;
    try {
      openOnStart = !!JSON.parse(localStorage.getItem('openAdditionalWindowsOnStart'));
    } catch (error) {
      openOnStart = false;
    }
    if (openOnStart) {
      openSavedViewerWindows(blockedCount => {
        servicesManager.services.uiNotificationService?.show({
          title: 'Popup Blocked',
          message: `The browser blocked ${blockedCount} saved window(s). Allow popups for this site, then use Monitor > Open Saved Windows.`,
          type: 'warning',
          duration: 8000,
        });
      });
    }
  }, [servicesManager]);

  useEffect(() => {
    // Standalone viewers (share links, direct URLs) are not part of the vet-driven window
    // family and must not react to its fade/close/takeover broadcasts.
    if (!isManagedViewerWindow()) {
      return;
    }
    const channel = new BroadcastChannel('window_channel');
    setFade(false);
    channel.onmessage = event => {
      if (event.data.type === 'FADE') {
        console.log('All children received fade event:', event.data);
        setFade(event.data.value);
      } else if (event.data.type === 'CLOSE') {
        console.log('All children received fade event:', event.data);
        window.close();
      } else if (event.data.type === 'CLOSE_OTHERS') {
        // A family window (the primary, before a cross-origin case switch) asked everyone
        // else to close: monitors can't follow a VEG<->non-VEG navigation, so staying open
        // would strand them on the previous patient.
        if (event.data.senderId !== window.name) {
          window.close();
        }
      } else if (event.data.type === 'PRIMARY_TAKEOVER') {
        // A newer primary viewer announced itself (e.g. opened from another radimal-vet tab).
        // Two primaries fight over currentStudyId, so the older one yields.
        const isNewer =
          event.data.startedAt > WINDOW_STARTED_AT ||
          (event.data.startedAt === WINDOW_STARTED_AT &&
            event.data.instanceId > WINDOW_INSTANCE_ID);
        if (
          window.name === VIEWER_WINDOW_NAME &&
          event.data.instanceId !== WINDOW_INSTANCE_ID &&
          isNewer
        ) {
          window.close();
        }
      }
    };

    return () => {
      channel.close();
    };
  }, []);

  useEffect(() => {
    if (window.name !== VIEWER_WINDOW_NAME) {
      return;
    }
    const channel = new BroadcastChannel('window_channel');
    channel.postMessage({
      type: 'PRIMARY_TAKEOVER',
      instanceId: WINDOW_INSTANCE_ID,
      startedAt: WINDOW_STARTED_AT,
    });
    channel.close();
  }, []);

  const viewportComponents = viewports.map(getViewportComponentData);

  return (
    <div
      className={`absolute inset-0 bg-black transition-opacity duration-1000 ${
        fade ? 'opacity-10' : 'opacity-100'
      }`}
    >
      <ViewerHeader
        hotkeysManager={hotkeysManager}
        extensionManager={extensionManager}
        servicesManager={servicesManager}
        appConfig={appConfig}
      />
      <div
        className="relative flex w-full flex-row flex-nowrap items-stretch overflow-hidden bg-black"
        style={{ height: 'calc(100vh - 52px' }}
      >
        <React.Fragment>
          {showLoadingIndicator && (
            <LoadingIndicatorProgress
              className="h-full w-full bg-black"
              progress={
                // Until the first series completes there is no measurable fraction —
                // keep the bar undefined so ProgressLoadingBar animates its infinite
                // sweep instead of sitting frozen at 0% (e.g. single-series CT/MR).
                seriesProgress && seriesProgress.loaded > 0
                  ? Math.min(99, Math.floor((seriesProgress.loaded / seriesProgress.total) * 100))
                  : undefined
              }
              textBlock={
                seriesProgress ? (
                  <div className="text-sm text-white">
                    Loading series metadata (
                    {Math.min(seriesProgress.loaded + 1, seriesProgress.total)} of{' '}
                    {seriesProgress.total})
                  </div>
                ) : undefined
              }
            />
          )}
          {/* LEFT SIDEPANELS */}
          {hasLeftPanels ? (
            <SidePanelWithServices
              side="left"
              activeTabIndex={leftPanelClosedState ? null : 0}
              servicesManager={servicesManager}
            />
          ) : null}
          {/* TOOLBAR + GRID */}
          <div className="flex h-full flex-1 flex-col">
            <div className="relative flex h-full flex-1 items-center justify-center overflow-hidden bg-black">
              <ViewportGridComp
                servicesManager={servicesManager}
                viewportComponents={viewportComponents}
                commandsManager={commandsManager}
              />
            </div>
          </div>
          {hasRightPanels ? (
            <SidePanelWithServices
              side="right"
              activeTabIndex={rightPanelClosedState ? null : 0}
              servicesManager={servicesManager}
            />
          ) : null}
        </React.Fragment>
      </div>
      <Onboarding />
      <InvestigationalUseDialog dialogConfiguration={appConfig?.investigationalUseDialog} />
    </div>
  );
}

ViewerLayout.propTypes = {
  // From extension module params
  extensionManager: PropTypes.shape({
    getModuleEntry: PropTypes.func.isRequired,
  }).isRequired,
  commandsManager: PropTypes.instanceOf(CommandsManager),
  servicesManager: PropTypes.object.isRequired,
  // From modes
  leftPanels: PropTypes.array,
  rightPanels: PropTypes.array,
  leftPanelClosed: PropTypes.bool.isRequired,
  rightPanelClosed: PropTypes.bool.isRequired,
  /** Responsible for rendering our grid of viewports; provided by consuming application */
  children: PropTypes.oneOfType([PropTypes.node, PropTypes.func]).isRequired,
  viewports: PropTypes.array,
};

export default ViewerLayout;
