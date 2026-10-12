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

/**
 * 3.10's W/L presets: 1-5 apply fixed window/level on any modality. 3.13's
 * setWindowLevelPreset is modality-keyed (no-op on DX/CR/US/MR) and drops
 * Liver, shifting CT numbering. Same commandOptions as 3.10 so migrated
 * custom keys still match.
 */
const windowLevelPresetBindings = [1, 2, 3, 4, 5].map(n => ({
  commandName: 'setWindowLevel',
  commandOptions: defaults.windowLevelPresets[n],
  label: `W/L Preset ${n}`,
  keys: [String(n)],
}));

export default {
  'ohif.hotkeyBindings': [
    ...defaults.hotkeyBindings.filter(({ commandName }) => commandName !== 'setWindowLevelPreset'),
    ...radimalHotkeyBindings,
    ...windowLevelPresetBindings,
  ],
};
