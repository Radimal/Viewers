import { getRenderingEngines } from '@cornerstonejs/core';
import { annotation } from '@cornerstonejs/tools';

// Radimal: one color for measurements (line + label) in every state:
// resting, hovered and selected (cs3d's default green for the last two is
// what readers asked to escape). The active measurement still shows its
// handles, so it stays identifiable. Readers who never picked one get
// Radimal pink, the same default as the report's Regions of Interest.
const KEY = 'annotationColor';
export const DEFAULT_ANNOTATION_COLOR = '#fe01a1';

// The cs3d 5.6.8 ToolStyle color keys, all set to the one color.
const COLOR_KEYS = [
  'color',
  'colorHighlighted',
  'colorSelected',
  'textBoxColor',
  'textBoxColorHighlighted',
  'textBoxColorSelected',
  'colorLocked',
  'textBoxColorLocked',
];

/** The reader's color, or null when they never picked one. */
export function getAnnotationColor(): string | null {
  try {
    const saved = localStorage.getItem(KEY);
    return /^#[0-9a-f]{6}$/i.test(saved) ? saved : null;
  } catch (e) {
    return null;
  }
}

const allStates = (hex: string) => Object.fromEntries(COLOR_KEYS.map(key => [key, hex]));

function setColors(colors: Record<string, string>): void {
  const { global } = annotation.config.style.getDefaultToolStyles();
  annotation.config.style.setDefaultToolStyles({ global: { ...global, ...colors } });
  getRenderingEngines()?.forEach(engine => engine.render());
}

/** Apply the saved color, or the default when there is none. */
export function applyAnnotationColor(): void {
  setColors(allStates(getAnnotationColor() ?? DEFAULT_ANNOTATION_COLOR));
}

/**
 * Multi-monitor: each window has its own cs3d, and the storage event fires
 * in the other windows when one saves, so they follow without a reload.
 */
export function followAnnotationColor(): void {
  window.addEventListener('storage', event => {
    if (event.key === KEY || event.key === null) {
      applyAnnotationColor();
    }
  });
}

/** Save the reader's pick (null = back to the default) and apply it now. */
export function saveAnnotationColor(hex: string | null): void {
  try {
    if (hex) {
      localStorage.setItem(KEY, hex);
    } else {
      localStorage.removeItem(KEY);
    }
  } catch (e) {
    /* storage unavailable: still apply for this session */
  }
  setColors(allStates(hex ?? DEFAULT_ANNOTATION_COLOR));
}
