import React, { useEffect } from 'react';
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
import {
  VIEWER_WINDOW_NAME,
  closeAllViewerWindows,
  isManagedViewerWindow,
  isPrimaryViewerWindow,
  nextMonitorWindowId,
  openSavedViewerWindows,
  publishFamilyArrival,
  readFamilyDepartureSinceLoad,
  readFamilyWindowData,
  reconcileFamilyOnMount,
  stripCaseScopedParams,
} from './viewerWindowUtils';

function ViewerHeader({ appConfig }: withAppTypes<{ appConfig: AppTypes.Config }>) {
  const { servicesManager, extensionManager, commandsManager } = useSystem();
  const { customizationService, uiNotificationService } = servicesManager.services;

  const navigate = useNavigate();
  const location = useLocation();

  const { studyInfo } = useStudyInfo();

  useEffect(() => {
    const extractStudyId = searchString => {
      const params = new URLSearchParams(searchString);
      return params.get('StudyInstanceUIDs');
    };

    const currentStudyId = extractStudyId(location.search);

    const refreshTab = newStudyId => {
      const currentUrl = new URL(window.location.href);
      currentUrl.searchParams.set('StudyInstanceUIDs', newStudyId);
      // This URL described the PREVIOUS case; only StudyInstanceUIDs is being updated, so every
      // other case-scoped param would now point at the wrong study.
      stripCaseScopedParams(currentUrl);
      window.location.href = currentUrl.toString();
    };

    // Only additional monitor windows follow cross-window study changes. The primary is driven
    // directly by its radimal-vet tab (LOAD_STUDY), and standalone share-link viewers must not be
    // hijacked by another window's study change.
    const followsFamilyStudy = isManagedViewerWindow() && !isPrimaryViewerWindow();

    const handleStorageChange = event => {
      if (!followsFamilyStudy || !event.newValue) {
        return;
      }
      // The primary wrote a departure note: it is leaving this origin for a sibling one
      // (VEG <-> non-VEG). The storage event is this monitor's most reliable signal — unlike the
      // NAVIGATE_FAMILY broadcast it needs no channel listener race, and unlike window.open by
      // name it cannot spawn a window. Re-read through the validating reader rather than trusting
      // event.newValue.
      if (event.key === 'familyDepartureTarget') {
        const departure = readFamilyDepartureSinceLoad();
        if (departure && departure.url !== window.location.href) {
          window.location.href = departure.url;
        }
        return;
      }
      if (event.key === 'currentStudyId') {
        const newStudyId = event.newValue;
        if (currentStudyId !== newStudyId) {
          refreshTab(newStudyId);
        }
      }
    };

    if (isPrimaryViewerWindow() && currentStudyId) {
      publishFamilyArrival(currentStudyId);
    }

    // Reconcile on mount as well as on the event: a monitor that was still loading when the
    // family switched case had no listeners yet, so this is where it catches up.
    if (followsFamilyStudy && currentStudyId) {
      const decision = reconcileFamilyOnMount(currentStudyId);
      if (decision.action === 'follow-departure') {
        window.location.href = decision.url;
      } else if (decision.action === 'catch-up') {
        refreshTab(decision.studyInstanceUid);
      }
    }

    window.addEventListener('storage', handleStorageChange);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [location.search]);

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
  // orthancUtils.reporterOriginFor via InvalidationService.
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

  // Radimal multi-window actions (.71 implementation: canonical positional
  // monitor ids, broadcast-first close, popup-block feedback).
  const handleDuplicateWindow = () => {
    const windows = readFamilyWindowData();
    // Canonical positional id (viewerWindow-N) so every origin addresses the same
    // physical window; prefer that entry's own saved geometry, else any closed monitor's.
    const newId = nextMonitorWindowId();
    const reusable =
      windows.find(win => win.closed && win.id === newId) ||
      windows.find(win => win.closed && win.id !== VIEWER_WINDOW_NAME);

    const newWin = reusable
      ? window.open(
          window.location.href,
          newId,
          `width=${reusable.width},height=${reusable.height},left=${reusable.x},top=${reusable.y}`
        )
      : window.open(window.location.href, newId);

    if (newWin) {
      // Drop the consumed entry (it may carry a legacy timestamped id) and register the
      // canonical one; the new window's own heartbeat keeps it fresh from here.
      const remaining = windows.filter(win => win !== reusable && win.id !== newId);
      remaining.push({
        id: newId,
        x: reusable?.x ?? window.screenX,
        y: reusable?.y ?? window.screenY,
        width: reusable?.width ?? window.outerWidth,
        height: reusable?.height ?? window.outerHeight,
        closed: false,
      });
      localStorage.setItem('windowData', JSON.stringify(remaining));
    }
  };

  const handleOpenSavedWindows = () => {
    openSavedViewerWindows(blockedCount => {
      uiNotificationService.show({
        title: 'Popup Blocked',
        message: `The browser blocked ${blockedCount} saved window(s). Allow popups for this site to restore them.`,
        type: 'warning',
        duration: 8000,
      });
    });
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

  menuOptions.push({
    title: t('Header:Reload Study'),
    icon: 'Refresh',
    onClick: handleInvalidateCache,
  });

  // Managing the window family is the primary window's job alone: a standalone
  // share-link viewer duplicating itself would mint a managed viewerWindow-N
  // name and start following the vet family's study changes.
  if (isPrimaryViewerWindow()) {
    menuOptions.push(
      {
        title: t('Header:Duplicate Window'),
        icon: 'tool-monitor',
        onClick: handleDuplicateWindow,
      },
      {
        title: t('Header:Open Saved Windows'),
        icon: 'open-saved-windows',
        onClick: handleOpenSavedWindows,
      },
      {
        title: t('Header:Close Windows'),
        icon: 'close-windows',
        onClick: closeAllViewerWindows,
      }
    );
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
