/**
 * Radimal wheel preferences, persisted in localStorage by the user
 * preferences UI (same keys as the 3.10 fork, so existing user settings
 * carry over):
 * - scrollWheelTool: 'StackScroll' (default) or 'Zoom' — which tool the
 *   mouse wheel drives. cs3d 5's ZoomTool implements mouseWheelCallback,
 *   so this is a plain binding swap (the fork's document-level
 *   directWheelZoom handler is obsolete).
 * - invertScrollWheel: 'true' to reverse slice-scroll direction. Like 3.10,
 *   it only applies while the wheel drives StackScroll; wheel zoom is never
 *   inverted.
 *
 * 3.10 parity: with the wheel on Zoom, Zoom's right-drag moves to StackScroll
 * so slices stay scrollable by mouse. Saved button choices load afterwards
 * and override this.
 */

const SCROLL_WHEEL_TOOL_KEY = 'scrollWheelTool';
const INVERT_SCROLL_WHEEL_KEY = 'invertScrollWheel';

const WHEEL_TOOLS = ['StackScroll', 'Zoom'];
const RIGHT_BUTTON = 2; // cs3d MouseBindings.Secondary (stable across majors)

export function getScrollWheelTool() {
  try {
    const tool = localStorage.getItem(SCROLL_WHEEL_TOOL_KEY);
    return WHEEL_TOOLS.includes(tool) ? tool : 'StackScroll';
  } catch (e) {
    return 'StackScroll';
  }
}

export function getScrollWheelInversion() {
  try {
    return localStorage.getItem(INVERT_SCROLL_WHEEL_KEY) === 'true';
  } catch (e) {
    return false;
  }
}

/**
 * Rewrites a tool group's `active` tool list in place so the wheel drives
 * the user-preferred tool with the preferred direction. No-op when the
 * preference is the default StackScroll with no inversion.
 *
 * @param activeTools the tool group's `active` array
 * @param wheelButton the cs3d wheel binding value — pass
 *   `Enums.MouseBindings.Wheel` from the calling mode (core does not
 *   depend on @cornerstonejs/tools, and the enum's value has changed
 *   across cs3d majors).
 */
export function applyWheelPreferences(activeTools, wheelButton) {
  if (!Array.isArray(activeTools) || wheelButton == null) {
    return activeTools;
  }

  const isWheelBinding = binding => binding?.mouseButton === wheelButton;
  const isRightDrag = binding =>
    binding?.mouseButton === RIGHT_BUTTON && binding.modifierKey == null;

  const wheelTool = getScrollWheelTool();
  const invert = getScrollWheelInversion();

  const stackScroll = activeTools.find(t => t.toolName === 'StackScroll');
  const zoom = activeTools.find(t => t.toolName === 'Zoom');

  if (wheelTool === 'Zoom' && stackScroll && zoom) {
    const wheelBindings = (stackScroll.bindings || []).filter(isWheelBinding);
    if (wheelBindings.length) {
      stackScroll.bindings = stackScroll.bindings.filter(b => !isWheelBinding(b));
      zoom.bindings = [...(zoom.bindings || []), ...wheelBindings];
    }

    const rightDrag = (zoom.bindings || []).filter(isRightDrag);
    if (rightDrag.length) {
      zoom.bindings = zoom.bindings.filter(b => !isRightDrag(b));
      stackScroll.bindings = [...(stackScroll.bindings || []), ...rightDrag];
    }
  }

  if (invert && wheelTool === 'StackScroll' && stackScroll) {
    stackScroll.configuration = { ...(stackScroll.configuration || {}), invert: true };
  }

  return activeTools;
}
