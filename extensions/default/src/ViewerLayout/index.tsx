import React, { useEffect, useState, useCallback } from 'react';
import PropTypes from 'prop-types';

import { LoadingIndicatorProgress, InvestigationalUseDialog } from '@ohif/ui';
import { HangingProtocolService, CommandsManager } from '@ohif/core';
import { useAppConfig } from '@state';
import ViewerHeader from './ViewerHeader';
import SidePanelWithServices from '../Components/SidePanelWithServices';
import { Onboarding } from '@ohif/ui-next';

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

  const hasPanels = useCallback(
    (side): boolean => !!panelService.getPanels(side).length,
    [panelService]
  );

  const [hasRightPanels, setHasRightPanels] = useState(hasPanels('right'));
  const [hasLeftPanels, setHasLeftPanels] = useState(hasPanels('left'));
  const [leftPanelClosedState, setLeftPanelClosed] = useState(leftPanelClosed);
  const [rightPanelClosedState, setRightPanelClosed] = useState(rightPanelClosed);
  const [fade, setFade] = useState(false);

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
    const saveWindowData = () => {
      const windowData = {
        id: window.name,
        x: window.screenX,
        y: window.screenY,
        width: window.outerWidth,
        height: window.outerHeight,
        closed: false,
      };
      let windows = JSON.parse(localStorage.getItem('windowData')) || [];

      const index = windows.findIndex(win => win.id === windowData.id);

      if (index !== -1) {
        const existingData = windows[index];
        if (
          existingData.x === windowData.x &&
          existingData.y === windowData.y &&
          existingData.width === windowData.width &&
          existingData.height === windowData.height
        ) {
          return;
        }

        windows[index] = windowData;
      } else {
        windows.push(windowData);
      }

      localStorage.setItem('windowData', JSON.stringify(windows));

      if (window.name === 'viewerWindow') {
        let origin;
        if (window.location.origin === 'http://localhost:3000') {
          origin = 'http://localhost:8000';
        } else if (window.location.origin === 'https://viewer.stage-1.radimal.ai') {
          origin = 'https://radimal-vet-staging.onrender.com';
        } else if (window.location.origin === 'https://view.radimal.ai') {
          origin = 'vet.radimal.ai';
        }
        window.opener?.postMessage(windowData, origin);
      }
    };

    saveWindowData();

    const interval = setInterval(saveWindowData, 1000);

    window.addEventListener('resize', saveWindowData);
    window.addEventListener('beforeunload', () => {
      let windows = JSON.parse(localStorage.getItem('windowData')) || [];
      const index = windows.findIndex(win => win.id === window.name);
      if (index !== -1) {
        windows[index].closed = true;
        localStorage.setItem('windowData', JSON.stringify(windows));
      }
    });

    return () => {
      window.removeEventListener('resize', saveWindowData);
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const channel = new BroadcastChannel('fade_channel');
    const handleMessage = (event: MessageEvent) => {
      const allowedOrigins = [
        'http://localhost:8000',
        'https://radimal-vet-staging.onrender.com',
        'https://vet.radimal.ai',
      ];

      if (!allowedOrigins.includes(event.origin)) return;

      if (event.data && event.data.type === 'FADE') {
        channel.postMessage(event.data);
        setFade(event.data.value);
      }
    };

    window.addEventListener('message', handleMessage);

    return () => {
      window.removeEventListener('message', handleMessage);
      channel.close();
    };
  }, []);

  useEffect(() => {
    const channel = new BroadcastChannel('fade_channel');

    channel.onmessage = event => {
      if (event.data.type === 'FADE') {
        console.log('All children received fade event:', event.data);
        setFade(event.data.value);
      }
    };

    return () => {
      channel.close();
    };
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
          {showLoadingIndicator && <LoadingIndicatorProgress className="h-full w-full bg-black" />}
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
