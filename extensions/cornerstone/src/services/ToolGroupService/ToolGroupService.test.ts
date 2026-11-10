// Minimal stand-in for a cs3d ToolGroup: setToolActive merges bindings,
// setToolPassive strips the listed ones, setToolDisabled clears them.
// `tools` limits hasTool to the group's real tool list (addTool extends it).
const mockMakeToolGroup = (id, tools?: string[]) => ({
  id,
  tools: tools && new Set(tools),
  options: {} as Record<string, { mode: string; bindings: any[] }>,
  hasTool(toolName) {
    return !this.tools || this.tools.has(toolName);
  },
  addTool(toolName) {
    this.tools?.add(toolName);
  },
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
});
const mockToolGroup = mockMakeToolGroup('default');
const mockGroups: Record<string, ReturnType<typeof mockMakeToolGroup>> = { default: mockToolGroup };

jest.mock('@cornerstonejs/tools', () => ({
  ToolGroupManager: { getToolGroup: id => mockGroups[id] },
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
// SR and MPR groups use the same WL/Pan/Zoom-on-L/M/R layout.
function enterMode(
  service,
  { zoomOnWheel = false, toolGroupId = 'default', passive = [{ toolName: 'Length' }] } = {}
) {
  service.addToolsToToolGroup(toolGroupId, {
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
    passive,
  } as any);
}

const live = toolName => mockToolGroup.options[toolName].bindings;

beforeEach(() => {
  localStorage.clear();
  mockToolGroup.options = {};
  Object.keys(mockGroups)
    .filter(id => id !== 'default')
    .forEach(id => delete mockGroups[id]);
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

it("activates 3.10's Length on the LEFT button and takes it off Window Level", () => {
  localStorage.setItem(
    'defaultToolBindings',
    JSON.stringify([
      { id: 'leftMouseButton', commandOptions: { toolName: 'Length' } },
      { id: 'rightMouseButton', commandOptions: { toolName: 'Pan' } },
      { id: 'middleMouseButton', commandOptions: { toolName: 'Zoom' } },
    ])
  );
  enterMode(new ToolGroupService({ services: {} } as any));

  expect(mockToolGroup.options.Length).toEqual({ mode: 'Active', bindings: [{ mouseButton: 1 }] });
  expect(live('WindowLevel')).toEqual([]);
});

it('a 3.13 visit before any 3.10 choices exist does not block converting them later', () => {
  enterMode(new ToolGroupService({ services: {} } as any));
  expect(localStorage.getItem('defaultToolBindings-migrated')).toBeNull();

  mockToolGroup.options = {};
  localStorage.setItem(
    'defaultToolBindings',
    JSON.stringify([{ id: 'leftMouseButton', commandOptions: { toolName: 'Length' } }])
  );
  enterMode(new ToolGroupService({ services: {} } as any));
  expect(mockToolGroup.options.Length).toEqual({ mode: 'Active', bindings: [{ mouseButton: 1 }] });
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

// 3.10 parity: button choices saved on 'default' also drive SR and MPR.
describe('SR and MPR follow the saved mouse buttons', () => {
  const saved = { WindowLevel: [{ mouseButton: 2 }], Zoom: [{ mouseButton: 1 }, PINCH] };
  const liveIn = (id, toolName) => mockGroups[id].options[toolName].bindings;

  it.each(['SRToolGroup', 'mpr'])('%s reads the choices saved on default when it loads', id => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ default: saved }));
    mockGroups[id] = mockMakeToolGroup(id);
    enterMode(new ToolGroupService({ services: {} } as any), { toolGroupId: id });

    expect(liveIn(id, 'WindowLevel')).toEqual([{ mouseButton: 2 }]);
    expect(liveIn(id, 'Zoom')).toHaveLength(2);
    expect(liveIn(id, 'Zoom')).toEqual(expect.arrayContaining([PINCH, { mouseButton: 1 }]));
  });

  it('volume3d keeps its own buttons', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ default: saved }));
    mockGroups.volume3d = mockMakeToolGroup('volume3d');
    enterMode(new ToolGroupService({ services: {} } as any), { toolGroupId: 'volume3d' });

    expect(liveIn('volume3d', 'WindowLevel')).toEqual([{ mouseButton: 1 }]);
  });

  it('an open SR group follows a save live, without a saved copy of its own', () => {
    const service = new ToolGroupService({ services: {} } as any);
    enterMode(service);
    mockGroups.SRToolGroup = mockMakeToolGroup('SRToolGroup');
    enterMode(service, { toolGroupId: 'SRToolGroup' });

    service.assignMouseButtons('default', {
      WindowLevel: [2],
      Pan: [4],
      Zoom: [1],
      StackScroll: [],
      Length: [],
    });

    expect(liveIn('SRToolGroup', 'WindowLevel')).toEqual([{ mouseButton: 2 }]);
    expect(liveIn('SRToolGroup', 'Zoom')).toEqual([PINCH, { mouseButton: 1 }]);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)).SRToolGroup).toBeUndefined();
  });

  // Real tool lists: basic mode's mpr and SRToolGroup have no PlanarRotate,
  // and SR measures with SRLength, not Length.
  const MPR_TOOLS = ['WindowLevel', 'Pan', 'Zoom', 'StackScroll', 'Crosshairs'];
  const SR_TOOLS = ['WindowLevel', 'Pan', 'Zoom', 'StackScroll', 'SRLength'];
  const buttonOwners = (id, button) =>
    Object.entries(mockGroups[id].options)
      .filter(([, o]) => o.mode === 'Active' && o.bindings.some(b => b.mouseButton === button))
      .map(([toolName]) => toolName);

  it('mpr gets a saved Free Rotate on the left button even though it lacks the tool', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ default: { WindowLevel: [], PlanarRotate: [{ mouseButton: 1 }] } })
    );
    mockGroups.mpr = mockMakeToolGroup('mpr', MPR_TOOLS);
    enterMode(new ToolGroupService({ services: {} } as any), { toolGroupId: 'mpr', passive: [] });

    expect(buttonOwners('mpr', 1)).toEqual(['PlanarRotate']);
  });

  it('SR gets a saved Length on the left button even though it only has SRLength', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ default: { WindowLevel: [], Length: [{ mouseButton: 1 }] } })
    );
    mockGroups.SRToolGroup = mockMakeToolGroup('SRToolGroup', SR_TOOLS);
    enterMode(new ToolGroupService({ services: {} } as any), {
      toolGroupId: 'SRToolGroup',
      passive: [],
    });

    expect(buttonOwners('SRToolGroup', 1)).toEqual(['Length']);
  });

  it('an open SR group follows a live save of a tool it lacks', () => {
    const service = new ToolGroupService({ services: {} } as any);
    enterMode(service);
    mockGroups.SRToolGroup = mockMakeToolGroup('SRToolGroup', SR_TOOLS);
    enterMode(service, { toolGroupId: 'SRToolGroup', passive: [] });

    service.assignMouseButtons('default', {
      WindowLevel: [],
      Pan: [4],
      Zoom: [2],
      StackScroll: [],
      Length: [],
      PlanarRotate: [1],
    });

    expect(buttonOwners('SRToolGroup', 1)).toEqual(['PlanarRotate']);
  });
});
