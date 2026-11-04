// Updated ToolbarLayoutSelector.tsx
import React, { useCallback, useState } from 'react';
import PropTypes from 'prop-types';
import { CommandsManager } from '@ohif/core';

import { LayoutSelector, Button } from '@ohif/ui-next';
import { useTranslation } from 'react-i18next';
import {
  getUserLayoutPreference,
  saveUserLayoutPreference,
  getLayoutPreferenceByModality,
  isImageModality,
  saveLayoutPreferenceForModality,
  layoutGroupFor,
  layoutGroupLabel,
} from '../utils/layoutPreference';

// Radimal: "Set NxM as Default", for all studies or for the active viewport's
// modality group. The saved preferences shape the default hanging protocols
// (getHangingProtocolModule reads them at module load), so every study opens
// in the user's grid. Saving reloads the page because the protocols are built
// once at startup.

function ToolbarLayoutSelectorWithServices({
  commandsManager,
  servicesManager,
  rows = 3,
  columns = 4,
  ...props
}) {
  const { customizationService, viewportGridService, displaySetService } = servicesManager.services;
  const { t } = useTranslation('ToolbarLayoutSelector');
  const [userDefaultLayout] = useState(getUserLayoutPreference);
  const [defaultsByModality] = useState(getLayoutPreferenceByModality);

  const getCurrentLayout = () => {
    try {
      const { numRows, numCols } = viewportGridService.getState().layout;
      return { rows: numRows, columns: numCols };
    } catch (error) {
      return { rows: 1, columns: 1 };
    }
  };

  // Modality group of the active viewport's series, e.g. CR/DX -> XRAY.
  const getActiveGroup = () => {
    try {
      const { activeViewportId, viewports } = viewportGridService.getState();
      const [uid] = viewports.get(activeViewportId)?.displaySetInstanceUIDs ?? [];
      const modality = uid && displaySetService.getDisplaySetByUID(uid)?.Modality;
      return modality && isImageModality(modality) ? layoutGroupFor(modality) : undefined;
    } catch (error) {
      return undefined;
    }
  };

  const currentLayout = getCurrentLayout();
  const isSameLayout = layout =>
    layout?.rows === currentLayout.rows && layout?.columns === currentLayout.columns;
  const currentIsDefault = isSameLayout(userDefaultLayout);
  const activeGroup = getActiveGroup();
  const groupDefault = activeGroup && defaultsByModality[activeGroup];

  // The default hanging protocols are built from the preferences at module
  // load; a reload is how a new default takes effect.
  const handleSetAsDefault = () => {
    if (saveUserLayoutPreference(currentLayout.rows, currentLayout.columns)) {
      window.location.reload();
    }
  };

  const handleSetAsGroupDefault = () => {
    if (saveLayoutPreferenceForModality(activeGroup, currentLayout.rows, currentLayout.columns)) {
      window.location.reload();
    }
  };

  // Get the presets from the customization service
  const commonPresets = customizationService?.getCustomization('layoutSelector.commonPresets') || [
    {
      icon: 'layout-single',
      commandOptions: {
        numRows: 1,
        numCols: 1,
      },
    },
    {
      icon: 'layout-side-by-side',
      commandOptions: {
        numRows: 1,
        numCols: 2,
      },
    },
    {
      icon: 'layout-four-up',
      commandOptions: {
        numRows: 2,
        numCols: 2,
      },
    },
    {
      icon: 'layout-three-row',
      commandOptions: {
        numRows: 3,
        numCols: 1,
      },
    },
  ];

  // Get the advanced presets generator from the customization service
  const advancedPresetsGenerator = customizationService?.getCustomization(
    'layoutSelector.advancedPresetGenerator'
  );

  // Generate the advanced presets
  const advancedPresets = advancedPresetsGenerator
    ? advancedPresetsGenerator({ servicesManager })
    : [
        {
          title: 'MPR',
          icon: 'layout-three-col',
          commandOptions: {
            protocolId: 'mpr',
          },
        },
        {
          title: '3D four up',
          icon: 'layout-four-up',
          commandOptions: {
            protocolId: '3d-four-up',
          },
        },
        {
          title: '3D main',
          icon: 'layout-three-row',
          commandOptions: {
            protocolId: '3d-main',
          },
        },
        {
          title: 'Axial Primary',
          icon: 'layout-side-by-side',
          commandOptions: {
            protocolId: 'axial-primary',
          },
        },
        {
          title: '3D only',
          icon: 'layout-single',
          commandOptions: {
            protocolId: '3d-only',
          },
        },
        {
          title: '3D primary',
          icon: 'layout-side-by-side',
          commandOptions: {
            protocolId: '3d-primary',
          },
        },
        {
          title: 'Frame View',
          icon: 'icon-stack',
          commandOptions: {
            protocolId: 'frame-view',
          },
        },
      ];

  // Unified selection handler that dispatches to the appropriate command
  const handleSelectionChange = useCallback(
    (commandOptions, isPreset) => {
      if (isPreset) {
        // Advanced preset selection
        commandsManager.run({
          commandName: 'setHangingProtocol',
          commandOptions,
        });
      } else {
        // Common preset or custom grid selection
        commandsManager.run({
          commandName: 'setViewportGridLayout',
          commandOptions,
        });
      }
    },
    [commandsManager]
  );

  return (
    <div
      id="Layout"
      data-cy="Layout"
    >
      <LayoutSelector
        onSelectionChange={handleSelectionChange}
        {...props}
      >
        <LayoutSelector.Trigger tooltip={t('Change layout')} />
        <LayoutSelector.Content>
          {/* Left side - Presets */}
          {(commonPresets.length > 0 || advancedPresets.length > 0) && (
            <div className="bg-popover flex flex-col gap-2.5 rounded-lg p-2">
              {commonPresets.length > 0 && (
                <>
                  <LayoutSelector.PresetSection title={t('Common')}>
                    {commonPresets.map((preset, index) => (
                      <LayoutSelector.Preset
                        key={`common-preset-${index}`}
                        icon={preset.icon}
                        commandOptions={preset.commandOptions}
                        isPreset={false}
                      />
                    ))}
                  </LayoutSelector.PresetSection>
                  <LayoutSelector.Divider />
                </>
              )}

              {advancedPresets.length > 0 && (
                <LayoutSelector.PresetSection title={t('Advanced')}>
                  {advancedPresets.map((preset, index) => (
                    <LayoutSelector.Preset
                      key={`advanced-preset-${index}`}
                      title={preset.title}
                      icon={preset.icon}
                      commandOptions={preset.commandOptions}
                      disabled={preset.disabled}
                      isPreset={true}
                    />
                  ))}
                </LayoutSelector.PresetSection>
              )}
            </div>
          )}

          {/* Right Side - Grid Layout */}
          <div className="bg-muted border-background flex flex-col gap-2.5 border-l-2 border-solid p-2">
            <div className="text-muted-foreground text-xs">{t('Custom')}</div>
            {/* Radimal: the theme's accent/muted are both black, so give the
                cells and the grid a light outline to show they're there. */}
            <LayoutSelector.GridSelector
              rows={rows}
              columns={columns}
              className="border-foreground/30 [&>div]:border-foreground/25 w-[fit-content] rounded-sm border p-[2px] [&>div]:border"
            />
            <LayoutSelector.HelpText>
              {t('Hover to select')} <br />
              {t('rows and columns')} <br />
              {t('Click to apply')}
            </LayoutSelector.HelpText>
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground text-[10px]">
                {t('Default')}: {userDefaultLayout.name}
                {groupDefault && ` · ${layoutGroupLabel(activeGroup)}: ${groupDefault.name}`}
              </span>
              <Button
                size="sm"
                variant="secondary"
                className="h-6 px-2 py-1 text-xs"
                onClick={handleSetAsDefault}
                disabled={currentIsDefault}
              >
                {t('Set {{layout}} as Default', {
                  layout: `${currentLayout.rows}x${currentLayout.columns}`,
                  defaultValue: `Set ${currentLayout.rows}x${currentLayout.columns} as Default`,
                })}
              </Button>
              {activeGroup && (
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-6 px-2 py-1 text-xs"
                  onClick={handleSetAsGroupDefault}
                  disabled={isSameLayout(groupDefault)}
                >
                  {t('Set {{layout}} as Default for {{modality}}', {
                    layout: `${currentLayout.rows}x${currentLayout.columns}`,
                    modality: layoutGroupLabel(activeGroup),
                    defaultValue: `Set ${currentLayout.rows}x${currentLayout.columns} as Default for ${layoutGroupLabel(activeGroup)}`,
                  })}
                </Button>
              )}
            </div>
          </div>
        </LayoutSelector.Content>
      </LayoutSelector>
    </div>
  );
}

ToolbarLayoutSelectorWithServices.propTypes = {
  commandsManager: PropTypes.instanceOf(CommandsManager),
  servicesManager: PropTypes.object,
  rows: PropTypes.number,
  columns: PropTypes.number,
};

export default ToolbarLayoutSelectorWithServices;
