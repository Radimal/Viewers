import hpMNGrid from './hangingprotocols/hpMNGrid';
import hpMNCompare from './hangingprotocols/hpCompare';
import hpMammography from './hangingprotocols/hpMammo';
import hpScale from './hangingprotocols/hpScale';

const getUserLayoutPreference = () => {
  try {
    const saved = localStorage.getItem('userLayoutPreference');
    if (saved) {
      const parsed = JSON.parse(saved);
      return {
        rows: parsed.rows || 1,
        columns: parsed.columns || 1,
        name: parsed.name || '1x1'
      };
    }
  } catch (error) {
    console.warn('Failed to load user layout preference:', error);
  }
  
  return {
    rows: 1,
    columns: 1,
    name: '1x1'
  };
};

const createUserPreferredViewports = (rows, columns) => {
  const totalViewports = rows * columns;
  const viewports = [];

  for (let i = 0; i < totalViewports; i++) {
    viewports.push({
      viewportOptions: {
        viewportType: 'stack',
        viewportId: i === 0 ? 'default' : undefined,
        toolGroupId: 'default',
        allowUnmatchedView: true,
        // Add initialImageOptions for the first viewport
        ...(i === 0 && {
          initialImageOptions: {
            custom: 'sopInstanceLocation',
          }
        }),
        syncGroups: [
          {
            type: 'hydrateseg',
            id: 'sameFORId',
            source: true,
            target: true,
            // Include options for first viewport only
            ...(i === 0 && {
              options: {
                matchingRules: ['sameFOR'],
              }
            })
          },
        ],
      },
      displaySets: [
        {
          id: 'defaultDisplaySetId',
          matchedDisplaySetsIndex: i === 0 ? -1 : i,
        },
      ],
    });
  }

  return viewports;
};

const userPref = getUserLayoutPreference();

const defaultProtocol = {
  id: 'default',
  locked: true,
  // Don't store this hanging protocol as it applies to the currently active
  // display set by default
  // cacheId: null,
  name: 'Default',
  createdDate: '2021-02-23T19:22:08.894Z',
  modifiedDate: '2023-04-01',
  availableTo: {},
  editableBy: {},
  protocolMatchingRules: [],
  toolGroupIds: ['default'],
  // -1 would be used to indicate active only, whereas other values are
  // the number of required priors referenced - so 0 means active with
  // 0 or more priors.
  numberOfPriorsReferenced: 0,
  // Default viewport is used to define the viewport when
  // additional viewports are added using the layout tool
  defaultViewport: {
    viewportOptions: {
      viewportType: 'stack',
      toolGroupId: 'default',
      allowUnmatchedView: true,
      syncGroups: [
        {
          type: 'hydrateseg',
          id: 'sameFORId',
          source: true,
          target: true,
          options: {
            matchingRules: ['sameFOR'],
          },
        },
      ],
    },
    displaySets: [
      {
        id: 'defaultDisplaySetId',
        matchedDisplaySetsIndex: -1,
      },
    ],
  },
  displaySetSelectors: {
    defaultDisplaySetId: {
      // Matches displaysets, NOT series
      seriesMatchingRules: [
        // Try to match series with images by default, to prevent weird display
        // on SEG/SR containing studies
        {
          weight: 10,
          attribute: 'numImageFrames',
          constraint: {
            greaterThan: { value: 0 },
          },
        },
        // This display set will select the specified items by preference
        // It has no affect if nothing is specified in the URL.
        {
          attribute: 'isDisplaySetFromUrl',
          weight: 10,
          constraint: {
            equals: true,
          },
        },
      ],
    },
  },
  stages: [
    {
      name: userPref.name,
      viewportStructure: {
        layoutType: 'grid',
        properties: {
          rows: userPref.rows,
          columns: userPref.columns,
        },
      },
      viewports: createUserPreferredViewports(userPref.rows, userPref.columns),
      createdDate: '2021-02-23T18:32:42.850Z',
    },
  ],
};

function getHangingProtocolModule() {
  return [
    {
      name: defaultProtocol.id,
      protocol: defaultProtocol,
    },
    // Create a MxN comparison hanging protocol available by default
    {
      name: hpMNCompare.id,
      protocol: hpMNCompare,
    },
    {
      name: hpMammography.id,
      protocol: hpMammography,
    },
    {
      name: hpScale.id,
      protocol: hpScale,
    },
    // Create a MxN hanging protocol available by default
    {
      name: hpMNGrid.id,
      protocol: hpMNGrid,
    },
  ];
}

export default getHangingProtocolModule;
