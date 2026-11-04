import HangingProtocolService from './HangingProtocolService';

const testProtocol = {
  id: 'test',
  name: 'Default',
  protocolMatchingRules: [
    {
      attribute: 'StudyDescription',
      constraint: {
        contains: 'PETCT',
      },
    },
  ],
  displaySetSelectors: {
    displaySetSelector: {
      seriesMatchingRules: [
        {
          weight: 1,
          attribute: 'Modality',
          constraint: {
            equals: 'CT',
          },
          required: true,
        },
        {
          weight: 1,
          attribute: 'numImageFrames',
          constraint: {
            greaterThan: 10,
          },
        },
      ],
      studyMatchingRules: [],
    },
  },
  stages: [
    {
      name: 'default',
      viewportStructure: {
        layoutType: 'grid',
        properties: {
          rows: 1,
          columns: 1,
        },
      },
      viewports: [
        {
          viewportOptions: {
            viewportId: 'ctAXIAL',
            viewportType: 'volume',
            orientation: 'axial',
            toolGroupId: 'ctToolGroup',
            customViewportOptions: {
              initialScale: 2.5,
            },
            initialImageOptions: {
              // index: 5,
              preset: 'first', // 'first', 'last', 'middle'
            },
            syncGroups: [
              {
                type: 'cameraPosition',
                id: 'axialSync',
                source: true,
                target: true,
              },
            ],
          },
          displaySets: [
            {
              id: 'displaySetSelector',
            },
          ],
        },
      ],
    },
  ],
  numberOfPriorsReferenced: -1,
};

function testProtocolGenerator({ servicesManager }) {
  servicesManager.services.TestService.toCall();

  return {
    protocol: testProtocol,
  };
}

const studyMatch = {
  StudyInstanceUID: 'studyMatch',
  StudyDescription: 'A PETCT study type',
};

const displaySet1 = {
  ...studyMatch,
  SeriesInstanceUID: 'ds1',
  displaySetInstanceUID: 'displaySet1',
  numImageFrames: 11,
  Modality: 'CT',
};

const displaySet2 = {
  ...displaySet1,
  SeriesInstanceUID: 'ds2',
  displaySetInstanceUID: 'displaySet2',
  Modality: 'PT',
};

const displaySet3 = {
  ...displaySet1,
  numImageFrames: 3,
  displaySetInstanceUID: 'displaySet3',
};

const studyMatchDisplaySets = [displaySet3, displaySet2, displaySet1];

function checkHpsBestMatch(hps) {
  hps.run({ studies: [studyMatch], displaySets: studyMatchDisplaySets });
  const { viewportMatchDetails } = hps.getMatchDetails();
  expect(viewportMatchDetails.size).toBe(1);
  expect(viewportMatchDetails.get('ctAXIAL')).toMatchObject({
    viewportOptions: {
      viewportId: 'ctAXIAL',
      viewportType: 'volume',
      orientation: 'axial',
      toolGroupId: 'ctToolGroup',
    },
    // Matches ds1 because it matches 2 rules, a required and an optional
    // ds2 fails to match required and ds3 fails to match an optional.
    displaySetsInfo: [
      {
        displaySetInstanceUID: 'displaySet1',
        displaySetOptions: {
          id: 'displaySetSelector',
          options: {},
        },
      },
    ],
  });
}

describe('HangingProtocolService', () => {
  const mockedFunction = jest.fn();
  const commandsManager = {
    run: mockedFunction,
  };
  const servicesManager = {
    services: {
      TestService: {
        toCall: mockedFunction,
      },
    },
  };
  const hangingProtocolService = new HangingProtocolService(commandsManager, servicesManager);
  let initialScaling;

  afterEach(() => {
    mockedFunction.mockClear();
  });

  describe('with a static protocol', () => {
    beforeAll(() => {
      hangingProtocolService.addProtocol(testProtocol.id, testProtocol);
    });

    it('has one protocol', () => {
      expect(hangingProtocolService.getProtocols().length).toBe(1);
    });

    describe('run', () => {
      it('matches best image match', () => {
        checkHpsBestMatch(hangingProtocolService);
      });
    });
  });

  describe('with protocol generator', () => {
    beforeAll(() => {
      hangingProtocolService.addProtocol(testProtocol.id, testProtocolGenerator);
    });

    it('has one protocol', () => {
      expect(hangingProtocolService.getProtocols().length).toBe(1);
    });

    describe('run', () => {
      it('matches best image match', () => {
        checkHpsBestMatch(hangingProtocolService);
      });
    });
  });
});

// Radimal: run() without a protocol id (matching among the active protocols,
// as when a mode lists several) must forward its options. A viewport with
// matchedDisplaySetsIndex -1 used to throw destructuring null options.
describe('HangingProtocolService run by matching', () => {
  it('applies a matched protocol whose viewport uses matchedDisplaySetsIndex -1', () => {
    const hps = new HangingProtocolService({ run: jest.fn() }, { services: {} });
    const [stage] = testProtocol.stages;
    const [viewport] = stage.viewports;
    hps.addProtocol('test', {
      ...testProtocol,
      stages: [
        {
          ...stage,
          viewports: [
            {
              ...viewport,
              displaySets: [{ id: 'displaySetSelector', matchedDisplaySetsIndex: -1 }],
            },
          ],
        },
      ],
    });
    hps.setActiveProtocolIds(['test']);
    expect(() =>
      hps.run({ studies: [studyMatch], displaySets: studyMatchDisplaySets })
    ).not.toThrow();
    expect(hps.getActiveProtocol().protocol.id).toBe('test');
    expect(
      hps.getMatchDetails().viewportMatchDetails.get('ctAXIAL').displaySetsInfo[0]
        .displaySetInstanceUID
    ).toBe('displaySet1');
  });
});

// Mode.tsx always passes { stageIndex: 0 } for a protocol list; matching must
// still auto-pick the first enabled stage (e.g. mnGrid 2x2 -> 3x1 -> 2x1).
describe('HangingProtocolService run by matching picks the enabled stage', () => {
  it('ignores a stageIndex passed with a protocol list', () => {
    const hps = new HangingProtocolService({ run: jest.fn() }, { services: {} });
    const [stage] = testProtocol.stages;
    hps.addProtocol('test', {
      ...testProtocol,
      stages: [
        { ...stage, id: 'needs99', stageActivation: { enabled: { minViewportsMatched: 99 } } },
        { ...stage, id: 'fits' },
      ],
    });
    hps.setActiveProtocolIds(['test']);
    hps.run({ studies: [studyMatch], displaySets: studyMatchDisplaySets }, undefined, {
      stageIndex: 0,
    });
    expect(hps.getActiveProtocol().stageIndex).toBe(1);
  });
});
