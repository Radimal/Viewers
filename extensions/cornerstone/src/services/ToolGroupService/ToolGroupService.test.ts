// Minimal stand-in for a cs3d ToolGroup: setToolActive merges bindings,
// setToolPassive strips the listed ones, setToolDisabled clears them.
const mockToolGroup = {
  id: 'default',
  options: {} as Record<string, { mode: string; bindings: any[] }>,
  hasTool: () => true,
  addTool() {},
  getToolOptions(toolName) {
    return this.options[toolName] || { mode: 'Passive', bindings: [] };
  },
  setToolActive(toolName, { bindings = [] } = {} as any) {
    const merged = [...this.getToolOptions(toolName).bindings];
    bindings.forEach(b => {
      if (!merged.some(m => JSON.stringify(m) === JSON.stringify(b))) {
        merged.push(b);
      }
    });
    this.options[toolName] = { mode: 'Active', bindings: merged };
  },
  setToolPassive(toolName, { removeAllBindings = [] } = {} as any) {
    const bindings = this.getToolOptions(toolName).bindings.filter(
      b => !removeAllBindings.some(r => r.mouseButton === b.mouseButton && b.modifierKey == null)
    );
    this.options[toolName] = { mode: bindings.length ? 'Active' : 'Passive', bindings };
  },
  setToolDisabled(toolName) {
    this.options[toolName] = { mode: 'Disabled', bindings: [] };
  },
};

jest.mock('@cornerstonejs/tools', () => ({
  ToolGroupManager: { getToolGroup: () => mockToolGroup },
  Enums: {
    MouseBindings: { Primary: 1, Secondary: 2, Auxiliary: 4, Wheel: 524288 },
    ToolModes: { Active: 'Active', Passive: 'Passive', Enabled: 'Enabled' },
    Events: {},
  },
}));
jest.mock('@cornerstonejs/core', () => ({ eventTarget: { addEventListener: jest.fn() } }));
jest.mock('@ohif/core', () => ({ pubSubServiceInterface: {} }));
jest.mock('../../utils/getActiveViewportEnabledElement', () => jest.fn());

import ToolGroupService from './ToolGroupService';

const WHEEL = 524288;
const PINCH = { numTouchPoints: 2 };
const STORAGE_KEY = 'user-preferred-tool-bindings';

// basic mode's default group; `zoomOnWheel` mirrors applyWheelPreferences.
function enterMode(service, { zoomOnWheel = false } = {}) {
  service.addToolsToToolGroup('default', {
    active: [
      { toolName: 'WindowLevel', bindings: [{ mouseButton: 1 }] },
      { toolName: 'Pan', bindings: [{ mouseButton: 4 }] },
      {
        toolName: 'Zoom',
        bindings: zoomOnWheel ? [PINCH, { mouseButton: WHEEL }] : [{ mouseButton: 2 }, PINCH],
      },
      {
        toolName: 'StackScroll',
        bindings: zoomOnWheel
          ? [{ numTouchPoints: 3 }, { mouseButton: 2 }]
          : [{ mouseButton: WHEEL }, { numTouchPoints: 3 }],
      },
    ],
    passive: [{ toolName: 'Length' }],
  } as any);
}

const live = toolName => mockToolGroup.options[toolName].bindings;

beforeEach(() => {
  localStorage.clear();
  mockToolGroup.options = {};
});

it('keeps the mode-entry wheel binding when persisted button bindings load', () => {
  // What the prefs modal persisted for Zoom before: right click + pinch, no wheel.
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ default: { Zoom: [{ mouseButton: 2 }, PINCH] } })
  );
  enterMode(new ToolGroupService({ services: {} } as any), { zoomOnWheel: true });

  expect(live('Zoom')).toEqual([{ mouseButton: 2 }, PINCH, { mouseButton: WHEEL }]);
  // the saved right-click Zoom wins over mode-entry right-drag StackScroll
  expect(live('StackScroll')).toEqual([{ numTouchPoints: 3 }]);
});

it("converts 3.10's saved buttons once (right = Pan, middle = Zoom)", () => {
  localStorage.setItem(
    'defaultToolBindings',
    JSON.stringify([
      { id: 'leftMouseButton', commandOptions: { toolName: 'WindowLevel' } },
      { id: 'rightMouseButton', commandOptions: { toolName: 'Pan' } },
      { id: 'middleMouseButton', commandOptions: { toolName: 'Zoom' } },
      { id: 'scrollWheel', commandOptions: { toolName: 'StackScroll' } },
    ])
  );
  enterMode(new ToolGroupService({ services: {} } as any));

  expect(live('WindowLevel')).toEqual([{ mouseButton: 1 }]);
  expect(live('Pan')).toEqual([{ mouseButton: 2 }]);
  expect(live('Zoom')).toEqual([PINCH, { mouseButton: 4 }]);
  expect(live('StackScroll')).toEqual([{ numTouchPoints: 3 }, { mouseButton: WHEEL }]);
  expect(localStorage.getItem('defaultToolBindings-migrated')).toBe('true');
  // legacy key kept in case of a rollback to 3.10
  expect(localStorage.getItem('defaultToolBindings')).not.toBeNull();
});

it("activates 3.10's Length-on-a-button", () => {
  localStorage.setItem(
    'defaultToolBindings',
    JSON.stringify([{ id: 'rightMouseButton', commandOptions: { toolName: 'Length' } }])
  );
  enterMode(new ToolGroupService({ services: {} } as any));

  expect(mockToolGroup.options.Length).toEqual({ mode: 'Active', bindings: [{ mouseButton: 2 }] });
  expect(live('Zoom')).toEqual([PINCH, { mouseButton: 4 }]);
});

it('takes the old button off a tool left without one on save', () => {
  const service = new ToolGroupService({ services: {} } as any);
  enterMode(service);

  // left = Zoom, middle = Pan, right = Zoom: Window Level gets no button
  service.assignMouseButtons('default', {
    WindowLevel: [],
    Pan: [4],
    Zoom: [1, 2],
    StackScroll: [],
    Length: [],
  });

  expect(live('WindowLevel')).toEqual([]);
  expect(live('Zoom')).toEqual([PINCH, { mouseButton: 1 }, { mouseButton: 2 }]);
  expect(JSON.parse(localStorage.getItem(STORAGE_KEY)).default.WindowLevel).toEqual([]);
});
