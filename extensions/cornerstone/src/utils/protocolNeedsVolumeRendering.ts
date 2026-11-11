// Radimal: CPU rendering (the fallback for GPUs that can't draw 16-bit
// images, e.g. smart TVs) only supports stack viewports; a hanging protocol
// with volume (MPR) or volume3d viewports throws there.
const VOLUME_VIEWPORT_TYPES = ['volume', 'volume3d', 'orthographic'];

export function protocolNeedsVolumeRendering(hp?: AppTypes.HangingProtocol.Protocol): boolean {
  return (hp?.stages ?? []).some(stage =>
    (stage.viewports ?? []).some(viewport =>
      VOLUME_VIEWPORT_TYPES.includes(viewport.viewportOptions?.viewportType)
    )
  );
}
