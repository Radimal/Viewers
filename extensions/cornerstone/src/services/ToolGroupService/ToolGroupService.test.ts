const mockToolGroup = {
  id: 'default',
  modes: {} as Record<string, string>,
  bindings: {} as Record<string, unknown>,
  hasTool: () => true,
  addTool: jest.fn(),
  getToolOptions(toolName) {
    return { mode: this.modes[toolName] };
  },
  setToolActive(toolName, { bindings } = {} as any) {
    this.modes[toolName] = 'Active';
    this.bindings[toolName] = bindings;
  },
  setToolDisabled(toolName) {
    this.modes[toolName] = 'Disabled';
  },
};

jest.mock('@cornerstonejs/tools', () => ({
  ToolGroupManager: { getToolGroup: () => mockToolGroup },
  Enums: {
    MouseBindings: { Primary: 1, Secondary: 2, Wheel: 524288 },
    ToolModes: { Active: 'Active', Passive: 'Passive', Enabled: 'Enabled' },
    Events: {},
  },
}));
jest.mock('@cornerstonejs/core', () => ({ eventTarget: { addEventListener: jest.fn() } }));
jest.mock('@ohif/core', () => ({ pubSubServiceInterface: {} }));
jest.mock('../../utils/getActiveViewportEnabledElement', () => jest.fn());

import ToolGroupService from './ToolGroupService';

const WHEEL = 524288;

it('keeps the mode-entry wheel binding when persisted button bindings load', () => {
  // What the prefs modal persists for Zoom: right click + pinch, no wheel.
  localStorage.setItem(
    'user-preferred-tool-bindings',
    JSON.stringify({ default: { Zoom: [{ mouseButton: 2 }, { numTouchPoints: 2 }] } })
  );
  const service = new ToolGroupService({ services: {} } as any);

  // scrollWheelTool=Zoom: applyWheelPreferences already moved the wheel onto Zoom.
  service.addToolsToToolGroup('default', {
    active: [{ toolName: 'Zoom', bindings: [{ mouseButton: 2 }, { mouseButton: WHEEL }] }],
  } as any);

  expect(mockToolGroup.bindings.Zoom).toEqual([
    { mouseButton: 2 },
    { numTouchPoints: 2 },
    { mouseButton: WHEEL },
  ]);
});
