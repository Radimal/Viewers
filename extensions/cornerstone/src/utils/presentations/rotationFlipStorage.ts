/**
 * Cross-reload persistence for user rotation/flip, keyed by study+series.
 *
 * The in-session presentation stores (usePositionPresentationStore) carry
 * rotation/flip across layout changes and display-set swaps, but they are
 * memory-only and cleared on mode exit. Radiologists expect a series they
 * rotated/flipped to come back that way after a reload, so the last
 * rotation/flip state per series is mirrored into localStorage.
 *
 * The value shape matches the 3.10 fork's ViewportPersistenceService
 * (`{ rotationFlip, timestamp }`). 3.10 keyed it per instance
 * (`ohif_viewport_state_<study>-<series>-<instance>`), so a series with no
 * 3.13 entry falls back to its newest 3.10 entry.
 */

const KEY_PREFIX = 'ohif_viewport_state_';

export type RotationFlipState = {
  rotation?: number;
  flipHorizontal?: boolean;
  flipVertical?: boolean;
};

type PersistableDisplaySet = {
  StudyInstanceUID?: string;
  SeriesInstanceUID?: string;
};

function storageKey(displaySets: PersistableDisplaySet[]): string | null {
  const { StudyInstanceUID, SeriesInstanceUID } = displaySets?.[0] ?? {};
  if (!StudyInstanceUID || !SeriesInstanceUID) {
    return null;
  }
  return `${KEY_PREFIX}${StudyInstanceUID}-${SeriesInstanceUID}`;
}

function isDefault({ rotation, flipHorizontal, flipVertical }: RotationFlipState): boolean {
  return !rotation && !flipHorizontal && !flipVertical;
}

/**
 * Persist the series' rotation/flip. Default state removes the entry, which
 * also makes `resetViewport` self-cleaning: after a reset, the next save
 * sees default state and drops the key.
 */
export function saveRotationFlip(
  displaySets: PersistableDisplaySet[],
  viewPresentation: RotationFlipState | undefined
): void {
  const key = storageKey(displaySets);
  if (!key || !viewPresentation) {
    return;
  }

  try {
    const { rotation, flipHorizontal, flipVertical } = viewPresentation;
    if (isDefault({ rotation, flipHorizontal, flipVertical })) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(
      key,
      JSON.stringify({
        rotationFlip: { rotation, flipHorizontal, flipVertical },
        timestamp: Date.now(),
      })
    );
  } catch (e) {
    console.warn('rotationFlipStorage: save failed', e);
  }
}

export function loadRotationFlip(displaySets: PersistableDisplaySet[]): RotationFlipState | null {
  const key = storageKey(displaySets);
  if (!key) {
    return null;
  }

  try {
    const raw = localStorage.getItem(key) ?? newestLegacyEntry(key);
    if (!raw) {
      return null;
    }
    const rotationFlip = JSON.parse(raw)?.rotationFlip;
    if (!rotationFlip || isDefault(rotationFlip)) {
      return null;
    }
    return rotationFlip;
  } catch (e) {
    console.warn('rotationFlipStorage: load failed', e);
    return null;
  }
}

/**
 * Moves the newest 3.10 per-instance entry (`<key>-<instance>`) for this series
 * under the 3.13 key and drops the rest, so a later reset (which removes the
 * 3.13 key) can't resurrect the 3.10 state.
 */
function newestLegacyEntry(key: string): string | null {
  let newest: string | null = null;
  let newestAt = -1;
  for (const legacyKey of Object.keys(localStorage)) {
    if (!legacyKey.startsWith(`${key}-`)) {
      continue;
    }
    const raw = localStorage.getItem(legacyKey);
    localStorage.removeItem(legacyKey);
    const at = Number(JSON.parse(raw)?.timestamp) || 0;
    if (at > newestAt) {
      newest = raw;
      newestAt = at;
    }
  }
  if (newest) {
    localStorage.setItem(key, newest);
  }
  return newest;
}
