// VEG cutover guarantee: 3.13 on veg-view reads 3.10's saved "Set NxM as
// Default" (same origin, same localStorage key and JSON shape) and opens every
// study in that grid. The default protocol is built at module load.
describe('default hanging protocol honors 3.10 userLayoutPreference', () => {
  const stageFor = saved => {
    localStorage.clear();
    if (saved !== undefined) {
      localStorage.setItem('userLayoutPreference', saved);
    }
    let stage;
    jest.isolateModules(() => {
      const getHangingProtocolModule = require('./getHangingProtocolModule').default;
      const def = getHangingProtocolModule().find(p => p.name === 'default');
      stage = def.protocol.stages[0];
    });
    return stage;
  };

  it('uses a 3.10-saved 2x2 default', () => {
    // exactly what 3.10's saveUserLayoutPreference wrote
    const stage = stageFor(JSON.stringify({ rows: 2, columns: 2, name: '2x2' }));
    expect(stage.viewportStructure.properties).toEqual({ rows: 2, columns: 2 });
    expect(stage.viewports).toHaveLength(4);
    expect(stage.viewports.map(v => v.displaySets[0].matchedDisplaySetsIndex)).toEqual([
      -1, 1, 2, 3,
    ]);
  });

  it('falls back to 1x1 with no or corrupt preference', () => {
    expect(stageFor(undefined).viewportStructure.properties).toEqual({ rows: 1, columns: 1 });
    expect(stageFor('{not json').viewportStructure.properties).toEqual({ rows: 1, columns: 1 });
  });
});
