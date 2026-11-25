import {
  getPixelsPerMeter,
  resolveInitialCameraTransform,
  screenToWorld,
  worldToScreen,
  type Viewport
} from '@physforge/sim-sdk';

export { getPixelsPerMeter, resolveInitialCameraTransform, screenToWorld, worldToScreen };

export interface CameraTransform {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

export const MIN_ZOOM_SCALE = 0.1;
export const MAX_ZOOM_SCALE = 20.0;

export function clampZoomScale(scale: number, minimum=MIN_ZOOM_SCALE): number {
  if (!Number.isFinite(scale)) return 1;
  const lower=Number.isFinite(minimum)?Math.max(.0001,Math.min(MIN_ZOOM_SCALE,minimum)):MIN_ZOOM_SCALE;
  return Math.max(lower, Math.min(MAX_ZOOM_SCALE, scale));
}

export function getViewportAnchor(width: number, height: number): { cx: number; cy: number } {
  return { cx: width * 0.45, cy: height * 0.5 };
}

/**
 * 以鼠标指针所在屏幕坐标 (cursorX, cursorY) 为锚点进行无级缩放 (0.1x ~ 20x)
 */
export function zoomViewportAtCursor(
  prev: CameraTransform,
  cursorX: number,
  cursorY: number,
  width: number,
  height: number,
  zoomFactor: number,
  minimum=MIN_ZOOM_SCALE
): CameraTransform {
  const nextScale = clampZoomScale(prev.scale * zoomFactor,minimum);
  if (Math.abs(nextScale - prev.scale) < 1e-9) return prev;
  const { cx, cy } = getViewportAnchor(width, height);
  const ratio = nextScale / prev.scale;
  const dx = cursorX - cx;
  const dy = cursorY - cy;
  return {
    scale: nextScale,
    offsetX: dx - (dx - prev.offsetX) * ratio,
    offsetY: dy - (dy - prev.offsetY) * ratio
  };
}

export function panViewport(
  prev: CameraTransform,
  deltaX: number,
  deltaY: number
): CameraTransform {
  return {
    scale: prev.scale,
    offsetX: prev.offsetX + deltaX,
    offsetY: prev.offsetY + deltaY
  };
}

export const DEFAULT_CAMERA_TRANSFORM: CameraTransform = {
  scale: 1,
  offsetX: 0,
  offsetY: 0
};
