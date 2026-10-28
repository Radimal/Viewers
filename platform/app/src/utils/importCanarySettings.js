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
const MAX_ATTEMPTS = 3;
const MESSAGE_TYPE = 'radimal-settings-export';
// Fragment param the export page returns settings in after a top-level hop.
const RETURN_PARAM = 'radimal-settings';

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

/**
 * Writes the canary origin's preferences into this origin, canary winning —
 * always, not by recency: canary readers have been alternating on purpose
 * (the main flag sends 28 excluded VEG-site orgs' cases to 3.10), so "last
 * used" would discard 3.13 preferences they chose. Product decision 2026-10-27.
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
 * Settings handed back by a top-level hop through the canary's export page
 * (Safari/WebKit, whose same-site iframes get empty partitioned storage). The
 * fragment is stripped from the address bar either way; it is only trusted when
 * it echoes the nonce this origin stored before hopping, so a crafted link
 * cannot plant settings.
 */
function takeReturnedSettings(location, state) {
  const params = new URLSearchParams((location.hash || '').slice(1));
  if (!params.has(RETURN_PARAM)) {
    return null;
  }
  try {
    window.history.replaceState(null, '', location.pathname + location.search);
  } catch (e) {
    // cosmetic only
  }
  if (!state.nonce || params.get('nonce') !== state.nonce) {
    return null;
  }
  try {
    return JSON.parse(params.get(RETURN_PARAM));
  } catch (e) {
    return null;
  }
}

const migrateLegacyHotkeys = () =>
  migrateOldHotkeyDefinitions({ generateHash: HotkeysManager.prototype.generateHash });

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

  const saveState = next => {
    try {
      storage.setItem(STATE_KEY, JSON.stringify(next));
    } catch (e) {
      // storage unavailable: nothing to persist
    }
  };

  const returned = takeReturnedSettings(location, state);
  if (returned) {
    let written = [];
    try {
      written = applyCanarySettings(storage, returned, migrateLegacyHotkeys);
    } catch (e) {
      console.warn('Canary settings import failed', e);
    }
    saveState({
      done: true,
      attempts: state.attempts || 0,
      imported: written,
      at: new Date().toISOString(),
    });
    return Promise.resolve(written);
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
      saveState({
        done: done || attempts >= MAX_ATTEMPTS,
        attempts,
        imported: written,
        at: new Date().toISOString(),
      });
      resolve(written);
    };

    // The iframe only sees partitioned (empty) storage: hop top-level through
    // the export page once, which returns here with the settings in the
    // fragment. The promise stays pending; the page is navigating away.
    const hop = () => {
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      iframe.remove();
      const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), b =>
        b.toString(16).padStart(2, '0')
      ).join('');
      saveState({ ...state, attempts: (state.attempts || 0) + 1, nonce });
      location.replace(
        `${source}/settings-export.html?return=${encodeURIComponent(location.href)}&nonce=${nonce}`
      );
    };

    const onMessage = event => {
      if (event.origin !== source || event.data?.type !== MESSAGE_TYPE) {
        return;
      }
      if (event.data.partitioned) {
        // Hop at most once; a hop that came back empty-handed is final.
        if (state.nonce) {
          finish([], true);
        } else {
          hop();
        }
        return;
      }
      let written = [];
      try {
        written = applyCanarySettings(storage, event.data.settings, migrateLegacyHotkeys);
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
    // Unique URL: the page has no cache headers and the canary's service worker
    // precaches it, so a fixed URL can serve a stale copy (seen 2026-10-28:
    // Safari kept a pre-#26 page without the partitioned flag, so no hop).
    iframe.src = `${source}/settings-export.html?t=${Date.now()}`;
    document.body.appendChild(iframe);
  });
}
