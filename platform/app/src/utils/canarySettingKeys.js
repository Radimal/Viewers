/**
 * Preference keys a reader's 3.13 viewer stores, carried from the canary
 * origin (view-blue) to view.radimal.ai at cutover. localStorage is
 * per-origin, so without this a canary reader would land on view.radimal.ai
 * with only their pre-canary 3.10 settings.
 *
 * Deliberately excluded: per-study rotation/flip state (ohif_viewport_state_*,
 * keyed by study UIDs), live window geometry (windowData), window-family
 * coordination, session flags, and shownTours (canary readers should see the
 * cutover intro again on view.radimal.ai — it tells them their settings came over).
 *
 * Keep in sync with public/settings-export.html, which cannot import modules.
 */
export const CANARY_SETTING_KEYS = [
  'user-preferred-keys',
  'hotkeys-migrated',
  'user-preferred-tool-bindings',
  'defaultToolBindings-migrated',
  'scrollWheelTool',
  'invertScrollWheel',
  'zoomSpeed',
  'zoomTowardCursor',
  'userLayoutPreference',
  'openAdditionalWindowsOnStart',
  'windowsArray',
  'pinnedToolbarTools',
  'ohif:theme',
  'ohif:custom-theme-css',
  'i18nextLng',
  'investigationalUseDialog',
];
