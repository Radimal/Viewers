import { getRenderingEngines } from '@cornerstonejs/core';
import { annotation } from '@cornerstonejs/tools';

// Radimal: reader-chosen color for measurements (line + label), in every
// state: resting, hovered and selected (cs3d's default green for the last two
// is what readers asked to escape). The active measurement still shows its
// handles, so it stays identifiable. No saved color = cs3d's own
// yellow/green, untouched.
const KEY = 'annotationColor';
export const DEFAULT_ANNOTATION_COLOR = '#ffff00';

// cs3d 5.6.8 ToolStyle defaults, restored on "Reset to defaults".
const CS3D_COLORS = {
  color: 'rgb(255, 255, 0)',
  colorHighlighted: 'rgb(0, 255, 0)',
  colorSelected: 'rgb(0, 220, 0)',
  textBoxColor: 'rgb(255, 255, 0)',
  textBoxColorHighlighted: 'rgb(0, 255, 0)',
  textBoxColorSelected: 'rgb(0, 255, 0)',
};

/** The reader's color, or null when they never picked one. */
export function getAnnotationColor(): string | null {
  try {
    const saved = localStorage.getItem(KEY);
    return /^#[0-9a-f]{6}$/i.test(saved) ? saved : null;
  } catch (e) {
    return null;
  }
}

const allStates = (hex: string) =>
  Object.fromEntries(Object.keys(CS3D_COLORS).map(key => [key, hex]));

function setColors(colors: Record<string, string>): void {
  const { global } = annotation.config.style.getDefaultToolStyles();
  annotation.config.style.setDefaultToolStyles({ global: { ...global, ...colors } });
  getRenderingEngines()?.forEach(engine => engine.render());
}

/** Apply the saved color at startup; no-op for readers who never picked one. */
export function applyAnnotationColor(): void {
  const hex = getAnnotationColor();
  if (hex) {
    setColors(allStates(hex));
  }
}

/** Save the reader's pick (null = back to cs3d's defaults) and apply it now. */
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
  setColors(hex ? allStates(hex) : CS3D_COLORS);
}
