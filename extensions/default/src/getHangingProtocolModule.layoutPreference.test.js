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

// Per-modality defaults ("Set 2x2 as Default for X-ray"): one default-<group>
// protocol per saved group, matched on the study's main modality group.
describe('per-modality default layouts', () => {
  const loadWith = byModality => {
    localStorage.clear();
    if (byModality !== undefined) {
      localStorage.setItem('userLayoutPreferenceByModality', JSON.stringify(byModality));
    }
    let loaded;
    jest.isolateModules(() => {
      loaded = {
        protocols: require('./getHangingProtocolModule').default(),
        ...require('./utils/layoutPreference'),
      };
    });
    return loaded;
  };

  const ds = (Modality, SeriesInstanceUID, StudyInstanceUID = 'study') => ({
    Modality,
    SeriesInstanceUID,
    StudyInstanceUID,
  });

  it('keeps the plain default when nothing is saved', () => {
    const { protocols, getDefaultProtocolIds } = loadWith(undefined);
    expect(getDefaultProtocolIds()).toBe('default');
    expect(protocols.filter(p => p.name.startsWith('default-'))).toEqual([]);
  });

  it('builds a default-<group> protocol per saved group', () => {
    const { protocols, getDefaultProtocolIds } = loadWith({
      XRAY: { rows: 2, columns: 2 },
      CT: { rows: 1, columns: 2 },
    });
    expect(getDefaultProtocolIds()).toEqual(['default-XRAY', 'default-CT', 'default']);
    const xray = protocols.find(p => p.name === 'default-XRAY').protocol;
    expect(xray.stages[0].viewportStructure.properties).toEqual({ rows: 2, columns: 2 });
    expect(xray.stages[0].viewports).toHaveLength(4);
    expect(xray.protocolMatchingRules[0]).toMatchObject({
      attribute: 'LayoutModalityGroup',
      constraint: { equals: { value: 'XRAY' } },
      required: true,
    });
  });

  it('skips malformed saved entries instead of failing at startup', () => {
    const { getDefaultProtocolIds } = loadWith({ XRAY: null, CT: 5, US: { rows: 1, columns: 2 } });
    expect(getDefaultProtocolIds()).toEqual(['default-US', 'default']);
  });

  it('groups CR and DX, picks the group with most series, ignores SR and priors', () => {
    const { studyLayoutGroup } = loadWith(undefined);
    const study = { StudyInstanceUID: 'study' };
    expect(studyLayoutGroup(study, [ds('CR', 'a'), ds('DX', 'b'), ds('US', 'c')])).toBe('XRAY');
    expect(
      studyLayoutGroup(study, [
        ds('US', 'a'),
        ds('US', 'b'),
        ds('DX', 'c'),
        ds('SR', 'd'),
        ds('SR', 'e'),
        ds('SR', 'f'),
      ])
    ).toBe('US');
    // DX display sets are one per image: count series, not display sets
    expect(
      studyLayoutGroup(study, [
        ds('DX', 'a'),
        ds('DX', 'a'),
        ds('DX', 'a'),
        ds('US', 'b'),
        ds('US', 'c'),
      ])
    ).toBe('US');
    expect(studyLayoutGroup(study, [ds('CT', 'p', 'prior'), ds('MR', 'x')])).toBe('MR');
    expect(studyLayoutGroup(study, [ds('SR', 'x')])).toBeUndefined();
  });

  it('the protocol engine opens X-ray studies in the X-ray layout and others in the default', () => {
    const { protocols, studyLayoutGroup, LAYOUT_GROUP_ATTRIBUTE } = loadWith({
      XRAY: { rows: 2, columns: 2 },
    });
    const ProtocolEngine =
      require('@ohif/core/src/services/HangingProtocolService/ProtocolEngine').default;
    const active = protocols
      .filter(p => ['default-XRAY', 'default'].includes(p.name))
      .map(p => p.protocol);
    const callbacks = {
      [LAYOUT_GROUP_ATTRIBUTE]: {
        callback: (study, options) => studyLayoutGroup(study, options?.displaySets),
      },
    };
    const pick = displaySets => {
      const study = { StudyInstanceUID: 'study' };
      return new ProtocolEngine(active, callbacks).run({
        studies: [study],
        activeStudy: study,
        displaySets,
      }).id;
    };
    expect(pick([ds('DX', 'a'), ds('CR', 'b')])).toBe('default-XRAY');
    expect(pick([ds('US', 'a')])).toBe('default');
  });
});
