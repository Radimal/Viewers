import { toolNames as SRToolNames } from '@ohif/extension-cornerstone-dicom-sr';

const getScrollWheelTool = () => {
  try {
    const saved = localStorage.getItem('scrollWheelTool');
    return saved || 'StackScroll';
  } catch (error) {
    console.warn('Failed to load scroll wheel preference:', error);
    return 'StackScroll';
  }
};

const getScrollWheelInversion = () => {
  try {
    const saved = localStorage.getItem('invertScrollWheel');
    return saved === 'true';
  } catch (error) {
    console.warn('Failed to load scroll wheel inversion preference:', error);
    return false;
  }
};

const getScrollWheelBinding = (toolNames, Enums) => {
  const preference = getScrollWheelTool();

  if (preference === 'Zoom') {
    return {
      wheelTool: toolNames.Zoom,
      secondaryTool: toolNames.StackScroll,
    };
  } else {
    return {
      wheelTool: toolNames.StackScroll,
      secondaryTool: toolNames.Zoom,
    };
  }
};

const colours = {
  'viewport-0': 'rgb(200, 0, 0)',
  'viewport-1': 'rgb(200, 200, 0)',
  'viewport-2': 'rgb(0, 200, 0)',
};

const colorsByOrientation = {
  axial: 'rgb(200, 0, 0)',
  sagittal: 'rgb(200, 200, 0)',
  coronal: 'rgb(0, 200, 0)',
};

function initDefaultToolGroup(
  extensionManager,
  toolGroupService,
  commandsManager,
  toolGroupId,
  modeLabelConfig
) {
  const utilityModule = extensionManager.getModuleEntry(
    '@ohif/extension-cornerstone.utilityModule.tools'
  );

  const { toolNames, Enums } = utilityModule.exports;
  const toolBinding = getScrollWheelBinding(toolNames, Enums);

  // Always get inversion preference for StackScroll tools
  const invertScrollWheel = getScrollWheelInversion();
  const wheelToolConfig = toolBinding.wheelTool === toolNames.StackScroll ? {
    invert: invertScrollWheel,
  } : {};

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
        toolName: toolBinding.wheelTool,
        bindings: [{ mouseButton: Enums.MouseBindings.Wheel }],
        configuration: wheelToolConfig,
      },
      {
        toolName: toolBinding.secondaryTool,
        bindings: [{ mouseButton: Enums.MouseBindings.Secondary }],
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
      { toolName: toolNames.CircleROI },
      { toolName: toolNames.RectangleROI },
      { toolName: toolNames.StackScroll },
      { toolName: toolNames.Angle },
      { toolName: toolNames.CobbAngle },
      { toolName: toolNames.Magnify },
      { toolName: toolNames.CalibrationLine },
      {
        toolName: toolNames.PlanarFreehandContourSegmentation,
        configuration: {
          displayOnePointAsCrosshairs: true,
        },
      },
      { toolName: toolNames.UltrasoundDirectional },
      { toolName: toolNames.PlanarFreehandROI },
      { toolName: toolNames.SplineROI },
      { toolName: toolNames.LivewireContour },
      { toolName: toolNames.WindowLevelRegion },
    ],
    enabled: [
      { toolName: toolNames.ImageOverlayViewer },
      { toolName: toolNames.ReferenceLines },
      {
        toolName: SRToolNames.SRSCOORD3DPoint,
      },
    ],
    disabled: [
      {
        toolName: toolNames.AdvancedMagnify,
      },
    ],
  };

  toolGroupService.createToolGroupAndAddTools(toolGroupId, tools);
  
  // Force reconfigure the StackScroll tool if inversion is enabled
  if (toolBinding.wheelTool === toolNames.StackScroll && invertScrollWheel) {
    try {
      toolGroupService.setToolConfiguration(toolGroupId, toolNames.StackScroll, {
        invert: true,
      });
    } catch (error) {
      console.warn('Failed to reconfigure StackScroll tool:', error);
    }
  }
}

function initSRToolGroup(extensionManager, toolGroupService) {
  const SRUtilityModule = extensionManager.getModuleEntry(
    '@ohif/extension-cornerstone-dicom-sr.utilityModule.tools'
  );

  if (!SRUtilityModule) {
    return;
  }

  const CS3DUtilityModule = extensionManager.getModuleEntry(
    '@ohif/extension-cornerstone.utilityModule.tools'
  );

  const { toolNames: SRToolNames } = SRUtilityModule.exports;
  const { toolNames, Enums } = CS3DUtilityModule.exports;
  const toolBinding = getScrollWheelBinding(toolNames, Enums);
  const invertScrollWheel = getScrollWheelInversion();
  const wheelToolConfig = toolBinding.wheelTool === toolNames.StackScroll ? {
    invert: invertScrollWheel,
  } : {};

  const tools = {
    active: [
      {
        toolName: toolNames.WindowLevel,
        bindings: [
          {
            mouseButton: Enums.MouseBindings.Primary,
          },
        ],
      },
      {
        toolName: toolNames.Pan,
        bindings: [
          {
            mouseButton: Enums.MouseBindings.Auxiliary,
          },
        ],
      },
      {
        toolName: toolBinding.secondaryTool,
        bindings: [
          {
            mouseButton: Enums.MouseBindings.Secondary,
          },
        ],
      },
      {
        toolName: toolBinding.wheelTool,
        bindings: [{ mouseButton: Enums.MouseBindings.Wheel }],
        configuration: wheelToolConfig,
      },
    ],
    passive: [
      { toolName: SRToolNames.SRLength },
      { toolName: SRToolNames.SRArrowAnnotate },
      { toolName: SRToolNames.SRBidirectional },
      { toolName: SRToolNames.SREllipticalROI },
      { toolName: SRToolNames.SRCircleROI },
      { toolName: SRToolNames.SRPlanarFreehandROI },
      { toolName: SRToolNames.SRRectangleROI },
      { toolName: toolNames.WindowLevelRegion },
    ],
    enabled: [
      {
        toolName: SRToolNames.DICOMSRDisplay,
      },
    ],
    // disabled
  };

  const toolGroupId = 'SRToolGroup';
  toolGroupService.createToolGroupAndAddTools(toolGroupId, tools);
  
  // Force reconfigure the StackScroll tool if inversion is enabled
  if (toolBinding.wheelTool === toolNames.StackScroll && invertScrollWheel) {
    try {
      toolGroupService.setToolConfiguration(toolGroupId, toolNames.StackScroll, {
        invert: true,
      });
    } catch (error) {
      console.warn('Failed to reconfigure SRToolGroup StackScroll tool:', error);
    }
  }
}

function initMPRToolGroup(extensionManager, toolGroupService, commandsManager, modeLabelConfig) {
  const utilityModule = extensionManager.getModuleEntry(
    '@ohif/extension-cornerstone.utilityModule.tools'
  );

  const serviceManager = extensionManager._servicesManager;
  const { cornerstoneViewportService } = serviceManager.services;

  const { toolNames, Enums } = utilityModule.exports;
  const toolBinding = getScrollWheelBinding(toolNames, Enums);
  const invertScrollWheel = getScrollWheelInversion();
  const wheelToolConfig = toolBinding.wheelTool === toolNames.StackScroll ? {
    invert: invertScrollWheel,
  } : {};

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
        toolName: toolBinding.wheelTool,
        bindings: [{ mouseButton: Enums.MouseBindings.Wheel }],
        configuration: wheelToolConfig,
      },
      {
        toolName: toolBinding.secondaryTool,
        bindings: [{ mouseButton: Enums.MouseBindings.Secondary }],
      },
    ],
    passive: [
      { toolName: toolNames.Length },
      {
        toolName: toolNames.ArrowAnnotate,
        configuration: {
          getTextCallback: (callback, eventDetails) => {
            if (modeLabelConfig) {
              callback('');
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
      { toolName: toolNames.CircleROI },
      { toolName: toolNames.RectangleROI },
      { toolName: toolNames.StackScroll },
      { toolName: toolNames.Angle },
      { toolName: toolNames.CobbAngle },
      { toolName: toolNames.PlanarFreehandROI },
      { toolName: toolNames.WindowLevelRegion },
      {
        toolName: toolNames.PlanarFreehandContourSegmentation,
        configuration: {
          displayOnePointAsCrosshairs: true,
        },
      },
    ],
    disabled: [
      {
        toolName: toolNames.Crosshairs,
        configuration: {
          viewportIndicators: true,
          viewportIndicatorsConfig: {
            circleRadius: 5,
            xOffset: 0.95,
            yOffset: 0.05,
          },
          disableOnPassive: true,
          autoPan: {
            enabled: false,
            panSize: 10,
          },
          getReferenceLineColor: viewportId => {
            const viewportInfo = cornerstoneViewportService.getViewportInfo(viewportId);
            const viewportOptions = viewportInfo?.viewportOptions;
            if (viewportOptions) {
              return (
                colours[viewportOptions.id] ||
                colorsByOrientation[viewportOptions.orientation] ||
                '#0c0'
              );
            } else {
              console.warn('missing viewport?', viewportId);
              return '#0c0';
            }
          },
        },
      },
      {
        toolName: toolNames.AdvancedMagnify,
      },
      { toolName: toolNames.ReferenceLines },
    ],
  };

  toolGroupService.createToolGroupAndAddTools('mpr', tools);
  
  // Force reconfigure the StackScroll tool if inversion is enabled
  if (toolBinding.wheelTool === toolNames.StackScroll && invertScrollWheel) {
    try {
      toolGroupService.setToolConfiguration('mpr', toolNames.StackScroll, {
        invert: true,
      });
    } catch (error) {
      console.warn('Failed to reconfigure MPRToolGroup StackScroll tool:', error);
    }
  }
}
function initVolume3DToolGroup(extensionManager, toolGroupService) {
  const utilityModule = extensionManager.getModuleEntry(
    '@ohif/extension-cornerstone.utilityModule.tools'
  );

  const { toolNames, Enums } = utilityModule.exports;

  const tools = {
    active: [
      {
        toolName: toolNames.TrackballRotateTool,
        bindings: [{ mouseButton: Enums.MouseBindings.Primary }],
      },
      {
        toolName: toolNames.Zoom,
        bindings: [{ mouseButton: Enums.MouseBindings.Secondary }],
      },
      {
        toolName: toolNames.Pan,
        bindings: [{ mouseButton: Enums.MouseBindings.Auxiliary }],
      },
    ],
  };

  toolGroupService.createToolGroupAndAddTools('volume3d', tools);
}

function initToolGroups(extensionManager, toolGroupService, commandsManager, modeLabelConfig) {
  initDefaultToolGroup(
    extensionManager,
    toolGroupService,
    commandsManager,
    'default',
    modeLabelConfig
  );
  initSRToolGroup(extensionManager, toolGroupService, commandsManager);
  initMPRToolGroup(extensionManager, toolGroupService, commandsManager, modeLabelConfig);
  initVolume3DToolGroup(extensionManager, toolGroupService);
}

export default initToolGroups;
