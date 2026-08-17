import { defaults } from '@ohif/core';

/**
 * Radimal hotkeys appended to the upstream defaults. Users' previously
 * customized keys migrate automatically: 3.13's HotkeysManager reads the
 * fork-era 'hotkey-definitions' localStorage key via migrateHotkeys.
 * Collision check done vs upstream defaults: w/p/m/o/q are unclaimed.
 */
const radimalHotkeyBindings = [
  {
    commandName: 'setToolActive',
    commandOptions: { toolName: 'WindowLevel' },
    label: 'Window/Level',
    keys: ['w'],
    isEditable: true,
  },
  {
    commandName: 'setToolActive',
    commandOptions: { toolName: 'Pan' },
    label: 'Pan',
    keys: ['p'],
    isEditable: true,
  },
  {
    commandName: 'setToolActive',
    commandOptions: { toolName: 'Length' },
    label: 'Length',
    keys: ['m'],
    isEditable: true,
  },
  {
    commandName: 'toggleOverlays',
    label: 'Toggle Overlays',
    keys: ['o'],
    isEditable: true,
  },
  {
    commandName: 'clearMeasurements',
    label: 'Delete All Measurements',
    keys: ['q'],
    isEditable: true,
  },
];

export default {
  'ohif.hotkeyBindings': [...defaults.hotkeyBindings, ...radimalHotkeyBindings],
};
