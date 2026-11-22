import { useEffect, useMemo, useRef, useState } from 'react';
import { computePhaseLoopArea } from '../csvFitting.js';

export interface PhaseXYPoint {
  readonly x: number;
  readonly y: number;
  readonly t?: number;
}

export interface PhaseXYPlotterProps {
  readonly points: readonly PhaseXYPoint[];
  readonly xLabel: string;
  readonly yLabel: string;
  readonly title?: string;
  readonly fittedCurve?: readonly PhaseXYPoint[];
  readonly fittedLabel?: string;
  readonly showLoopArea?: boolean;
  readonly darkTheme?: boolean;
  readonly width?: number;
  readonly height?: number;
  readonly activeIndex?: number | null;
  readonly onHoverIndex?: (index: number | null) => void;
}

function interpolateTimeColor(fraction: number): string {
  const f = Math.max(0, Math.min(1, fraction));
  const r = Math.round(56 + f * (244 - 56));
  const g = Math.round(189 - f * 95);
  const b = Math.round(248 - f * (248 - 114));
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * 通用非单调 X-Y 相图画布组件：支持时间色带、拟合曲线叠绘、Green 定理闭合面积与悬停回放同步
 */
export function PhaseXYPlotter({
  points,
  xLabel,
  yLabel,
  title,
  fittedCurve,
  fittedLabel,
  showLoopArea = false,
  darkTheme = true,
  width = 480,
  height = 280,
  activeIndex = null,
  onHoverIndex
}: PhaseXYPlotterProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const areaStats = useMemo(() => {
    if (!showLoopArea || points.length < 3) return null;
    return computePhaseLoopArea(
      points.map((p) => p.x),
      points.map((p) => p.y)
    );
  }, [points, showLoopArea]);

  const bounds = useMemo(() => {
    const allPts = fittedCurve ? [...points, ...fittedCurve] : points;
    if (allPts.length === 0) {
      return { xMin: -1, xMax: 1, yMin: -1, yMax: 1 };
    }
    let xMin = Number.POSITIVE_INFINITY;
    let xMax = Number.NEGATIVE_INFINITY;
    let yMin = Number.POSITIVE_INFINITY;
    let yMax = Number.NEGATIVE_INFINITY;
    for (const p of allPts) {
      if (p.x < xMin) xMin = p.x;
      if (p.x > xMax) xMax = p.x;
      if (p.y < yMin) yMin = p.y;
      if (p.y > yMax) yMax = p.y;
    }
    const padX = Math.max(1e-6, (xMax - xMin) * 0.1 || 1);
    const padY = Math.max(1e-6, (yMax - yMin) * 0.1 || 1);
    return {
      xMin: xMin - padX,
      xMax: xMax + padX,
      yMin: yMin - padY,
      yMax: yMax + padY
    };
  }, [points, fittedCurve]);

  const pad = { left: 52, right: 20, top: 28, bottom: 38 };
  const plotW = Math.max(40, width - pad.left - pad.right);
  const plotH = Math.max(40, height - pad.top - pad.bottom);

  const mapX = (x: number) =>
    pad.left + ((x - bounds.xMin) / Math.max(1e-12, bounds.xMax - bounds.xMin)) * plotW;
  const mapY = (y: number) =>
    pad.top + plotH - ((y - bounds.yMin) / Math.max(1e-12, bounds.yMax - bounds.yMin)) * plotH;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = typeof window !== 'undefined' ? Math.max(1, window.devicePixelRatio || 1) : 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.scale(dpr, dpr);

    // Background
    ctx.fillStyle = darkTheme ? '#09111f' : '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // Grid
    ctx.strokeStyle = darkTheme ? 'rgba(148, 163, 184, 0.16)' : 'rgba(15, 23, 42, 0.1)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const gx = pad.left + (plotW * i) / 4;
      const gy = pad.top + (plotH * i) / 4;
      ctx.beginPath();
      ctx.moveTo(gx, pad.top);
      ctx.lineTo(gx, pad.top + plotH);
      ctx.moveTo(pad.left, gy);
      ctx.lineTo(pad.left + plotW, gy);
      ctx.stroke();
    }

    // Zero axes if inside bounds
    ctx.strokeStyle = darkTheme ? 'rgba(226, 232, 240, 0.35)' : 'rgba(15, 23, 42, 0.35)';
    if (bounds.xMin <= 0 && bounds.xMax >= 0) {
      const zx = mapX(0);
      ctx.beginPath();
      ctx.moveTo(zx, pad.top);
      ctx.lineTo(zx, pad.top + plotH);
      ctx.stroke();
    }
    if (bounds.yMin <= 0 && bounds.yMax >= 0) {
      const zy = mapY(0);
      ctx.beginPath();
      ctx.moveTo(pad.left, zy);
      ctx.lineTo(pad.left + plotW, zy);
      ctx.stroke();
    }

    // Closed loop fill when requested
    if (showLoopArea && points.length >= 3) {
      ctx.save();
      ctx.beginPath();
      points.forEach((p, idx) => {
        const sx = mapX(p.x);
        const sy = mapY(p.y);
        if (idx === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      });
      ctx.closePath();
      ctx.fillStyle = darkTheme ? 'rgba(56, 189, 248, 0.14)' : 'rgba(2, 132, 199, 0.12)';
      ctx.fill();
      ctx.restore();
    }

    // Main phase trajectory with time gradient ribbon
    if (points.length >= 2) {
      ctx.lineWidth = 2.2;
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1]!;
        const b = points[i]!;
        ctx.strokeStyle = interpolateTimeColor(i / (points.length - 1));
        ctx.beginPath();
        ctx.moveTo(mapX(a.x), mapY(a.y));
        ctx.lineTo(mapX(b.x), mapY(b.y));
        ctx.stroke();
      }
    }

    // Optional fitted reference curve
    if (fittedCurve && fittedCurve.length >= 2) {
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = darkTheme ? '#fbbf24' : '#d97706';
      ctx.lineWidth = 2;
      ctx.beginPath();
      fittedCurve.forEach((p, idx) => {
        const sx = mapX(p.x);
        const sy = mapY(p.y);
        if (idx === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      });
      ctx.stroke();
      ctx.restore();
    }

    // Highlight active or hovered marker
    const displayIdx = hoveredIdx ?? activeIndex;
    if (displayIdx !== null && displayIdx >= 0 && displayIdx < points.length) {
      const pt = points[displayIdx]!;
      const sx = mapX(pt.x);
      const sy = mapY(pt.y);
      ctx.fillStyle = '#f43f5e';
      ctx.beginPath();
      ctx.arc(sx, sy, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Axis ticks & labels
    ctx.fillStyle = darkTheme ? '#94a3b8' : '#475569';
    ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(bounds.xMin.toPrecision(3), pad.left, height - 18);
    ctx.fillText(bounds.xMax.toPrecision(3), pad.left + plotW, height - 18);
    ctx.fillText(xLabel, pad.left + plotW / 2, height - 6);

    ctx.textAlign = 'right';
    ctx.fillText(bounds.yMax.toPrecision(3), pad.left - 6, pad.top + 8);
    ctx.fillText(bounds.yMin.toPrecision(3), pad.left - 6, pad.top + plotH);

    ctx.save();
    ctx.translate(14, pad.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText(yLabel, 0, 0);
    ctx.restore();

    if (title || fittedLabel) {
      ctx.textAlign = 'left';
      ctx.fillStyle = darkTheme ? '#e2e8f0' : '#0f172a';
      ctx.font = '600 12px sans-serif';
      ctx.fillText(title ?? fittedLabel ?? '', pad.left, 18);
    }

    ctx.restore();
  }, [points, fittedCurve, bounds, width, height, darkTheme, hoveredIdx, activeIndex, showLoopArea, xLabel, yLabel, title, fittedLabel]);

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (points.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    let bestIdx = -1;
    let bestDistSq = 24 * 24;
    for (let i = 0; i < points.length; i++) {
      const dx = mapX(points[i]!.x) - px;
      const dy = mapY(points[i]!.y) - py;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDistSq) {
        bestDistSq = d2;
        bestIdx = i;
      }
    }
    const next = bestIdx >= 0 ? bestIdx : null;
    setHoveredIdx(next);
    onHoverIndex?.(next);
  };

  return (
    <div className="flex flex-col gap-1">
      <canvas
        ref={canvasRef}
        style={{ width, height }}
        className="rounded-lg border border-slate-700/60 cursor-crosshair"
        onPointerMove={handlePointerMove}
        onPointerLeave={() => {
          setHoveredIdx(null);
          onHoverIndex?.(null);
        }}
      />
      {areaStats && (
        <div className="text-xs font-mono text-sky-300 px-1">
          Green 定理闭合面积 ∮y dx = {areaStats.magnitudeArea.toExponential(4)}
        </div>
      )}
    </div>
  );
}
