import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';

import { UserPreferences, AboutModal, useModal } from '@ohif/ui';
import { Header } from '@ohif/ui-next';
import i18n from '@ohif/i18n';
import { hotkeys, defaults } from '@ohif/core';
import { Toolbar } from '../Toolbar/Toolbar';
import HeaderPatientInfo from './HeaderPatientInfo';
import { PatientInfoVisibility } from './HeaderPatientInfo/HeaderPatientInfo';
import useStudyInfo from '../hooks/useStudyInfo';
import { utils } from '@ohif/core';
import { InvalidationService } from '../../../../platform/app/src/utils/invalidationService';
const { orthancUtils } = utils;

const { availableLanguages, defaultLanguage, currentLanguage } = i18n;

function ViewerHeader({
  hotkeysManager,
  extensionManager,
  servicesManager,
  appConfig,
}: withAppTypes<{ appConfig: AppTypes.Config }>) {
  const navigate = useNavigate();
  const location = useLocation();
  const { studyInfo } = useStudyInfo(servicesManager);
  const { uiNotificationService } = servicesManager.services;

  const handleDownloadStudy = async () => {
    if (!studyInfo?.PatientID || !studyInfo?.StudyInstanceUID) {
      uiNotificationService.show({
        title: 'Download Error',
        message: 'Missing required study information for download',
        type: 'error',
        duration: 5000,
      });
      return;
    }

    let reporterOrigin;
    if (window.location.origin === 'http://localhost:3000') {
      reporterOrigin = 'http://localhost:5007';
    } else if (window.location.origin === 'https://viewer.stage-1.radimal.ai') {
      reporterOrigin = 'https://reporter-staging.onrender.com';
    } else if (window.location.origin === 'https://view.radimal.ai') {
      reporterOrigin = 'https://radimal-reporter.onrender.com';
    } else {
      reporterOrigin = 'https://radimal-reporter.onrender.com';
    }

    try {
      uiNotificationService.show({
        title: 'Download Started',
        message: 'Preparing study download...',
        type: 'info',
        duration: 3000,
      });

      await orthancUtils.downloadStudyByDICOMIds(
        studyInfo.PatientID,
        studyInfo.StudyInstanceUID,
        reporterOrigin
      );

      uiNotificationService.show({
        title: 'Download Complete',
        message: 'Study download has been completed successfully',
        type: 'success',
        duration: 5000,
      });
    } catch (error) {
      console.error('Error downloading study:', error);
      uiNotificationService.show({
        title: 'Download Failed',
        message: `Failed to download study: ${error.message || 'Unknown error'}`,
        type: 'error',
        duration: 8000,
      });
    }
  };

  const handleInvalidateCache = async () => {
    if (!studyInfo?.StudyInstanceUID) {
      uiNotificationService.show({
        title: 'Invalidation Error',
        message: 'Missing StudyInstanceUID for cache invalidation',
        type: 'error',
        duration: 5000,
      });
      return;
    }

    try {
      uiNotificationService.show({
        title: 'Cache Invalidation Started',
        message: 'Invalidating cache for current study...',
        type: 'info',
        duration: 3000,
      });

      await InvalidationService.invalidatePath(studyInfo.StudyInstanceUID);

      uiNotificationService.show({
        title: 'Cache Invalidated',
        message: 'Study cache has been invalidated successfully',
        type: 'success',
        duration: 5000,
      });
    } catch (error) {
      console.error('Error invalidating cache:', error);
      uiNotificationService.show({
        title: 'Invalidation Failed',
        message: `Failed to invalidate cache: ${error.message || 'Unknown error'}`,
        type: 'error',
        duration: 8000,
      });
    }
  };

  useEffect(() => {
    const extractStudyId = searchString => {
      const params = new URLSearchParams(searchString);
      return params.get('StudyInstanceUIDs');
    };

    const currentStudyId = extractStudyId(location.search);

    const refreshTab = newStudyId => {
      const currentUrl = new URL(window.location.href);
      currentUrl.searchParams.set('StudyInstanceUIDs', newStudyId);
      window.location.href = currentUrl.toString();
    };

    const handleStorageChange = event => {
      console.log('Changing study', event);
      if (event.key === 'currentStudyId' && event.newValue) {
        const newStudyId = event.newValue;
        if (currentStudyId !== newStudyId) {
          refreshTab(newStudyId);
        }
      }
    };

    if (
      currentStudyId &&
      localStorage.getItem('currentStudyId') !== currentStudyId &&
      window.name == 'viewerWindow'
    ) {
      localStorage.setItem('currentStudyId', currentStudyId);
    }

    window.addEventListener('storage', handleStorageChange);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [location.search]);
  const onClickReturnButton = () => {
    const { pathname } = location;
    const dataSourceIdx = pathname.indexOf('/', 1);
    const query = new URLSearchParams(window.location.search);
    const configUrl = query.get('configUrl');

    const dataSourceName = pathname.substring(dataSourceIdx + 1);
    const existingDataSource = extensionManager.getDataSources(dataSourceName);

    const searchQuery = new URLSearchParams();
    if (dataSourceIdx !== -1 && existingDataSource) {
      searchQuery.append('datasources', pathname.substring(dataSourceIdx + 1));
    }

    if (configUrl) {
      searchQuery.append('configUrl', configUrl);
    }

    navigate({
      pathname: '/',
      search: decodeURIComponent(searchQuery.toString()),
    });
  };

  const { t } = useTranslation();
  const { show, hide } = useModal();
  const { hotkeyDefinitions, hotkeyDefaults } = hotkeysManager;
  const versionNumber = process.env.VERSION_NUMBER;
  const commitHash = process.env.COMMIT_HASH;


  useEffect(() => {
    if (!servicesManager?._commandsManager) {
      return;
    }

    const timer = setTimeout(() => {
      try {
        const saved = localStorage.getItem('defaultToolBindings');
        if (saved) {
          const savedBindings = JSON.parse(saved);
          const primaryTool = savedBindings.find(b => b.id === 'leftMouseButton')?.commandOptions?.toolName;
          const secondaryTool = savedBindings.find(b => b.id === 'rightMouseButton')?.commandOptions?.toolName;
          const auxiliaryTool = savedBindings.find(b => b.id === 'middleMouseButton')?.commandOptions?.toolName;
          
          if (primaryTool || secondaryTool || auxiliaryTool) {
            servicesManager._commandsManager.runCommand(
              'applyMouseButtonBindings',
              {
                primaryTool: primaryTool || 'WindowLevel',
                secondaryTool: secondaryTool || 'Pan', 
                auxiliaryTool: auxiliaryTool || 'Zoom'
              },
              'CORNERSTONE'
            );
          }
        }
      } catch (error) {
        console.warn('Failed to load saved tool preferences:', error);
      }
    }, 1000);

    return () => clearTimeout(timer);
  }, [servicesManager?._commandsManager]);

  const menuOptions = [
    {
      title: t('Header:About'),
      icon: 'info',
      onClick: () =>
        show({
          content: AboutModal,
          title: t('AboutModal:About OHIF Viewer'),
          contentProps: { versionNumber, commitHash },
          containerDimensions: 'max-w-4xl max-h-4xl',
        }),
    },
    {
      title: t('Header:Preferences'),
      icon: 'settings',
      onClick: () =>
        show({
          title: t('UserPreferencesModal:User preferences'),
          content: UserPreferences,
          containerDimensions: 'w-[70%] max-w-[900px]',
          contentProps: {
            hotkeyDefaults: hotkeysManager.getValidHotkeyDefinitions(hotkeyDefaults),
            hotkeyDefinitions,
            defaultToolBindings: defaults.defaultToolBindings,
            currentLanguage: currentLanguage(),
            availableLanguages,
            defaultLanguage,
            onCancel: () => {
              hotkeys.stopRecord();
              hotkeys.unpause();
              hide();
            },
            onActivateTool: (commandName, commandOptions) => {
              if (servicesManager?._commandsManager) {
                try {
                  servicesManager._commandsManager.runCommand(
                    commandName,
                    commandOptions,
                    'CORNERSTONE'
                  );
                } catch (error) {
                  console.error('Failed to activate tool:', error);
                }
              }
            },
            onSubmit: ({ hotkeyDefinitions, language, defaultToolBindings: toolBindings }) => {
              if (language.value !== currentLanguage().value) {
                i18n.changeLanguage(language.value);
              }
              hotkeysManager.setHotkeys(hotkeyDefinitions);
              hide();
            },
            onReset: () => hotkeysManager.restoreDefaultBindings(),
            hotkeysModule: {
              initialize: hotkeys.initialize || (() => {}),
              pause: hotkeys.pause || (() => {}),
              unpause: hotkeys.unpause || (() => {}),
              startRecording: hotkeys.startRecord || (() => {}),
              record: hotkeys.record || (() => {}),
              ...hotkeys,
            },
          },
        }),
    },
    {
      title: 'Invalidate Cache',
      icon: 'refresh',
      onClick: handleInvalidateCache,
    },
  ];

  const monitorOptions = [
    {
      title: t('Header:Duplicate Window'),
      icon: 'tool-monitor',
      onClick: () => {
        let windows = JSON.parse(localStorage.getItem('windowData')) || [];
        const existingWindow = windows.find(win => win.closed && win.id !== 'viewerWindow');

        if (existingWindow) {
          const { width, height, x, y, id, closed } = existingWindow;

          const newWin = window.open(
            window.location.href,
            id,
            `width=${width},height=${height},left=${x},top=${y}`
          );

          if (newWin) {
            existingWindow.closed = false;
            localStorage.setItem('windowData', JSON.stringify(windows));
          }
        } else {
          const newId = `viewerWindow-${Date.now()}`;
          const newWin = window.open(window.location.href, newId);
          if (newWin) {
            const newWindowData = {
              id: newId,
              x: window.screenX,
              y: window.screenY,
              width: window.outerWidth,
              height: window.outerHeight,
              closed: false,
            };

            windows.push(newWindowData);
            localStorage.setItem('windowData', JSON.stringify(windows));
          }
        }
      },
    },
    {
      title: t('Header:Open Saved Windows'),
      icon: 'open-saved-windows',
      onClick: () => {
        let windows = JSON.parse(localStorage.getItem('windowsArray')) || [];
        windows.forEach((win, index) => {
          if (win.id === 'viewerWindow') return;
          setTimeout(() => {
            window.open(
              window.location.href,
              win.id,
              `width=${win.width},height=${win.height},left=${win.x},top=${win.y}`
            );
          }, index * 200);
        });
      },
    },
    {
      title: t('Header:Close Windows'),
      icon: 'close-windows',
      onClick: () => {
        let windowDataArray = [];
        let windows = JSON.parse(localStorage.getItem('windowData')) || [];
        windows.forEach(win => {
          if (win.closed) return;
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
      },
    },
  ];

  if (appConfig.oidc) {
    menuOptions.push({
      title: t('Header:Logout'),
      icon: 'power-off',
      onClick: async () => {
        navigate(`/logout?redirect_uri=${encodeURIComponent(window.location.href)}`);
      },
    });
  }

  return (
    <Header
      menuOptions={menuOptions}
      monitorOptions={monitorOptions}
      isReturnEnabled={!!appConfig.showStudyList}
      onClickReturnButton={onClickReturnButton}
      WhiteLabeling={appConfig.whiteLabeling}
      studyInfo={studyInfo}
      onDownloadStudy={handleDownloadStudy}
      Secondary={
        <Toolbar
          servicesManager={servicesManager}
          buttonSection="secondary"
        />
      }
      PatientInfo={
        appConfig.showPatientInfo !== PatientInfoVisibility.DISABLED && (
          <HeaderPatientInfo
            servicesManager={servicesManager}
            appConfig={appConfig}
          />
        )
      }
    >
      <div className="relative flex justify-center gap-[4px]">
        <Toolbar servicesManager={servicesManager} />
      </div>
    </Header>
  );
}

export default ViewerHeader;
