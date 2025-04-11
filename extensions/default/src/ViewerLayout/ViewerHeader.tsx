import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';

import { UserPreferences, AboutModal, useModal } from '@ohif/ui';
import { Header } from '@ohif/ui-next';
import i18n from '@ohif/i18n';
import { hotkeys } from '@ohif/core';
import { Toolbar } from '../Toolbar/Toolbar';
import HeaderPatientInfo from './HeaderPatientInfo';
import { PatientInfoVisibility } from './HeaderPatientInfo/HeaderPatientInfo';

const { availableLanguages, defaultLanguage, currentLanguage } = i18n;

function ViewerHeader({
  hotkeysManager,
  extensionManager,
  servicesManager,
  appConfig,
}: withAppTypes<{ appConfig: AppTypes.Config }>) {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (window.name !== 'viewerWindow') return;
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
      if (event.key === 'currentStudyId' && event.newValue) {
        const newStudyId = event.newValue;
        if (currentStudyId !== newStudyId && window.name === 'viewerWindow') {
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
            currentLanguage: currentLanguage(),
            availableLanguages,
            defaultLanguage,
            onCancel: () => {
              hotkeys.stopRecord();
              hotkeys.unpause();
              hide();
            },
            onSubmit: ({ hotkeyDefinitions, language }) => {
              if (language.value !== currentLanguage().value) {
                i18n.changeLanguage(language.value);
              }
              hotkeysManager.setHotkeys(hotkeyDefinitions);
              hide();
            },
            onReset: () => hotkeysManager.restoreDefaultBindings(),
            hotkeysModule: hotkeys,
          },
        }),
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
