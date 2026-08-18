import React, { useEffect, useState, useCallback } from 'react';
import PropTypes from 'prop-types';

import { InvestigationalUseDialog } from '@ohif/ui-next';
import { HangingProtocolService, CommandsManager, utils } from '@ohif/core';
import { useAppConfig } from '@state';
import ViewerHeader from './ViewerHeader';
import SidePanelWithServices from '../Components/SidePanelWithServices';
import { Onboarding, ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@ohif/ui-next';
import useResizablePanels from './ResizablePanelsHook';

const resizableHandleClassName = 'mt-[1px] bg-background';

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
  leftPanelResizable = false,
  rightPanelResizable = false,
  leftPanelInitialExpandedWidth,
  rightPanelInitialExpandedWidth,
  leftPanelMinimumExpandedWidth,
  rightPanelMinimumExpandedWidth,
}: withAppTypes): React.FunctionComponent {
  const [appConfig] = useAppConfig();

  const { panelService, hangingProtocolService, customizationService } = servicesManager.services;
  const [showLoadingIndicator, setShowLoadingIndicator] = useState(appConfig.showLoadingIndicator);

  const hasPanels = useCallback(
    (side): boolean => !!panelService.getPanels(side).length,
    [panelService]
  );

  const [hasRightPanels, setHasRightPanels] = useState(hasPanels('right'));
  const [hasLeftPanels, setHasLeftPanels] = useState(hasPanels('left'));
  const [leftPanelClosedState, setLeftPanelClosed] = useState(leftPanelClosed);
  // Radimal: vet-app FADE signal dims the whole viewer chrome.
  const [fade, setFade] = useState(false);
  const [rightPanelClosedState, setRightPanelClosed] = useState(rightPanelClosed);

  const [
    leftPanelProps,
    rightPanelProps,
    resizablePanelGroupProps,
    resizableLeftPanelProps,
    resizableViewportGridPanelProps,
    resizableRightPanelProps,
    onHandleDragging,
  ] = useResizablePanels(
    leftPanelClosed,
    setLeftPanelClosed,
    rightPanelClosed,
    setRightPanelClosed,
    hasLeftPanels,
    hasRightPanels,
    leftPanelInitialExpandedWidth,
    rightPanelInitialExpandedWidth,
    leftPanelMinimumExpandedWidth,
    rightPanelMinimumExpandedWidth
  );

  const handleMouseEnter = () => {
    (document.activeElement as HTMLElement)?.blur();
  };

  const LoadingIndicatorProgress = customizationService.getCustomization(
    'ui.loadingIndicatorProgress'
  );

  /**
   * Set body classes (tailwindcss) that don't allow vertical
   * or horizontal overflow (no scrolling). Also guarantee window
   * is sized to our viewport.
   */
  useEffect(() => {
    document.body.classList.add('bg-background');
    document.body.classList.add('overflow-hidden');

    return () => {
      document.body.classList.remove('bg-background');
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

    return { entry };
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

  const getViewportComponentData = viewportComponent => {
    const { entry } = getComponent(viewportComponent.namespace);

    return {
      component: entry.component,
      isReferenceViewable: entry.isReferenceViewable,
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


  // ---------------------------------------------------------------------
  // Radimal multi-window plumbing. The vet app opens the viewer as
  // window.name === 'viewerWindow'; the primary window heartbeats its
  // geometry to the vet app, children mirror FADE/CLOSE over a
  // BroadcastChannel, and window sets persist in localStorage
  // (windowData / windowsArray - shared contract with the header's
  // Duplicate/Open Saved/Close Windows actions).
  // ---------------------------------------------------------------------

  // One-time storage reset per browser profile.
  useEffect(() => {
    if (localStorage.getItem('resetViewerStorage') !== 'false') {
      localStorage.setItem('resetViewerStorage', 'false');
      localStorage.removeItem('windowData');
      localStorage.removeItem('windowsArray');
    }
  }, []);

  // Geometry heartbeat + close tracking.
  useEffect(() => {
    let lastSaved = null;

    const saveWindowData = () => {
      const windowData = {
        id: window.name,
        x: window.screenX,
        y: window.screenY,
        width: window.outerWidth,
        height: window.outerHeight,
        closed: false,
      };

      const serialized = JSON.stringify(windowData);
      if (serialized !== lastSaved) {
        lastSaved = serialized;
        const windows = JSON.parse(localStorage.getItem('windowData')) || [];
        const index = windows.findIndex(win => win.id === windowData.id);
        if (index !== -1) {
          windows[index] = windowData;
        } else {
          windows.push(windowData);
        }
        localStorage.setItem('windowData', JSON.stringify(windows));
      }

      if (window.name === 'viewerWindow') {
        window.opener?.postMessage(windowData, utils.radimalEndpoints.getVetAppOrigin());
      }
    };

    const handleBeforeUnload = () => {
      const windows = JSON.parse(localStorage.getItem('windowData')) || [];
      const index = windows.findIndex(win => win.id === window.name);
      if (index !== -1) {
        windows[index].closed = true;
        localStorage.setItem('windowData', JSON.stringify(windows));
        localStorage.setItem('usingViewer', 'false');
      }
    };

    saveWindowData();
    const interval = setInterval(saveWindowData, 1000);
    window.addEventListener('resize', saveWindowData);
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      clearInterval(interval);
      window.removeEventListener('resize', saveWindowData);
      // The fork leaked this listener; remove it on unmount.
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  // Vet-app postMessage bridge (FADE / CLOSE) + child-window mirror.
  useEffect(() => {
    const channel = new BroadcastChannel('window_channel');

    const closeTrackedWindows = () => {
      const windowDataArray = [];
      const windows = JSON.parse(localStorage.getItem('windowData')) || [];
      windows.forEach(win => {
        if (win.closed) {
          return;
        }
        const childWindow = window.open('', win.id);
        if (childWindow) {
          childWindow.close();
          win.closed = true;
          windowDataArray.push(win);
        }
      });
      localStorage.setItem('windowData', JSON.stringify(windows));
      localStorage.setItem('windowsArray', JSON.stringify(windowDataArray));
      window.close();
    };

    const handleMessage = (event: MessageEvent) => {
      if (!utils.radimalEndpoints.VET_APP_ALLOWED_ORIGINS.includes(event.origin)) {
        return;
      }
      if (event.data?.type === 'FADE') {
        channel.postMessage(event.data);
        setFade(event.data.value);
      } else if (event.data?.type === 'CLOSE') {
        channel.postMessage(event.data);
        closeTrackedWindows();
      } else {
        setFade(false);
      }
    };

    // Child windows mirror the primary's FADE/CLOSE via the channel
    // (BroadcastChannel is same-origin scoped; no origin check needed).
    channel.onmessage = event => {
      if (event.data?.type === 'FADE') {
        setFade(event.data.value);
      } else if (event.data?.type === 'CLOSE' && window.name !== 'viewerWindow') {
        window.close();
      }
    };

    window.addEventListener('message', handleMessage);

    return () => {
      window.removeEventListener('message', handleMessage);
      channel.close();
    };
  }, []);

  // Session restore: reopen saved windows on primary-window start.
  useEffect(() => {
    let openOnStart = false;
    try {
      openOnStart = JSON.parse(localStorage.getItem('openAdditionalWindowsOnStart')) === true;
    } catch (e) {
      openOnStart = false;
    }

    if (!openOnStart || window.name !== 'viewerWindow') {
      return;
    }

    const windows = JSON.parse(localStorage.getItem('windowsArray')) || [];
    windows.forEach((win, index) => {
      if (win.id === 'viewerWindow') {
        return;
      }
      setTimeout(() => {
        window.open(
          window.location.href,
          win.id,
          `width=${win.width},height=${win.height},left=${win.x},top=${win.y}`
        );
      }, index * 200);
    });
  }, []);


  // Cross-tab study sync: when the primary window navigates to a new study,
  // duplicated windows follow via the storage event. (Fork had this in
  // ViewerHeader; it belongs with the rest of the window plumbing.)
  useEffect(() => {
    const currentStudyUID =
      new URLSearchParams(window.location.search).get('StudyInstanceUIDs')?.split(',')[0] ?? '';

    if (window.name === 'viewerWindow' && currentStudyUID) {
      if (localStorage.getItem('currentStudyId') !== currentStudyUID) {
        localStorage.setItem('currentStudyId', currentStudyUID);
      }
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== 'currentStudyId' || !event.newValue || event.newValue === currentStudyUID) {
        return;
      }
      const url = new URL(window.location.href);
      url.searchParams.set('StudyInstanceUIDs', event.newValue);
      window.location.href = url.toString();
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const viewportComponents = viewports.map(getViewportComponentData);

  return (
    <div
      className={'transition-opacity duration-1000 ' + (fade ? 'opacity-10' : 'opacity-100')}
    >
      <ViewerHeader
        hotkeysManager={hotkeysManager}
        extensionManager={extensionManager}
        servicesManager={servicesManager}
        appConfig={appConfig}
      />
      <div
        className="relative flex w-full flex-row flex-nowrap items-stretch overflow-hidden bg-background"
        style={{ height: 'calc(100vh - 52px)' }}
      >
        <React.Fragment>
          {showLoadingIndicator && <LoadingIndicatorProgress className="h-full w-full bg-background" />}
          <ResizablePanelGroup {...resizablePanelGroupProps}>
            {/* LEFT SIDEPANELS */}
            {hasLeftPanels ? (
              <>
                <ResizablePanel {...resizableLeftPanelProps}>
                  <SidePanelWithServices
                    side="left"
                    isExpanded={!leftPanelClosedState}
                    servicesManager={servicesManager}
                    {...leftPanelProps}
                  />
                </ResizablePanel>
                <ResizableHandle
                  onDragging={onHandleDragging}
                  disabled={!leftPanelResizable}
                  className={resizableHandleClassName}
                />
              </>
            ) : null}
            {/* TOOLBAR + GRID */}
            <ResizablePanel {...resizableViewportGridPanelProps}>
              <div className="flex h-full flex-1 flex-col">
                <div
                  className="relative flex h-full flex-1 items-center justify-center overflow-hidden bg-background"
                  onMouseEnter={handleMouseEnter}
                >
                  <ViewportGridComp
                    servicesManager={servicesManager}
                    viewportComponents={viewportComponents}
                    commandsManager={commandsManager}
                  />
                </div>
              </div>
            </ResizablePanel>
            {hasRightPanels ? (
              <>
                <ResizableHandle
                  onDragging={onHandleDragging}
                  disabled={!rightPanelResizable}
                  className={resizableHandleClassName}
                />
                <ResizablePanel {...resizableRightPanelProps}>
                  <SidePanelWithServices
                    side="right"
                    isExpanded={!rightPanelClosedState}
                    servicesManager={servicesManager}
                    {...rightPanelProps}
                  />
                </ResizablePanel>
              </>
            ) : null}
          </ResizablePanelGroup>
        </React.Fragment>
      </div>
      <Onboarding tours={customizationService.getCustomization('ohif.tours')} />
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
