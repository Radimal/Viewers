// Regression tests for patches/@cornerstonejs__tools@5.6.8.patch. If a cornerstone upgrade
// drops the patch, these fail. Madison's report: measurements stop showing while right-click
// still finds them.
const mockToolGroup = { _toolInstances: {} };
const mockAnnotations = [];

jest.mock('@cornerstonejs/core', () => ({
  getEnabledElement: el =>
    el ? { viewport: { element: el }, renderingEngineId: 're', viewportId: 'vp' } : undefined,
  getRenderingEngine: () => ({}),
  triggerEvent: jest.fn(),
}));
jest.mock('@cornerstonejs/tools/store/ToolGroupManager/index.js', () => ({
  getToolGroupForViewport: () => mockToolGroup,
}));
jest.mock('@cornerstonejs/tools/stateManagement/annotation/annotationState.js', () => ({
  getAnnotations: () => mockAnnotations,
}));
jest.mock('@cornerstonejs/tools/stateManagement/annotation/annotationVisibility.js', () => ({
  isAnnotationVisible: uid => uid !== 'hidden',
}));

import { getAnnotationNearPoint } from '@cornerstonejs/tools/utilities/getAnnotationNearPoint.js';
import { annotationRenderingEngine } from '@cornerstonejs/tools/stateManagement/annotation/AnnotationRenderingEngine.js';

describe('right-click finds only what is drawn', () => {
  const element = {};
  const tool = (mode, shown = a => a) => ({
    constructor: { toolName: 'Length' },
    mode,
    isPointNearTool: () => true,
    getHandleNearImagePoint: () => false,
    filterInteractableAnnotationsForElement: (_el, annotations) => annotations.filter(shown),
  });
  const setAnnotations = (...uids) => {
    mockAnnotations.length = 0;
    uids.forEach(annotationUID => mockAnnotations.push({ annotationUID }));
  };

  it('finds a visible measurement from an active tool', () => {
    setAnnotations('a');
    mockToolGroup._toolInstances = { Length: tool('Active') };
    expect(getAnnotationNearPoint(element, [0, 0])?.annotationUID).toBe('a');
  });

  it('skips a measurement hidden with the eye icon, finding the visible one under it', () => {
    setAnnotations('hidden', 'b');
    mockToolGroup._toolInstances = { Length: tool('Passive') };
    expect(getAnnotationNearPoint(element, [0, 0])?.annotationUID).toBe('b');
  });

  it('skips a measurement drawing filters out (e.g. another MPR slice)', () => {
    setAnnotations('other-slice');
    mockToolGroup._toolInstances = { Length: tool('Active', () => false) };
    expect(getAnnotationNearPoint(element, [0, 0])).toBeNull();
  });

  it('skips tools that are Disabled, since they are not drawn', () => {
    setAnnotations('a');
    mockToolGroup._toolInstances = { Length: tool('Disabled') };
    expect(getAnnotationNearPoint(element, [0, 0])).toBeNull();
  });
});

describe('one drawing error does not stop all measurement drawing', () => {
  beforeEach(() => {
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => {
      cb();
      return 1;
    });
  });
  afterEach(() => jest.restoreAllMocks());

  it('keeps drawing other viewports after one throws', () => {
    const bad = { id: 'bad' };
    const good = { id: 'good' };
    annotationRenderingEngine.addViewportElement('bad', bad);
    annotationRenderingEngine.addViewportElement('good', good);
    const drawn = [];
    annotationRenderingEngine._triggerRender = el => {
      if (el === bad) {
        throw new Error('renderAnnotation failed');
      }
      drawn.push(el.id);
    };

    expect(() => annotationRenderingEngine.renderViewport(bad)).toThrow('renderAnnotation failed');
    expect(annotationRenderingEngine._animationFrameSet).toBe(false);

    annotationRenderingEngine.renderViewport(good);
    expect(drawn).toEqual(['good']);
  });
});
