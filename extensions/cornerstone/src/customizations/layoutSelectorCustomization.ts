import { getShouldUseCPURendering } from '@cornerstonejs/core';

// CPU rendering (the fallback for GPUs that can't draw 16-bit images, e.g.
// smart TVs) only supports stack viewports; MPR/3D layouts throw there.
const VOLUME_VIEWPORT_TYPES = ['volume', 'volume3d', 'orthographic'];
const needsVolumeRendering = (hp: AppTypes.HangingProtocol.Protocol) =>
  (hp.stages ?? []).some(stage =>
    (stage.viewports ?? []).some(viewport =>
      VOLUME_VIEWPORT_TYPES.includes(viewport.viewportOptions?.viewportType)
    )
  );

export default {
  'layoutSelector.advancedPresetGenerator': ({
    servicesManager,
  }: {
    servicesManager: AppTypes.ServicesManager;
  }) => {
    const _areSelectorsValid = (
      hp: AppTypes.HangingProtocol.Protocol,
      displaySets: AppTypes.DisplaySet[],
      hangingProtocolService: AppTypes.HangingProtocolService
    ) => {
      if (!hp.displaySetSelectors || Object.values(hp.displaySetSelectors).length === 0) {
        return true;
      }

      return hangingProtocolService.areRequiredSelectorsValid(
        Object.values(hp.displaySetSelectors),
        displaySets[0]
      );
    };

    const generateAdvancedPresets = ({
      servicesManager,
    }: {
      servicesManager: AppTypes.ServicesManager;
    }) => {
      const { hangingProtocolService, viewportGridService, displaySetService } =
        servicesManager.services;

      const hangingProtocols = Array.from(hangingProtocolService.protocols.values());

      const viewportId = viewportGridService.getActiveViewportId();

      if (!viewportId) {
        return [];
      }
      const displaySetInstanceUIDs = viewportGridService.getDisplaySetsUIDsForViewport(viewportId);

      if (!displaySetInstanceUIDs) {
        return [];
      }

      const displaySets = displaySetInstanceUIDs.map(uid => {
        const displaySet = displaySetService.getDisplaySetByUID(uid);
        const referencedDisplaySetUID = displaySet?.measurements?.[0]?.displaySetInstanceUID;
        if (displaySet.Modality === 'SR' && referencedDisplaySetUID) {
          return displaySetService.getDisplaySetByUID(referencedDisplaySetUID);
        }
        return displaySet;
      });

      return hangingProtocols
        .map(hp => {
          if (!hp.isPreset) {
            return null;
          }

          const areValid = _areSelectorsValid(hp, displaySets, hangingProtocolService);
          const unsupportedOnCPU = getShouldUseCPURendering() && needsVolumeRendering(hp);

          return {
            icon: hp.icon,
            title: hp.name,
            commandOptions: {
              protocolId: hp.id,
            },
            disabled: !areValid || unsupportedOnCPU,
          };
        })
        .filter(preset => preset !== null);
    };

    return generateAdvancedPresets({ servicesManager });
  },
  'layoutSelector.commonPresets': [
    {
      icon: 'layout-common-1x1',
      commandOptions: {
        numRows: 1,
        numCols: 1,
      },
    },
    {
      icon: 'layout-common-1x2',
      commandOptions: {
        numRows: 1,
        numCols: 2,
      },
    },
    {
      icon: 'layout-common-2x2',
      commandOptions: {
        numRows: 2,
        numCols: 2,
      },
    },
    {
      icon: 'layout-common-2x3',
      commandOptions: {
        numRows: 2,
        numCols: 3,
      },
    },
  ],
};
