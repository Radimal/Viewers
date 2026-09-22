// Updated ToolbarLayoutSelector.tsx
import React, { useCallback, useState } from 'react';
import PropTypes from 'prop-types';
import { CommandsManager } from '@ohif/core';

import { LayoutSelector, Button } from '@ohif/ui-next';
import { useTranslation } from 'react-i18next';

// Radimal: "Set NxM as Default". The saved preference shapes the default
// hanging protocol's stage (getHangingProtocolModule reads it at module
// load), so every study opens in the user's grid. Saving reloads the page
// because the protocol is built once at startup.
const getUserLayoutPreference = () => {
  try {
    const saved = localStorage.getItem('userLayoutPreference');
    if (saved) {
      const parsed = JSON.parse(saved);
      return {
        rows: parsed.rows || 1,
        columns: parsed.columns || 1,
        name: parsed.name || '1x1',
      };
    }
  } catch (error) {
    console.warn('Failed to load user layout preference:', error);
  }
  return { rows: 1, columns: 1, name: '1x1' };
};

const saveUserLayoutPreference = (rows, columns) => {
  try {
    localStorage.setItem(
      'userLayoutPreference',
      JSON.stringify({ rows, columns, name: `${rows}x${columns}` })
    );
    return true;
  } catch (error) {
    console.warn('Failed to save user layout preference:', error);
    return false;
  }
};

function ToolbarLayoutSelectorWithServices({
  commandsManager,
  servicesManager,
  rows = 3,
  columns = 4,
  ...props
}) {
  const { customizationService, viewportGridService } = servicesManager.services;
  const { t } = useTranslation('ToolbarLayoutSelector');
  const [userDefaultLayout, setUserDefaultLayout] = useState(getUserLayoutPreference());

  const getCurrentLayout = () => {
    try {
      const { numRows, numCols } = viewportGridService.getState().layout;
      return { rows: numRows, columns: numCols };
    } catch (error) {
      return { rows: 1, columns: 1 };
    }
  };

  const currentLayout = getCurrentLayout();
  const currentIsDefault =
    currentLayout.rows === userDefaultLayout.rows &&
    currentLayout.columns === userDefaultLayout.columns;

  const handleSetAsDefault = () => {
    if (saveUserLayoutPreference(currentLayout.rows, currentLayout.columns)) {
      setUserDefaultLayout(getUserLayoutPreference());
      // The default hanging protocol is built from the preference at module
      // load; a reload is how the new default takes effect.
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
          <div className="bg-muted flex flex-col gap-2.5 border-l-2 border-solid border-background p-2">
            <div className="text-muted-foreground text-xs">{t('Custom')}</div>
            <LayoutSelector.GridSelector
              rows={rows}
              columns={columns}
            />
            <LayoutSelector.HelpText>
              {t('Hover to select')} <br />
              {t('rows and columns')} <br />
              {t('Click to apply')}
            </LayoutSelector.HelpText>
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground text-[10px]">
                {t('Default')}: {userDefaultLayout.name}
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
