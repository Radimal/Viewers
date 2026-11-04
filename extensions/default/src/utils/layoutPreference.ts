/**
 * Radimal: the reader's default grid ("Set NxM as Default"), for all studies
 * and per modality. Read once at startup — the default hanging protocols are
 * built from it — so saving reloads the page.
 */
type Layout = { rows: number; columns: number; name: string };

const ALL_STUDIES_KEY = 'userLayoutPreference';
const BY_MODALITY_KEY = 'userLayoutPreferenceByModality';

// CR and DX share one "X-ray" default; other modalities are their own group.
const MODALITY_GROUPS = { CR: 'XRAY', DX: 'XRAY' };
const GROUP_LABELS = { XRAY: 'X-ray' };
// Never decide a study's layout: no images of their own.
const NON_IMAGE_MODALITIES = ['SR', 'SEG', 'PR', 'KO', 'DOC', 'RTSTRUCT', 'RTPLAN', 'RTDOSE'];

export const LAYOUT_GROUP_ATTRIBUTE = 'LayoutModalityGroup';

const toLayout = ({ rows, columns }): Layout => ({
  rows: rows || 1,
  columns: columns || 1,
  name: `${rows || 1}x${columns || 1}`,
});

const read = key => {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch (error) {
    console.warn(`Failed to load ${key}:`, error);
    return null;
  }
};

const write = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.warn(`Failed to save ${key}:`, error);
    return false;
  }
};

export const layoutGroupFor = (modality: string) => MODALITY_GROUPS[modality] ?? modality;

export const isImageModality = (modality: string) => !NON_IMAGE_MODALITIES.includes(modality);

export const layoutGroupLabel = (group: string) => GROUP_LABELS[group] ?? group;

/** All-studies default. Same key and JSON shape as 3.10 (rollback, VEG). */
export function getUserLayoutPreference(): Layout {
  return toLayout(read(ALL_STUDIES_KEY) || {});
}

export const saveUserLayoutPreference = (rows: number, columns: number) =>
  write(ALL_STUDIES_KEY, toLayout({ rows, columns }));

/** Per-modality-group defaults, e.g. { XRAY: 2x2, CT: 1x2 }. */
export function getLayoutPreferenceByModality(): Record<string, Layout> {
  const saved = read(BY_MODALITY_KEY);
  if (!saved || typeof saved !== 'object') {
    return {};
  }
  // Skip hand-edited or badly imported entries rather than fail at startup.
  return Object.fromEntries(
    Object.entries(saved)
      .filter(([, layout]) => layout && typeof layout === 'object')
      .map(([group, layout]) => [group, toLayout(layout as Layout)])
  );
}

export const saveLayoutPreferenceForModality = (group: string, rows: number, columns: number) =>
  write(BY_MODALITY_KEY, {
    ...getLayoutPreferenceByModality(),
    [group]: toLayout({ rows, columns }),
  });

/** Protocol ids a mode should run: the per-modality protocols, then 'default'. */
export function getDefaultProtocolIds(): string | string[] {
  const groups = Object.keys(getLayoutPreferenceByModality());
  return groups.length ? [...groups.map(group => `default-${group}`), 'default'] : 'default';
}

/**
 * The study's layout group: the image modality group with the most series in
 * the study (first seen wins a tie). Used as a hanging-protocol attribute.
 */
export function studyLayoutGroup(
  study: { StudyInstanceUID?: string },
  displaySets: Array<{ StudyInstanceUID: string; SeriesInstanceUID: string; Modality: string }> = []
): string | undefined {
  const seriesByGroup = new Map<string, Set<string>>();
  for (const { StudyInstanceUID, SeriesInstanceUID, Modality } of displaySets) {
    if (StudyInstanceUID !== study?.StudyInstanceUID || !isImageModality(Modality)) {
      continue;
    }
    const group = layoutGroupFor(Modality);
    if (!seriesByGroup.has(group)) {
      seriesByGroup.set(group, new Set());
    }
    seriesByGroup.get(group).add(SeriesInstanceUID);
  }
  let best: string;
  for (const [group, series] of seriesByGroup) {
    if (!best || series.size > seriesByGroup.get(best).size) {
      best = group;
    }
  }
  return best;
}
