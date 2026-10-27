import { HotkeysManager } from '@ohif/core';
import migrateOldHotkeyDefinitions from '@ohif/core/src/utils/hotkeys/migrateHotkeys';
import { CANARY_SETTING_KEYS } from './canarySettingKeys';

/**
 * Viewer host -> the 3.13 canary origin its readers may have used (radimal-vet
 * routes flagged readers there: viewer-313-canary / viewer-313-canary-veg). At
 * cutover those readers carry their newer preferences from the canary
 * (localStorage is per-origin). Everyone else on the host keeps their own 3.10
 * settings, which 3.13 reads directly — same origin. Remove an entry once its
 * canary deployment is destroyed. Ethos had no canary.
 */
const CANARY_SOURCE_BY_HOST = {
  'view.radimal.ai': 'https://view-blue.prod-1.radimal.ai',
  'veg-view.prod-1.radimal.ai': 'https://veg-viewer-blue.prod-1.radimal.ai',
};

const STATE_KEY = 'canarySettingsImport';
// Written by every 3.13 viewer on every load, so a canary can say when the
// reader last used it (exported by public/settings-export.html).
export const LAST_USED_KEY = 'viewerLastUsedAt';
// 3.10 stores a timestamped default rotation/flip entry the first time each
// image is shown, so the newest one is when the reader last read here on 3.10.
const LEGACY_VIEWPORT_STATE_PREFIX = 'ohif_viewport_state_';
const MAX_ATTEMPTS = 3;
const MESSAGE_TYPE = 'radimal-settings-export';

// Migration markers never cross origins: the canary origin set them against an
// empty 3.10 store, so importing them would make this origin skip migrating the
// reader's real 3.10 hotkeys / mouse buttons.
const NEVER_IMPORT = new Set(['hotkeys-migrated', 'defaultToolBindings-migrated']);

const readJson = (storage, key) => {
  try {
    return JSON.parse(storage.getItem(key)) || {};
  } catch (e) {
    return {};
  }
};

export function stampViewerLastUsed(storage = window.localStorage, now = Date.now()) {
  try {
    storage.setItem(LAST_USED_KEY, String(now));
  } catch (e) {
    // storage unavailable
  }
}

/** Newest 3.10 activity on this origin (ms), 0 when there is none. */
export function lastLegacyActivity(storage) {
  let latest = 0;
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key || !key.startsWith(LEGACY_VIEWPORT_STATE_PREFIX)) {
        continue;
      }
      const timestamp = Number(JSON.parse(storage.getItem(key))?.timestamp);
      if (timestamp > latest) {
        latest = timestamp;
      }
    }
  } catch (e) {
    // unreadable entry: ignore
  }
  return latest;
}

/**
 * The reader's newer settings win, wholesale: import the canary's only if
 * they used the canary more recently than this origin's 3.10. A canary with no
 * last-used stamp predates the stamp (or was never used) and loses, so readers
 * who left the canary keep their 3.10 settings.
 */
export function canaryIsNewer(canaryLastUsedAt, legacyLastActivity) {
  const canary = Number(canaryLastUsedAt);
  return canary > 0 && canary > legacyLastActivity;
}

/**
 * Writes the canary origin's preferences into this origin, canary winning.
 * Hotkeys merge per command on top of this origin's migrated 3.10 shortcuts,
 * so a command the reader re-bound on the canary keeps the canary binding and
 * 3.10 customizations the canary never saw survive. Mouse buttons need no
 * merge: 3.13 skips the 3.10 button migration once 3.13 bindings exist, and
 * the canary only has them if the reader changed buttons there.
 *
 * @returns {string[]} keys written
 */
export function applyCanarySettings(storage, settings, migrateLegacyHotkeys) {
  const written = [];
  if (!settings || typeof settings !== 'object') {
    return written;
  }

  migrateLegacyHotkeys();

  for (const key of CANARY_SETTING_KEYS) {
    const value = settings[key];
    if (typeof value !== 'string' || NEVER_IMPORT.has(key)) {
      continue;
    }
    if (key === 'user-preferred-keys') {
      let canaryKeys;
      try {
        canaryKeys = JSON.parse(value);
      } catch (e) {
        continue;
      }
      if (!canaryKeys || typeof canaryKeys !== 'object') {
        continue;
      }
      storage.setItem(key, JSON.stringify({ ...readJson(storage, key), ...canaryKeys }));
    } else {
      storage.setItem(key, value);
    }
    written.push(key);
  }
  return written;
}

/**
 * One-time, before the app renders (so before 3.13's own migrations run):
 * reads the reader's canary preferences through a hidden same-site iframe.
 * Resolves quickly when there is nothing to do. A canary that does not answer
 * is retried on the next few loads, then given up on, so a destroyed canary
 * never delays startup indefinitely.
 */
export default function importCanarySettings({
  location = window.location,
  storage = window.localStorage,
  timeoutMs = 2500,
} = {}) {
  const source = CANARY_SOURCE_BY_HOST[location.host];
  if (!source) {
    return Promise.resolve([]);
  }

  let state;
  try {
    state = readJson(storage, STATE_KEY);
  } catch (e) {
    return Promise.resolve([]);
  }
  if (state.done) {
    return Promise.resolve([]);
  }

  return new Promise(resolve => {
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.setAttribute('aria-hidden', 'true');

    let timer;
    const finish = (written, done) => {
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      iframe.remove();
      const attempts = (state.attempts || 0) + 1;
      try {
        storage.setItem(
          STATE_KEY,
          JSON.stringify({
            done: done || attempts >= MAX_ATTEMPTS,
            attempts,
            imported: written,
            at: new Date().toISOString(),
          })
        );
      } catch (e) {
        // storage unavailable: nothing to persist
      }
      resolve(written);
    };

    const onMessage = event => {
      if (event.origin !== source || event.data?.type !== MESSAGE_TYPE) {
        return;
      }
      let written = [];
      try {
        if (canaryIsNewer(event.data.lastUsedAt, lastLegacyActivity(storage))) {
          written = applyCanarySettings(storage, event.data.settings, () =>
            migrateOldHotkeyDefinitions({ generateHash: HotkeysManager.prototype.generateHash })
          );
        } else {
          console.info('Keeping this viewer\'s settings: used more recently than the preview viewer');
        }
      } catch (e) {
        console.warn('Canary settings import failed', e);
      }
      if (written.length) {
        console.info('Imported viewer settings from the preview viewer:', written);
      }
      finish(written, true);
    };

    window.addEventListener('message', onMessage);
    timer = setTimeout(() => finish([], false), timeoutMs);
    iframe.src = `${source}/settings-export.html`;
    document.body.appendChild(iframe);
  });
}
