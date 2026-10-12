const combo = keys => (Array.isArray(keys) ? keys.join('+') : keys || '').toLowerCase();

const FREE_KEY_POOL = 'abcdefghijklmnopqrstuvwxyz0123456789'.split('');

/**
 * Radimal: a reader's own shortcut wins its key. Any default-keyed command it
 * displaces moves to Shift+<its old key>, else the first free letter/digit,
 * and the move is saved to user-preferred-keys so it happens (and is
 * announced) once. Mutates `definitions`; returns what moved.
 */
function resolveHotkeyClashes(definitions, userPreferredKeys, generateHash) {
  const isCustom = def => Boolean(userPreferredKeys[generateHash(def)]);
  const used = new Set(definitions.map(def => combo(def.keys)).filter(Boolean));
  const customCombos = new Set(definitions.filter(isCustom).map(def => combo(def.keys)));
  const moved = [];

  definitions.forEach(def => {
    const from = combo(def.keys);
    if (!from || isCustom(def) || !customCombos.has(from)) {
      return;
    }
    const candidates = from.includes('+') ? FREE_KEY_POOL : [`shift+${from}`, ...FREE_KEY_POOL];
    const to = candidates.find(key => !used.has(key));
    if (!to) {
      return;
    }
    used.add(to);
    def.keys = [to];
    userPreferredKeys[generateHash(def)] = [to];
    moved.push({ label: def.label, from, to });
  });

  return moved;
}

export default resolveHotkeyClashes;
