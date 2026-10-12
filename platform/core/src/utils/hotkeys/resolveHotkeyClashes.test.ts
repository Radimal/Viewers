import objectHash from 'object-hash';
import resolveHotkeyClashes from './resolveHotkeyClashes';

const hash = ({ commandName, commandOptions = {} }) => objectHash({ commandName, commandOptions });
const def = (commandName, keys, label = commandName) => ({ commandName, keys, label });

it("keeps the reader's key and moves the displaced default to Shift+key", () => {
  const zoom = def('zoom', ['b']);
  const brush = def('brush', ['b'], 'Brush');
  const prefs = { [hash(zoom)]: ['b'] };

  const moved = resolveHotkeyClashes([zoom, brush], prefs, hash);

  expect(zoom.keys).toEqual(['b']);
  expect(brush.keys).toEqual(['shift+b']);
  expect(prefs[hash(brush)]).toEqual(['shift+b']);
  expect(moved).toEqual([{ label: 'Brush', from: 'b', to: 'shift+b' }]);
});

it('falls back to the first free key when Shift+key is taken too', () => {
  const zoom = def('zoom', 'ctrl+z');
  const undo = def('undo', ['ctrl+z']);
  const a = def('a', ['a']);
  const prefs = { [hash(zoom)]: 'ctrl+z' };

  resolveHotkeyClashes([zoom, undo, a], prefs, hash);

  expect(undo.keys).toEqual(['b']);
});

it('changes nothing without a clash, and is stable on the next load', () => {
  const zoom = def('zoom', ['b']);
  const brush = def('brush', ['b']);
  const prefs = { [hash(zoom)]: ['b'] };
  resolveHotkeyClashes([zoom, brush], prefs, hash);

  const reloaded = [def('zoom', prefs[hash(zoom)]), def('brush', prefs[hash(brush)])];
  expect(resolveHotkeyClashes(reloaded, prefs, hash)).toEqual([]);
});
