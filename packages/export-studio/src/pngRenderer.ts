import type { DiagramIR } from '@physforge/sim-sdk';
import { renderDiagramToSvg } from './svgRenderer.js';

/**
 * 将黑白矢量 SVG 光栅化为指定倍率的离线高清 PNG Blob（2x / 4x / 6x ≈ 600 DPI）
 */
export async function renderDiagramToPngBlob(
  ir: DiagramIR,
  scaleFactor: 2 | 4 | 6 = 4
): Promise<Blob> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    throw new Error('renderDiagramToPngBlob requires a browser DOM environment.');
  }

  const svgString = renderDiagramToSvg(ir, { monochrome: true });
  const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Failed to load SVG into Image for PNG rasterization.'));
      el.src = url;
    });

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(ir.width * scaleFactor);
    canvas.height = Math.round(ir.height * scaleFactor);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to acquire 2D canvas context.');
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('canvas.toBlob returned null.'));
      }, 'image/png');
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function copyDiagramPngToClipboard(
  ir: DiagramIR,
  scaleFactor: 2 | 4 | 6 = 4
): Promise<boolean> {
  const pngBlob = await renderDiagramToPngBlob(ir, scaleFactor);
  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof ClipboardItem !== 'undefined') {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
    return true;
  }
  return false;
}
