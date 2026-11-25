// Fake vtk render windows: each owns a canvas we can fire 'webglcontextlost' on.
jest.mock('@cornerstonejs/core/RenderingEngine/vtkClasses/index.js', () => ({
  vtkOffscreenMultiRenderWindow: {
    newInstance: () => {
      const canvas = new EventTarget();
      return { setContainer: () => {}, getOpenGLRenderWindow: () => ({ getCanvas: () => canvas }) };
    },
  },
}));

const mockEngine = { viewports: [] };
jest.mock('@cornerstonejs/core', () => ({
  eventTarget: { addEventListener: jest.fn() },
  Enums: { Events: { WEBGL_CONTEXT_LOST: 'CORNERSTONE_WEBGL_CONTEXT_LOST' } },
  getRenderingEngine: () => ({
    contextPool: mockEngine.contextPool,
    getViewports: () => mockEngine.viewports,
  }),
}));

import WebGLContextPool from '@cornerstonejs/core/RenderingEngine/WebGLContextPool.js';
import { onWebGLContextLost, useWebGLRecoveryKey } from './recoverFromWebGLContextLoss';
import { renderHook, act } from '@testing-library/react';

const loseContext = (pool, index) =>
  pool.getContextByIndex(index).context.getOpenGLRenderWindow().getCanvas()
    .dispatchEvent(new Event('webglcontextlost'));

describe('WebGL context loss recovery', () => {
  it('patched pool skips lost contexts and never invents one', () => {
    const pool = new WebGLContextPool(3);
    expect(pool.getLiveContextIndex(0)).toBe(0);
    loseContext(pool, 0);
    expect(pool.getLiveContextIndex(0)).toBe(1);
    loseContext(pool, 2);
    expect(pool.getLiveContextIndex(2)).toBe(1);
    loseContext(pool, 1);
    expect(pool.getLiveContextIndex(2)).toBe(2);
  });

  it('remounts only the viewports drawn on the lost context', () => {
    const pool = new WebGLContextPool(2);
    pool.assignViewportToContext('mpr', 0);
    pool.assignViewportToContext('stack', 1);
    mockEngine.contextPool = pool;
    mockEngine.viewports = [{ id: 'mpr' }, { id: 'stack' }];

    const mpr = renderHook(() => useWebGLRecoveryKey('mpr'));
    const stack = renderHook(() => useWebGLRecoveryKey('stack'));
    act(() => onWebGLContextLost({ detail: { renderingEngineId: 'e', contextIndex: 0 } }));

    expect(mpr.result.current).toBe(1);
    expect(stack.result.current).toBe(0);
  });
});
