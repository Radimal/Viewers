import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { Button, Header, Icons, useModal } from '@ohif/ui-next';
import { useSystem } from '@ohif/core';
import { Toolbar } from '../Toolbar/Toolbar';
import HeaderPatientInfo from './HeaderPatientInfo';
import { PatientInfoVisibility } from './HeaderPatientInfo/HeaderPatientInfo';
import { preserveQueryParameters, InvalidationService } from '@ohif/app';
import { Types } from '@ohif/core';
import useStudyInfo from '../hooks/useStudyInfo';

function ViewerHeader({ appConfig }: withAppTypes<{ appConfig: AppTypes.Config }>) {
  const { servicesManager, extensionManager, commandsManager } = useSystem();
  const { customizationService, uiNotificationService } = servicesManager.services;
  const { studyInfo } = useStudyInfo();

  const navigate = useNavigate();
  const location = useLocation();

  const onClickReturnButton = () => {
    const { pathname } = location;
    const dataSourceIdx = pathname.indexOf('/', 1);

    const dataSourceName = pathname.substring(dataSourceIdx + 1);
    const existingDataSource = extensionManager.getDataSources(dataSourceName);

    const searchQuery = new URLSearchParams();
    if (dataSourceIdx !== -1 && existingDataSource) {
      searchQuery.append('datasources', pathname.substring(dataSourceIdx + 1));
    }
    preserveQueryParameters(searchQuery, customizationService);

    navigate({
      pathname: '/',
      search: decodeURIComponent(searchQuery.toString()),
    });
  };

  const { t } = useTranslation();
  const { show } = useModal();

  const AboutModal = customizationService.getCustomization(
    'ohif.aboutModal'
  ) as Types.MenuComponentCustomization;

  const AppearanceModal = customizationService.getCustomization(
    'ohif.appearanceModal'
  ) as Types.MenuComponentCustomization;

  const UserPreferencesModal = customizationService.getCustomization(
    'ohif.userPreferencesModal'
  ) as Types.MenuComponentCustomization;


  // Radimal: invalidate the CDN cache for the current study, then hard-reload
  // with the local caches cleared. Ported from the fork; endpoint comes from
  // radimalEndpoints via InvalidationService.
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

    const clearCachesAndReload = async () => {
      if ('caches' in window) {
        try {
          const cacheNames = await caches.keys();
          await Promise.all(cacheNames.map(name => caches.delete(name)));
        } catch (error) {
          console.warn('Could not clear Cache API:', error);
        }
      }
      const url = new URL(window.location.href);
      url.searchParams.set('_t', `${Date.now()}`);
      window.location.replace(url.toString());
    };

    try {
      uiNotificationService.show({
        title: 'Cache Invalidation Started',
        message: 'Invalidating cache for current study, this can take a few minutes',
        type: 'info',
        duration: 3000,
      });

      await InvalidationService.invalidatePath(studyInfo.StudyInstanceUID);

      uiNotificationService.show({
        title: 'Cache Invalidated',
        message: 'The page will refresh in 30 seconds to reload the study images.',
        type: 'success',
        duration: 5000,
      });
      setTimeout(clearCachesAndReload, 30000);
    } catch (error) {
      console.error('Error invalidating cache:', error);
      uiNotificationService.show({
        title: 'Invalidation Failed',
        message: `Failed to invalidate cache: ${error.message || 'Unknown error'}. Performing hard reload...`,
        type: 'error',
        duration: 3000,
      });
      setTimeout(clearCachesAndReload, 5000);
    }
  };

  // Radimal multi-window actions (windowData/windowsArray contract shared
  // with the ViewerLayout heartbeat).
  const handleDuplicateWindow = () => {
    const windows = JSON.parse(localStorage.getItem('windowData')) || [];
    const existingWindow = windows.find(win => win.closed && win.id !== 'viewerWindow');

    if (existingWindow) {
      const { width, height, x, y, id } = existingWindow;
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
        windows.push({
          id: newId,
          x: window.screenX,
          y: window.screenY,
          width: window.outerWidth,
          height: window.outerHeight,
          closed: false,
        });
        localStorage.setItem('windowData', JSON.stringify(windows));
      }
    }
  };

  const handleOpenSavedWindows = () => {
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
  };

  const handleCloseWindows = () => {
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

  const menuOptions = [
    {
      title: AboutModal?.menuTitle ?? t('Header:About'),
      icon: 'info',
      onClick: () =>
        show({
          content: AboutModal,
          title: AboutModal?.title ?? t('AboutModal:About OHIF Viewer'),
          containerClassName: AboutModal?.containerClassName ?? 'max-w-md',
        }),
    },
    {
      title: UserPreferencesModal.menuTitle ?? t('Header:Preferences'),
      icon: 'settings',
      onClick: () =>
        show({
          content: UserPreferencesModal,
          title: UserPreferencesModal.title ?? t('UserPreferencesModal:User preferences'),
          containerClassName:
            UserPreferencesModal?.containerClassName ?? 'flex max-w-4xl p-6 flex-col',
        }),
    },
  ];

  if (AppearanceModal) {
    menuOptions.splice(1, 0, {
      title: AppearanceModal.menuTitle ?? t('Header:Appearance'),
      icon: 'ColorChange',
      onClick: () =>
        show({
          content: AppearanceModal,
          title: AppearanceModal.title ?? t('AppearanceModal:Appearance'),
          containerClassName: AppearanceModal.containerClassName ?? 'max-w-md',
        }),
    });
  }

  menuOptions.push(
    {
      title: t('Header:Reload Study'),
      icon: 'Refresh',
      onClick: handleInvalidateCache,
    },
    {
      title: t('Header:Duplicate Window'),
      icon: 'tool-monitor',
      onClick: handleDuplicateWindow,
    },
    {
      title: t('Header:Open Saved Windows'),
      icon: 'open-saved-windows',
      onClick: handleOpenSavedWindows,
    }
  );

  // Only the primary window may mass-close (child windows can duplicate).
  if (window.name === 'viewerWindow') {
    menuOptions.push({
      title: t('Header:Close Windows'),
      icon: 'close-windows',
      onClick: handleCloseWindows,
    });
  }

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
      isReturnEnabled={!!appConfig.showStudyList}
      onClickReturnButton={onClickReturnButton}
      WhiteLabeling={appConfig.whiteLabeling}
      Secondary={<Toolbar buttonSection="secondary" />}
      PatientInfo={
        appConfig.showPatientInfo !== PatientInfoVisibility.DISABLED && (
          <HeaderPatientInfo
            servicesManager={servicesManager}
            appConfig={appConfig}
          />
        )
      }
      UndoRedo={
        <div className="text-primary flex cursor-pointer items-center">
          <Button
            variant="ghost"
            className="hover:bg-muted"
            data-cy="undo-btn"
            onClick={() => {
              commandsManager.run('undo');
            }}
          >
            <Icons.Undo className="" />
          </Button>
          <Button
            variant="ghost"
            className="hover:bg-muted"
            data-cy="redo-btn"
            onClick={() => {
              commandsManager.run('redo');
            }}
          >
            <Icons.Redo className="" />
          </Button>
        </div>
      }
    >
      <div className="relative flex justify-center gap-[4px]">
        <Toolbar buttonSection="primary" />
      </div>
    </Header>
  );
}

export default ViewerHeader;
