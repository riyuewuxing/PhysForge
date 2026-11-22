import React from 'react';
import type { ForceVectorItem, Viewport } from '@physforge/sim-sdk';
import { worldToScreen } from './ViewportController.js';

interface AutoFbdOverlayProps {
  readonly vectors: readonly ForceVectorItem[];
  readonly viewport: Viewport;
  readonly frameOrigin: { x: number; y: number };
  readonly showComponents: boolean;
}

interface PlacedLabel {
  id: string;
  x: number;
  y: number;
  text: string;
  color: string;
}

function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  lineWidth = 2.4
): void {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const headLen = 9;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
}

/**
 * 在主仿真 Canvas 顶部直接叠加 Auto-FBD 矢量受力图（含正交分解虚线与标签碰撞排斥算法）
 */
export function renderAutoFbdToCanvas(
  ctx: CanvasRenderingContext2D,
  props: AutoFbdOverlayProps
): void {
  const { vectors, viewport, frameOrigin, showComponents } = props;
  if (vectors.length === 0) return;

  let maxMag = 0;
  for (const v of vectors) {
    const m = Math.hypot(v.force.x, v.force.y);
    if (m > maxMag) maxMag = m;
  }
  if (maxMag < 1e-12) return;

  const pxPerForceUnit = 78 / maxMag;
  const labels: PlacedLabel[] = [];

  ctx.save();
  for (const item of vectors) {
    const mag = Math.hypot(item.force.x, item.force.y);
    if (mag < 1e-9) continue;

    const start = worldToScreen(item.origin.x, item.origin.y, viewport, frameOrigin);
    const dxPx = item.force.x * pxPerForceUnit;
    const dyPx = -item.force.y * pxPerForceUnit;
    const end = { x: start.x + dxPx, y: start.y + dyPx };
    const color = item.color ?? '#f43f5e';

    if (showComponents && Math.abs(dxPx) > 8 && Math.abs(dyPx) > 8) {
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.72)';
      ctx.lineWidth = 1.4;
      // Fx projection
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, start.y);
      ctx.lineTo(end.x, end.y);
      // Fy projection
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(start.x, end.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      ctx.restore();
    }

    drawArrowHead(ctx, start.x, start.y, end.x, end.y, color);

    labels.push({
      id: item.id,
      x: end.x + (dxPx >= 0 ? 8 : -8),
      y: end.y + (dyPx >= 0 ? 14 : -8),
      text: `${item.label} = ${mag.toFixed(2)} ${item.unit ?? 'N'}`,
      color
    });
  }

  // Iterative vertical/horizontal label collision repulsion
  for (let iter = 0; iter < 8; iter++) {
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        const a = labels[i]!;
        const b = labels[j]!;
        const overlapX = Math.abs(a.x - b.x) < 110;
        const overlapY = Math.abs(a.y - b.y) < 18;
        if (overlapX && overlapY) {
          const push = a.y <= b.y ? -9 : 9;
          a.y += push;
          b.y -= push;
        }
      }
    }
  }

  ctx.font = 'bold 12px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textAlign = 'left';
  for (const lbl of labels) {
    const w = ctx.measureText(lbl.text).width + 10;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.fillRect(lbl.x - 4, lbl.y - 12, w, 17);
    ctx.fillStyle = lbl.color;
    ctx.fillText(lbl.text, lbl.x, lbl.y);
  }
  ctx.restore();
}

export const AutoFbdBadge: React.FC<{ active: boolean; count: number }> = ({ active, count }) => {
  if (!active || count === 0) return null;
  return (
    <div className="absolute top-3 left-3 z-10 px-2.5 py-1 rounded-lg bg-slate-900/85 border border-rose-400/50 text-xs text-rose-200 font-semibold pointer-events-none">
      Auto-FBD 受力分解叠加中（{count} 项力矢量）
    </div>
  );
};
