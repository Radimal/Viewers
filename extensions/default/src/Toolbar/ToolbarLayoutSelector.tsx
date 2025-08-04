import React, { useEffect, useState, useCallback, useRef } from 'react';
import PropTypes from 'prop-types';
import {
  LayoutSelector as OHIFLayoutSelector,
  ToolbarButton,
  LayoutPreset,
  Button,
} from '@ohif/ui';

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

  return {
    rows: 1,
    columns: 1,
    name: '1x1',
  };
};

const saveUserLayoutPreference = (rows, columns) => {
  try {
    const preference = {
      rows,
      columns,
      name: `${rows}x${columns}`,
    };
    localStorage.setItem('userLayoutPreference', JSON.stringify(preference));
    return true;
  } catch (error) {
    console.warn('Failed to save user layout preference:', error);
    return false;
  }
};

const defaultCommonPresets = [
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
];

const _areSelectorsValid = (hp, displaySets, hangingProtocolService) => {
  if (!hp.displaySetSelectors || Object.values(hp.displaySetSelectors).length === 0) {
    return true;
  }

  return hangingProtocolService.areRequiredSelectorsValid(
    Object.values(hp.displaySetSelectors),
    displaySets[0]
  );
};

const generateAdvancedPresets = ({ servicesManager }: withAppTypes) => {
  const { hangingProtocolService, viewportGridService, displaySetService } =
    servicesManager.services;

  const hangingProtocols = Array.from(hangingProtocolService.protocols.values());

  const viewportId = viewportGridService.getActiveViewportId();

  if (!viewportId) {
    return [];
  }
  const displaySetInsaneUIDs = viewportGridService.getDisplaySetsUIDsForViewport(viewportId);

  if (!displaySetInsaneUIDs) {
    return [];
  }

  const displaySets = displaySetInsaneUIDs.map(uid => displaySetService.getDisplaySetByUID(uid));

  return hangingProtocols
    .map(hp => {
      if (!hp.isPreset) {
        return null;
      }

      const areValid = _areSelectorsValid(hp, displaySets, hangingProtocolService);

      return {
        icon: hp.icon,
        title: hp.name,
        commandOptions: {
          protocolId: hp.id,
        },
        disabled: !areValid,
      };
    })
    .filter(preset => preset !== null);
};

function ToolbarLayoutSelectorWithServices({
  commandsManager,
  servicesManager,
  ...props
}: withAppTypes) {
  const [isDisabled, setIsDisabled] = useState(false);

  const handleMouseEnter = () => {
    setIsDisabled(false);
  };

  const onSelection = useCallback(props => {
    commandsManager.run({
      commandName: 'setViewportGridLayout',
      commandOptions: { ...props },
    });
    setIsDisabled(true);
  }, []);

  const onSelectionPreset = useCallback(props => {
    commandsManager.run({
      commandName: 'setHangingProtocol',
      commandOptions: { ...props },
    });
    setIsDisabled(true);
  }, []);

  return (
    <div onMouseEnter={handleMouseEnter}>
      <LayoutSelector
        {...props}
        onSelection={onSelection}
        onSelectionPreset={onSelectionPreset}
        servicesManager={servicesManager}
        tooltipDisabled={isDisabled}
      />
    </div>
  );
}

function LayoutSelector({
  rows = 3,
  columns = 4,
  onLayoutChange = () => {},
  className,
  onSelection,
  onSelectionPreset,
  servicesManager,
  tooltipDisabled,
  ...rest
}: withAppTypes) {
  const [isOpen, setIsOpen] = useState(false);
  const [userDefaultLayout, setUserDefaultLayout] = useState(getUserLayoutPreference());
  const dropdownRef = useRef(null);

  const { customizationService, viewportGridService } = servicesManager.services;
  const commonPresets = customizationService.get('commonPresets') || defaultCommonPresets;
  const advancedPresets =
    customizationService.get('advancedPresets') || generateAdvancedPresets({ servicesManager });

  const closeOnOutsideClick = event => {
    if (isOpen && dropdownRef.current) {
      setIsOpen(false);
    }
  };

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setTimeout(() => {
      window.addEventListener('click', closeOnOutsideClick);
    }, 0);
    return () => {
      window.removeEventListener('click', closeOnOutsideClick);
      dropdownRef.current = null;
    };
  }, [isOpen]);

  const onInteractionHandler = () => {
    setIsOpen(!isOpen);
  };

  const getCurrentLayout = () => {
    try {
      const state = viewportGridService.getState();
      const { numRows, numCols } = state.layout;
      return { rows: numRows, columns: numCols };
    } catch (error) {
      console.warn('Failed to get current layout:', error);
      return { rows: 1, columns: 1 };
    }
  };

  const handleSetAsDefault = () => {
    const currentLayout = getCurrentLayout();
    if (saveUserLayoutPreference(currentLayout.rows, currentLayout.columns)) {
      setUserDefaultLayout({
        rows: currentLayout.rows,
        columns: currentLayout.columns,
        name: `${currentLayout.rows}x${currentLayout.columns}`,
      });
      window.location.reload();
    }
  };

  const DropdownContent = isOpen ? OHIFLayoutSelector : null;

  return (
    <ToolbarButton
      id="Layout"
      label="Layout"
      icon="tool-layout"
      onInteraction={onInteractionHandler}
      className={className}
      rounded={rest.rounded}
      disableToolTip={tooltipDisabled}
      dropdownContent={
        DropdownContent !== null && (
          <div
            className="flex"
            ref={dropdownRef}
          >
            <div className="bg-secondary-dark flex flex-col gap-2.5 p-2">
              <div className="text-aqua-pale text-xs">
                Common
                <span className="text-primary-light ml-2 text-[10px]">
                  (Default: {userDefaultLayout.name})
                </span>
              </div>

              <div className="flex gap-4">
                {commonPresets.map((preset, index) => {
                  const isDefault =
                    preset.commandOptions.numRows === userDefaultLayout.rows &&
                    preset.commandOptions.numCols === userDefaultLayout.columns;
                  return (
                    <LayoutPreset
                      key={index}
                      classNames={`hover:bg-primary-dark group p-1 cursor-pointer ${
                        isDefault ? 'ring-2 ring-primary-light' : ''
                      }`}
                      icon={preset.icon}
                      commandOptions={preset.commandOptions}
                      onSelection={onSelection}
                    />
                  );
                })}
              </div>

              <div className="h-[2px] bg-black"></div>

              <div className="text-aqua-pale text-xs">Advanced</div>

              <div className="flex flex-col gap-2.5">
                {advancedPresets.map((preset, index) => (
                  <LayoutPreset
                    key={index + commonPresets.length}
                    classNames="hover:bg-primary-dark group flex gap-2 p-1 cursor-pointer"
                    icon={preset.icon}
                    title={preset.title}
                    disabled={preset.disabled}
                    commandOptions={preset.commandOptions}
                    onSelection={onSelectionPreset}
                  />
                ))}
              </div>
            </div>

            <div className="bg-primary-dark flex flex-col gap-2.5 border-l-2 border-solid border-black p-2">
              <div className="text-aqua-pale text-xs">Custom</div>
              <DropdownContent
                rows={rows}
                columns={columns}
                onSelection={onSelection}
              />
              <div className="flex flex-col gap-2">
                <p className="text-aqua-pale text-xs leading-tight">Click to apply layout</p>
                <Button
                  size="sm"
                  variant="outlined"
                  className="h-6 px-2 py-1 text-xs"
                  onClick={handleSetAsDefault}
                  disabled={(() => {
                    const current = getCurrentLayout();
                    return (
                      current.rows === userDefaultLayout.rows &&
                      current.columns === userDefaultLayout.columns
                    );
                  })()}
                >
                  Set {getCurrentLayout().rows.toString()}x{getCurrentLayout().columns.toString()}{' '}
                  as Default
                </Button>
              </div>
            </div>
          </div>
        )
      }
      isActive={isOpen}
      type="toggle"
    />
  );
}

LayoutSelector.propTypes = {
  rows: PropTypes.number,
  columns: PropTypes.number,
  onLayoutChange: PropTypes.func,
  servicesManager: PropTypes.object.isRequired,
};

export default ToolbarLayoutSelectorWithServices;
