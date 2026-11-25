import { useSyncExternalStore } from 'react';
import { eventTarget, Enums, getRenderingEngine } from '@cornerstonejs/core';

// When the browser takes a WebGL context away (see reportWebGLContextLoss), every viewport drawn
// on it goes white or freezes until F5. This remounts those viewports. Our core patch marks the
// context lost, so the remount lands on a live context in the pool, and remounting keeps the
// slice, zoom, window/level and rotation, as a layout change does. No new context is created,
// so a recovery can't push Chrome past its context limit and cost another window a context.

const generations = new Map<string, number>();
const listeners = new Set<() => void>();

type ContextPool = { getContextIndexForViewport(viewportId: string): number | undefined };

export function onWebGLContextLost(evt: CustomEvent): void {
  const { renderingEngineId, contextIndex } = evt.detail || {};
  const renderingEngine = getRenderingEngine(renderingEngineId);
  const contextPool = (renderingEngine as unknown as { contextPool?: ContextPool })?.contextPool;
  if (!contextPool) {
    return;
  }
  const lostViewportIds = renderingEngine
    .getViewports()
    .map(viewport => viewport.id)
    .filter(viewportId => contextPool.getContextIndexForViewport(viewportId) === contextIndex);
  if (!lostViewportIds.length) {
    return;
  }
  lostViewportIds.forEach(viewportId =>
    generations.set(viewportId, (generations.get(viewportId) ?? 0) + 1)
  );
  listeners.forEach(listener => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Changes each time this viewport's context is lost; use it as the viewport's React key. */
export function useWebGLRecoveryKey(viewportId: string): number {
  return useSyncExternalStore(subscribe, () => generations.get(viewportId) ?? 0);
}

export default function recoverFromWebGLContextLoss(): void {
  eventTarget.addEventListener(Enums.Events.WEBGL_CONTEXT_LOST, onWebGLContextLost);
}
