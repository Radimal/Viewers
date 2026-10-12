import migrateOldHotkeyDefinitions from './migrateHotkeys';

const generateHash = ({ commandName }) => commandName;
const legacy = [{ commandName: 'radimalOnlyCommand', keys: ['e'] }];

beforeEach(() => localStorage.clear());

it("keeps 3.10's key for rollback and never re-migrates over 3.13 edits", () => {
  localStorage.setItem('hotkey-definitions', JSON.stringify(legacy));

  migrateOldHotkeyDefinitions({ generateHash });
  expect(JSON.parse(localStorage.getItem('user-preferred-keys'))).toEqual({
    radimalOnlyCommand: ['e'],
  });
  expect(localStorage.getItem('hotkey-definitions')).not.toBeNull();

  // reader re-binds it in 3.13; a later load must not restore the 3.10 key
  localStorage.setItem('user-preferred-keys', JSON.stringify({ radimalOnlyCommand: ['x'] }));
  migrateOldHotkeyDefinitions({ generateHash });
  expect(JSON.parse(localStorage.getItem('user-preferred-keys'))).toEqual({
    radimalOnlyCommand: ['x'],
  });
});
