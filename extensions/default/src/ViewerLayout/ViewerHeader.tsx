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
import {
  VIEWER_WINDOW_NAME,
  closeAllViewerWindows,
  isManagedViewerWindow,
  isPrimaryViewerWindow,
  nextMonitorWindowId,
  openSavedViewerWindows,
  publishFamilyStudy,
  readFamilyWindowData,
  readFamilyStudyPublishedSinceLoad,
  stripCaseScopedParams,
} from './viewerWindowUtils';
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
    const reporterOrigin = orthancUtils.reporterOriginFor(window.location.origin);

    // resolveDownloadStudyId validates `?studyId=` against the id derived from `?patientId=` +
    // `?StudyInstanceUIDs=` and refuses if they contradict each other. studyInfo from loaded
    // metadata remains the last resort, for URLs carrying neither.
    const params = new URLSearchParams(window.location.search);
    const studyId = params.get('studyId');
    const distinctId = params.get('distinct_id');
    const patientIdParam = params.get('patientId') || params.get('PatientID');
    const studyInstanceUIDParam = params.get('StudyInstanceUIDs')?.split(',')[0];

    try {
      uiNotificationService.show({
        title: 'Download Started',
        message: 'Preparing study download...',
        type: 'info',
        duration: 3000,
      });

      const resolved = await orthancUtils.resolveDownloadStudyId({
        studyId,
        patientId: patientIdParam,
        studyInstanceUID: studyInstanceUIDParam,
      });

      if (resolved.error) {
        console.error('Refusing to download:', resolved.detail);
        uiNotificationService.show({
          title: 'Download Error',
          message: resolved.error,
          type: 'error',
          duration: 8000,
        });
        return;
      }

      if (resolved.studyId) {
        await orthancUtils.downloadOrthancStudy(resolved.studyId, reporterOrigin, distinctId);
      } else if (studyInfo?.PatientID && studyInfo?.StudyInstanceUID) {
        await orthancUtils.downloadStudyByDICOMIds(
          studyInfo.PatientID,
          studyInfo.StudyInstanceUID,
          reporterOrigin
        );
      } else {
        uiNotificationService.show({
          title: 'Download Error',
          message: 'Missing required study information for download',
          type: 'error',
          duration: 5000,
        });
        return;
      }

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
        message: 'Invalidating cache for current study, this can take a few minutes',
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

      uiNotificationService.show({
        title: 'Page refresh scheduled',
        message: 'The page will refresh in 30 seconds to reload the study images.',
        type: 'info',
        duration: 5000,
      });
      setTimeout(async () => {
        // Clear Cache API
        if ('caches' in window) {
          try {
            const cacheNames = await caches.keys();
            await Promise.all(cacheNames.map(name => caches.delete(name)));
            console.log('✅ Cleared Cache API storage');
          } catch (error) {
            console.warn('⚠️ Could not clear Cache API:', error);
          }
        }

        // Force reload with cache-busting
        const url = new URL(window.location);
        url.searchParams.set('_t', Date.now());
        window.location.replace(url.toString());
      }, 30000);
    } catch (error) {
      console.error('Error invalidating cache:', error);
      uiNotificationService.show({
        title: 'Invalidation Failed',
        message: `Failed to invalidate cache: ${error.message || 'Unknown error'}. Performing hard reload...`,
        type: 'error',
        duration: 3000,
      });

      // Perform hard reload even if CDN invalidation failed
      setTimeout(async () => {
        // Clear Cache API
        if ('caches' in window) {
          try {
            const cacheNames = await caches.keys();
            await Promise.all(cacheNames.map(name => caches.delete(name)));
            console.log('✅ Cleared Cache API storage after error');
          } catch (cacheError) {
            console.warn('⚠️ Could not clear Cache API after error:', cacheError);
          }
        }

        // Force reload with cache-busting
        const url = new URL(window.location);
        url.searchParams.set('_t', Date.now());
        window.location.replace(url.toString());
      }, 5000);
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
      if (event.key === 'currentStudyId' && event.newValue) {
        if (!followsFamilyStudy) {
          return;
        }
        console.log('Changing study', event);
        const newStudyId = event.newValue;
        if (currentStudyId !== newStudyId) {
          refreshTab(newStudyId);
        }
      }
    };

    if (
      isPrimaryViewerWindow() &&
      currentStudyId &&
      localStorage.getItem('currentStudyId') !== currentStudyId
    ) {
      publishFamilyStudy(currentStudyId);
    }

    // Reconcile on mount as well as on the event. Listeners only exist once this component has
    // mounted, so a monitor that was still loading when the family switched case never hears
    // about it and sits on the previous patient until the NEXT switch.
    if (followsFamilyStudy && currentStudyId) {
      const intendedStudyId = readFamilyStudyPublishedSinceLoad();
      if (intendedStudyId && intendedStudyId !== currentStudyId) {
        console.log('Catching up to family study', intendedStudyId);
        refreshTab(intendedStudyId);
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
  const buildTime = process.env.BUILD_TIME;

  useEffect(() => {
    if (!servicesManager?._commandsManager) {
      return;
    }

    const timer = setTimeout(() => {
      try {
        const saved = localStorage.getItem('defaultToolBindings');
        if (saved) {
          const savedBindings = JSON.parse(saved);
          const primaryTool = savedBindings.find(b => b.id === 'leftMouseButton')?.commandOptions
            ?.toolName;
          const secondaryTool = savedBindings.find(b => b.id === 'rightMouseButton')?.commandOptions
            ?.toolName;
          const auxiliaryTool = savedBindings.find(b => b.id === 'middleMouseButton')
            ?.commandOptions?.toolName;

          if (primaryTool || secondaryTool || auxiliaryTool) {
            servicesManager._commandsManager.runCommand(
              'applyMouseButtonBindings',
              {
                primaryTool: primaryTool || 'WindowLevel',
                secondaryTool: secondaryTool || 'Pan',
                auxiliaryTool: auxiliaryTool || 'Zoom',
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
          contentProps: { versionNumber, commitHash, buildTime },
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
      title: t('Reload Study'),
      icon: 'Refresh',
      onClick: handleInvalidateCache,
    },
  ];

  const monitorOptions = [
    {
      title: t('Header:Duplicate Window'),
      icon: 'tool-monitor',
      onClick: () => {
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
      },
    },
    {
      title: t('Header:Open Saved Windows'),
      icon: 'open-saved-windows',
      onClick: () => {
        openSavedViewerWindows(blockedCount => {
          uiNotificationService.show({
            title: 'Popup Blocked',
            message: `The browser blocked ${blockedCount} saved window(s). Allow popups for this site to restore them.`,
            type: 'warning',
            duration: 8000,
          });
        });
      },
    },
    {
      title: t('Header:Close Windows'),
      icon: 'close-windows',
      onClick: closeAllViewerWindows,
    },
  ];

  // Managing the window family is the primary window's job alone.
  //
  // Offering Duplicate Window to a standalone share-link viewer was actively unsafe: the child is
  // named viewerWindow-N, which makes it a *managed* family window, so it starts following the vet
  // family's currentStudyId and can land on a different patient's case. It also registers in
  // windowData under an id the real family is already using.
  //
  // Monitor windows gain nothing from these either — Duplicate Window and Open Saved Windows
  // target their own canonical name and would just force-reload them.
  const familyWindowOptions = isPrimaryViewerWindow() ? monitorOptions : [];

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
      monitorOptions={familyWindowOptions}
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
