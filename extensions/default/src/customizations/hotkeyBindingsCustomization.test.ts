import customization from './hotkeyBindingsCustomization';

const bindings = customization['ohif.hotkeyBindings'];
const combo = keys => (Array.isArray(keys) ? keys.join('+') : keys);

it('binds every key once', () => {
  const combos = bindings.map(b => combo(b.keys)).filter(Boolean);
  expect(combos.length).toBe(new Set(combos).size);
});

it('1-5 apply 3.10 window/level presets on any modality', () => {
  const presets = bindings.filter(b => b.commandName === 'setWindowLevel');
  expect(presets.map(b => combo(b.keys))).toEqual(['1', '2', '3', '4', '5']);
  expect(presets[2].commandOptions).toMatchObject({
    description: 'Liver',
    window: '150',
    level: '90',
  });
  expect(bindings.some(b => b.commandName === 'setWindowLevelPreset')).toBe(false);
});
