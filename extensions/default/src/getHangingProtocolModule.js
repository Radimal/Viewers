import { hpMN, hpMN8 } from './hangingprotocols/hpMNGrid';
import hpMNCompare from './hangingprotocols/hpCompare';
import hpMammography from './hangingprotocols/hpMammo';
import hpScale from './hangingprotocols/hpScale';
import {
  getUserLayoutPreference,
  getLayoutPreferenceByModality,
  layoutGroupLabel,
  LAYOUT_GROUP_ATTRIBUTE,
} from './utils/layoutPreference';

// Radimal: "Set NxM as Default" (layout selector) persists a preferred grid,
// for all studies and per modality group; the default protocols' stages are
// built from it so every study opens in the user's layout. Evaluated at module
// load — saving the preference reloads the page.

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
        ...(i === 0 && {
          initialImageOptions: {
            custom: 'sopInstanceLocation',
          },
        }),
        syncGroups: [
          {
            type: 'hydrateseg',
            id: 'sameFORId',
            source: true,
            target: true,
          },
        ],
      },
      displaySets: [
        {
          id: 'defaultDisplaySetId',
          // First viewport takes the best match; the rest take the next
          // matches so an NxM default opens showing N*M different series.
          matchedDisplaySetsIndex: i === 0 ? -1 : i,
        },
      ],
    });
  }
  return viewports;
};

const stageFor = ({ rows, columns, name }) => ({
  name,
  viewportStructure: {
    layoutType: 'grid',
    properties: { rows, columns },
  },
  viewports: createUserPreferredViewports(rows, columns),
  createdDate: '2021-02-23T18:32:42.850Z',
});

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
          weight: 20,
          constraint: {
            equals: true,
          },
        },
      ],
    },
  },
  stages: [stageFor(getUserLayoutPreference())],
};

// One protocol per modality group with a saved default; the mode runs these
// ahead of 'default' (getDefaultProtocolIds), and a study matches the one for
// its main modality group. No match falls back to 'default'.
const modalityProtocols = Object.entries(getLayoutPreferenceByModality()).map(
  ([group, layout]) => ({
    ...defaultProtocol,
    id: `default-${group}`,
    name: `Default (${layoutGroupLabel(group)})`,
    protocolMatchingRules: [
      {
        attribute: LAYOUT_GROUP_ATTRIBUTE,
        constraint: { equals: { value: group } },
        required: true,
        weight: 10,
      },
    ],
    stages: [stageFor(layout)],
  })
);

function getHangingProtocolModule() {
  return [
    {
      name: defaultProtocol.id,
      protocol: defaultProtocol,
    },
    ...modalityProtocols.map(protocol => ({ name: protocol.id, protocol })),
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
      name: hpMN.id,
      protocol: hpMN,
    },
    {
      name: hpMN8.id,
      protocol: hpMN8,
    },
  ];
}

export default getHangingProtocolModule;
