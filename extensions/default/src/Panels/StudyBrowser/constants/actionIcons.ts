import type { actionIcon } from '../types/actionsIcon';

const defaultActionIcons = [
  {
    id: 'settings',
    iconName: 'Settings',
    // Radimal: sort + tab controls always visible (no gear toggle).
    value: true,
  },
] as actionIcon[];

export { defaultActionIcons };
