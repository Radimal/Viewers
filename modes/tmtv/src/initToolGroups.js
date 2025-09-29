export const toolGroupIds = {
  CT: 'ctToolGroup',
  PT: 'ptToolGroup',
  Fusion: 'fusionToolGroup',
  MIP: 'mipToolGroup',
  default: 'default',
};

function _initToolGroups(toolNames, Enums, toolGroupService, commandsManager, modeLabelConfig) {
  const tools = {
    active: [
      {
        toolName: toolNames.WindowLevel,
        bindings: [{ mouseButton: Enums.MouseBindings.Primary }],
      },
      {
        toolName: toolNames.Pan,
        bindings: [{ mouseButton: Enums.MouseBindings.Auxiliary }],
      },
      {
        toolName: toolNames.Zoom,
        bindings: [{ mouseButton: Enums.MouseBindings.Secondary }],
      },
      {
        toolName: toolNames.StackScroll,
        bindings: [{ mouseButton: Enums.MouseBindings.Wheel }],
        configuration: (() => {
          try {
            const invertScrollWheel = localStorage.getItem('invertScrollWheel') === 'true';
            return { invert: invertScrollWheel };
          } catch (error) {
            return {};
          }
        })(),
      },
    ],
    passive: [
      { toolName: toolNames.Length },
      {
        toolName: toolNames.ArrowAnnotate,
        configuration: {
          getTextCallback: (callback, eventDetails) => {
            if (modeLabelConfig) {
              callback(' ');
            } else {
              commandsManager.runCommand('arrowTextCallback', {
                callback,
                eventDetails,
              });
            }
          },
          changeTextCallback: (data, eventDetails, callback) => {
            if (modeLabelConfig === undefined) {
              commandsManager.runCommand('arrowTextCallback', {
                callback,
                data,
                eventDetails,
              });
            }
          },
        },
      },
      { toolName: toolNames.Bidirectional },
      { toolName: toolNames.DragProbe },
      { toolName: toolNames.Probe },
      { toolName: toolNames.EllipticalROI },
      { toolName: toolNames.RectangleROI },
      { toolName: toolNames.StackScroll },
      { toolName: toolNames.Angle },
      { toolName: toolNames.CobbAngle },
      { toolName: toolNames.Magnify },
      {
        toolName: 'CircularBrush',
        parentTool: 'Brush',
        configuration: {
          activeStrategy: 'FILL_INSIDE_CIRCLE',
        },
      },
      {
        toolName: 'CircularEraser',
        parentTool: 'Brush',
        configuration: {
          activeStrategy: 'ERASE_INSIDE_CIRCLE',
        },
      },
      {
        toolName: 'SphereBrush',
        parentTool: 'Brush',
        configuration: {
          activeStrategy: 'FILL_INSIDE_SPHERE',
        },
      },
      {
        toolName: 'SphereEraser',
        parentTool: 'Brush',
        configuration: {
          activeStrategy: 'ERASE_INSIDE_SPHERE',
        },
      },
      {
        toolName: 'ThresholdCircularBrush',
        parentTool: 'Brush',
        configuration: {
          activeStrategy: 'THRESHOLD_INSIDE_CIRCLE',
        },
      },
      {
        toolName: 'ThresholdSphereBrush',
        parentTool: 'Brush',
        configuration: {
          activeStrategy: 'THRESHOLD_INSIDE_SPHERE',
        },
      },
      {
        toolName: 'ThresholdCircularBrushDynamic',
        parentTool: 'Brush',
        configuration: {
          activeStrategy: 'THRESHOLD_INSIDE_CIRCLE',
          // preview: {
          //   enabled: true,
          // },
          strategySpecificConfiguration: {
            // to use the use the center segment index to determine
            // if inside -> same segment, if outside -> eraser
            // useCenterSegmentIndex: true,
            THRESHOLD: {
              isDynamic: true,
              dynamicRadius: 3,
            },
          },
        },
      },
    ],
    enabled: [],
    disabled: [
      {
        toolName: toolNames.Crosshairs,
        configuration: {
          disableOnPassive: true,
          autoPan: {
            enabled: false,
            panSize: 10,
          },
        },
      },
    ],
  };

  toolGroupService.createToolGroupAndAddTools(toolGroupIds.CT, tools);
  toolGroupService.createToolGroupAndAddTools(toolGroupIds.PT, {
    active: tools.active,
    passive: [...tools.passive, { toolName: 'RectangleROIStartEndThreshold' }],
    enabled: tools.enabled,
    disabled: tools.disabled,
  });
  toolGroupService.createToolGroupAndAddTools(toolGroupIds.Fusion, tools);
  toolGroupService.createToolGroupAndAddTools(toolGroupIds.default, tools);

  // Force reconfigure StackScroll tool with inversion setting for all TMTV tool groups
  try {
    const invertScrollWheel = localStorage.getItem('invertScrollWheel') === 'true';
    if (invertScrollWheel) {
      toolGroupService.setToolConfiguration(toolGroupIds.CT, toolNames.StackScroll, { invert: true });
      toolGroupService.setToolConfiguration(toolGroupIds.PT, toolNames.StackScroll, { invert: true });
      toolGroupService.setToolConfiguration(toolGroupIds.Fusion, toolNames.StackScroll, { invert: true });
      toolGroupService.setToolConfiguration(toolGroupIds.default, toolNames.StackScroll, { invert: true });
    }
  } catch (error) {
    console.warn('Failed to reconfigure TMTV StackScroll tools:', error);
  }

  const mipTools = {
    active: [
      {
        toolName: toolNames.VolumeRotate,
        bindings: [{ mouseButton: Enums.MouseBindings.Wheel }],
        configuration: {
          rotateIncrementDegrees: 5,
        },
      },
      {
        toolName: toolNames.MipJumpToClick,
        configuration: {
          toolGroupId: toolGroupIds.PT,
        },
        bindings: [{ mouseButton: Enums.MouseBindings.Primary }],
      },
    ],
    enabled: [
      {
        toolName: toolNames.OrientationMarker,
        configuration: {
          orientationWidget: {
            viewportCorner: 'BOTTOM_LEFT',
          },
        },
      },
    ],
  };

  toolGroupService.createToolGroupAndAddTools(toolGroupIds.MIP, mipTools);
}

function initToolGroups(toolNames, Enums, toolGroupService, commandsManager, modeLabelConfig) {
  _initToolGroups(toolNames, Enums, toolGroupService, commandsManager, modeLabelConfig);
}

export default initToolGroups;
