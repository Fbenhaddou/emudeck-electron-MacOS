import type { BrowserWindow } from 'electron';

/** Must match --toolbar-height in the renderer stylesheet. */
const toolbarHeight = 52;
const trafficLightHeight = 14;
export const zoomSteps = [1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;

/**
 * Text zoom scales the web toolbar but not the native traffic lights, so every
 * zoom change goes through here to keep them centered on the toolbar.
 */
export function setWindowZoom(window: BrowserWindow, factor: number): number {
  const zoom = Math.min(3, Math.max(1, Number.isFinite(factor) ? factor : 1));
  window.webContents.setZoomFactor(zoom);
  window.setWindowButtonPosition({
    x: 20,
    y: Math.round((toolbarHeight * zoom - trafficLightHeight) / 2),
  });
  return zoom;
}

export function stepZoom(window: BrowserWindow, direction: 1 | -1): number {
  const current = window.webContents.getZoomFactor();
  const index = zoomSteps.findIndex((step) => step >= current - 0.001);
  const position = index < 0 ? zoomSteps.length - 1 : index;
  const exact = Math.abs(zoomSteps[position] - current) < 0.001;
  const next =
    direction > 0
      ? zoomSteps[
          Math.min(zoomSteps.length - 1, exact ? position + 1 : position)
        ]
      : zoomSteps[Math.max(0, position - 1)];
  return setWindowZoom(window, next);
}
