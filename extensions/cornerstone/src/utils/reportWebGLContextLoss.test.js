jest.mock('@cornerstonejs/core', () => ({
  eventTarget: { addEventListener: jest.fn() },
  Enums: { Events: { WEBGL_CONTEXT_LOST: 'CORNERSTONE_WEBGL_CONTEXT_LOST' } },
  getRenderingEngine: () => ({ getViewports: () => [1, 2, 3, 4] }),
}));

import { onWebGLContextLost } from './reportWebGLContextLoss';

describe('onWebGLContextLost', () => {
  it('reports what was open, at most 5 times per page', () => {
    const capture = jest.fn();
    window.__captureSentryMessage = capture;
    window.name = 'viewerWindow-1';
    localStorage.setItem(
      'windowData',
      JSON.stringify([
        { id: 'viewerWindow' },
        { id: 'viewerWindow-1' },
        { id: 'viewerWindow-2', closed: true },
      ])
    );
    const evt = {
      detail: { renderingEngineId: 'OHIFCornerstoneRenderingEngine', contextIndex: 2 },
    };

    for (let i = 0; i < 7; i++) {
      onWebGLContextLost(evt);
    }

    expect(capture).toHaveBeenCalledTimes(5);
    expect(capture).toHaveBeenLastCalledWith(
      'WebGL context lost',
      expect.objectContaining({
        renderingEngineId: 'OHIFCornerstoneRenderingEngine',
        contextIndex: 2,
        viewports: 4,
        lossesThisPage: 5,
        windowName: 'viewerWindow-1',
        openViewerWindows: 2,
      })
    );
  });
});
