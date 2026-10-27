/**
 * @jest-environment jsdom
 */
import fs from 'fs';
import path from 'path';
import importCanarySettings, { applyCanarySettings } from './importCanarySettings';
import { CANARY_SETTING_KEYS } from './canarySettingKeys';

jest.mock('@ohif/core', () => ({ HotkeysManager: { prototype: { generateHash: () => 'h' } } }), {
  virtual: true,
});
jest.mock('@ohif/core/src/utils/hotkeys/migrateHotkeys', () => jest.fn(), { virtual: true });

const memoryStorage = (initial = {}) => {
  const data = { ...initial };
  return {
    data,
    getItem: k => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = String(v);
    },
  };
};

describe('applyCanarySettings', () => {
  it('runs the 3.10 hotkey migration first, then layers canary hotkeys on top', () => {
    const storage = memoryStorage();
    const migrate = jest.fn(() => {
      // 3.10 migration result: two custom shortcuts from the old origin
      storage.setItem('user-preferred-keys', JSON.stringify({ a: ['x'], b: ['y'] }));
    });
    applyCanarySettings(storage, { 'user-preferred-keys': JSON.stringify({ b: ['z'] }) }, migrate);

    expect(migrate).toHaveBeenCalledTimes(1);
    // canary re-binding wins for b; 3.10-only a survives
    expect(JSON.parse(storage.data['user-preferred-keys'])).toEqual({ a: ['x'], b: ['z'] });
  });

  it('never imports migration markers (canary set them against an empty store)', () => {
    const storage = memoryStorage();
    const written = applyCanarySettings(
      storage,
      { 'hotkeys-migrated': 'true', 'defaultToolBindings-migrated': 'true', zoomSpeed: '0.2' },
      () => {}
    );
    expect(written).toEqual(['zoomSpeed']);
    expect(storage.data['hotkeys-migrated']).toBeUndefined();
    expect(storage.data['defaultToolBindings-migrated']).toBeUndefined();
  });

  it('copies allowlisted preferences verbatim and ignores everything else', () => {
    const storage = memoryStorage({ scrollWheelTool: 'StackScroll' });
    applyCanarySettings(
      storage,
      {
        scrollWheelTool: 'Zoom',
        'user-preferred-tool-bindings': '{"default":{}}',
        'ohif_viewport_state_1-2': '{}',
        windowData: '{}',
      },
      () => {}
    );
    expect(storage.data.scrollWheelTool).toBe('Zoom');
    expect(storage.data['user-preferred-tool-bindings']).toBe('{"default":{}}');
    expect(storage.data['ohif_viewport_state_1-2']).toBeUndefined();
    expect(storage.data.windowData).toBeUndefined();
  });
});

describe('importCanarySettings', () => {
  it('does nothing on VEG / Ethos hosts (same origin across the flip)', async () => {
    const storage = memoryStorage();
    for (const host of ['veg-view.prod-1.radimal.ai', 'ethos-view.radimal.ai']) {
      await expect(importCanarySettings({ location: { host }, storage })).resolves.toEqual([]);
    }
    expect(storage.data).toEqual({});
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('imports from the canary origin once, then never again', async () => {
    const storage = memoryStorage();
    const pending = importCanarySettings({ location: { host: 'view.radimal.ai' }, storage });
    expect(document.querySelector('iframe').src).toBe(
      'https://view-blue.prod-1.radimal.ai/settings-export.html'
    );

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://view-blue.prod-1.radimal.ai',
        data: { type: 'radimal-settings-export', settings: { zoomSpeed: '0.3' } },
      })
    );
    await expect(pending).resolves.toEqual(['zoomSpeed']);
    expect(storage.data.zoomSpeed).toBe('0.3');
    expect(document.querySelector('iframe')).toBeNull();

    await expect(
      importCanarySettings({ location: { host: 'view.radimal.ai' }, storage })
    ).resolves.toEqual([]);
  });

  it('ignores messages from any other origin', async () => {
    const storage = memoryStorage();
    const pending = importCanarySettings({
      location: { host: 'view.radimal.ai' },
      storage,
      timeoutMs: 20,
    });
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://evil.example',
        data: { type: 'radimal-settings-export', settings: { zoomSpeed: '9' } },
      })
    );
    await expect(pending).resolves.toEqual([]);
    expect(storage.data.zoomSpeed).toBeUndefined();
  });

  it('gives up after 3 silent attempts so a destroyed canary never delays startup', async () => {
    const storage = memoryStorage();
    const opts = { location: { host: 'view.radimal.ai' }, storage, timeoutMs: 5 };
    await importCanarySettings(opts);
    await importCanarySettings(opts);
    expect(JSON.parse(storage.data.canarySettingsImport).done).toBe(false);
    await importCanarySettings(opts);
    expect(JSON.parse(storage.data.canarySettingsImport).done).toBe(true);
  });
});

describe('settings-export.html', () => {
  it('exports exactly the keys the importer accepts', () => {
    const html = fs.readFileSync(path.join(__dirname, '../../public/settings-export.html'), 'utf8');
    const block = html.match(/var KEYS = \[([\s\S]*?)\];/)[1];
    const keys = [...block.matchAll(/'([^']+)'/g)].map(m => m[1]);
    expect(keys).toEqual(CANARY_SETTING_KEYS);
  });
});
