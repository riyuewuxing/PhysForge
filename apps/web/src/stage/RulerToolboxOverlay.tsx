import React, { useMemo, useState } from 'react';
import type { Viewport } from '@physforge/sim-sdk';
import { getPixelsPerMeter, screenToWorld, worldToScreen } from './ViewportController.js';

export type MeasureToolKind = 'none' | 'ruler' | 'protractor' | 'compass';

interface Point2D {
  x: number;
  y: number;
}

interface RulerToolboxOverlayProps {
  readonly activeTool: MeasureToolKind;
  readonly viewport: Viewport;
  readonly frameOrigin: Point2D;
}

function solveCircumcircle(
  p1: Point2D,
  p2: Point2D,
  p3: Point2D
): { center: Point2D; radius: number } | null {
  const ax = p1.x;
  const ay = p1.y;
  const bx = p2.x;
  const by = p2.y;
  const cx = p3.x;
  const cy = p3.y;

  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-6) return null;

  const aSq = ax * ax + ay * ay;
  const bSq = bx * bx + by * by;
  const cSq = cx * cx + cy * cy;

  const ux = (aSq * (by - cy) + bSq * (cy - ay) + cSq * (ay - by)) / d;
  const uy = (aSq * (cx - bx) + bSq * (ax - cx) + cSq * (bx - ax)) / d;
  const r = Math.hypot(ux - ax, uy - ay);
  return { center: { x: ux, y: uy }, radius: r };
}

/**
 * 画布实测工具箱叠加层：虚拟直尺、0.1° 量角器、三点定圆圆规（绑定世界坐标系随缩放平移同步）
 */
export const RulerToolboxOverlay: React.FC<RulerToolboxOverlayProps> = ({
  activeTool,
  viewport,
  frameOrigin
}) => {
  const [rulerPts, setRulerPts] = useState<[Point2D, Point2D]>([
    { x: -1.0, y: 0.4 },
    { x: 1.0, y: 0.4 }
  ]);
  const [protractorPts, setProtractorPts] = useState<[Point2D, Point2D, Point2D]>([
    { x: 1.2, y: 0 },
    { x: 0, y: 0 },
    { x: 0.9, y: 0.9 }
  ]);
  const [compassPts, setCompassPts] = useState<[Point2D, Point2D, Point2D]>([
    { x: -0.9, y: 0 },
    { x: 0, y: 0.9 },
    { x: 0.9, y: 0 }
  ]);
  const [dragTarget, setDragTarget] = useState<{
    tool: MeasureToolKind;
    index: number;
  } | null>(null);

  const ppm = getPixelsPerMeter(viewport);

  const circumcircle = useMemo(() => {
    if (activeTool !== 'compass') return null;
    return solveCircumcircle(compassPts[0], compassPts[1], compassPts[2]);
  }, [activeTool, compassPts]);

  if (activeTool === 'none') return null;

  const toScr = (pt: Point2D) => worldToScreen(pt.x, pt.y, viewport, frameOrigin);

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!dragTarget) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const world = screenToWorld(sx, sy, viewport, frameOrigin);

    if (dragTarget.tool === 'ruler') {
      setRulerPts((prev) => {
        const next: [Point2D, Point2D] = [{ ...prev[0] }, { ...prev[1] }];
        next[dragTarget.index] = world;
        return next;
      });
    } else if (dragTarget.tool === 'protractor') {
      setProtractorPts((prev) => {
        const next: [Point2D, Point2D, Point2D] = [{ ...prev[0] }, { ...prev[1] }, { ...prev[2] }];
        next[dragTarget.index] = world;
        return next;
      });
    } else if (dragTarget.tool === 'compass') {
      setCompassPts((prev) => {
        const next: [Point2D, Point2D, Point2D] = [{ ...prev[0] }, { ...prev[1] }, { ...prev[2] }];
        next[dragTarget.index] = world;
        return next;
      });
    }
  };

  return (
    <svg
      data-testid="ruler-toolbox-overlay"
      className="absolute inset-0 w-full h-full z-20 pointer-events-auto select-none"
      onPointerMove={handlePointerMove}
      onPointerUp={() => setDragTarget(null)}
      onPointerLeave={() => setDragTarget(null)}
    >
      {activeTool === 'ruler' && (() => {
        const p1 = toScr(rulerPts[0]);
        const p2 = toScr(rulerPts[1]);
        const dxW = rulerPts[1].x - rulerPts[0].x;
        const dyW = rulerPts[1].y - rulerPts[0].y;
        const distW = Math.hypot(dxW, dyW);
        const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };

        return (
          <g>
            <line
              x1={p1.x}
              y1={p1.y}
              x2={p2.x}
              y2={p2.y}
              stroke="#38bdf8"
              strokeWidth={2.5}
              strokeDasharray="6 3"
            />
            <rect
              x={mid.x - 95}
              y={mid.y - 32}
              width={190}
              height={24}
              rx={6}
              fill="rgba(15, 23, 42, 0.88)"
              stroke="#38bdf8"
            />
            <text
              x={mid.x}
              y={mid.y - 16}
              textAnchor="middle"
              fill="#e0f2fe"
              fontSize={12}
              fontFamily="monospace"
            >
              {`L=${distW.toFixed(3)}m (Δx=${dxW.toFixed(2)}, Δy=${dyW.toFixed(2)})`}
            </text>
            {[p1, p2].map((pt, idx) => (
              <circle
                key={idx}
                cx={pt.x}
                cy={pt.y}
                r={8}
                fill="#38bdf8"
                stroke="#ffffff"
                strokeWidth={2}
                className="cursor-grab"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
                  setDragTarget({ tool: 'ruler', index: idx });
                }}
              />
            ))}
          </g>
        );
      })()}

      {activeTool === 'protractor' && (() => {
        const sA = toScr(protractorPts[0]);
        const sO = toScr(protractorPts[1]);
        const sB = toScr(protractorPts[2]);
        const v1 = { x: protractorPts[0].x - protractorPts[1].x, y: protractorPts[0].y - protractorPts[1].y };
        const v2 = { x: protractorPts[2].x - protractorPts[1].x, y: protractorPts[2].y - protractorPts[1].y };
        const mag1 = Math.hypot(v1.x, v1.y);
        const mag2 = Math.hypot(v2.x, v2.y);
        const cosTheta =
          mag1 > 1e-6 && mag2 > 1e-6
            ? Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / (mag1 * mag2)))
            : 1;
        const deg = (Math.acos(cosTheta) * 180) / Math.PI;

        return (
          <g>
            <circle cx={sO.x} cy={sO.y} r={70} fill="rgba(251, 191, 36, 0.08)" stroke="#fbbf24" strokeDasharray="4 4" />
            <line x1={sO.x} y1={sO.y} x2={sA.x} y2={sA.y} stroke="#fbbf24" strokeWidth={2.5} />
            <line x1={sO.x} y1={sO.y} x2={sB.x} y2={sB.y} stroke="#fbbf24" strokeWidth={2.5} />
            <rect x={sO.x + 12} y={sO.y - 34} width={96} height={24} rx={6} fill="rgba(15, 23, 42, 0.9)" stroke="#fbbf24" />
            <text x={sO.x + 60} y={sO.y - 18} textAnchor="middle" fill="#fef3c7" fontSize={13} fontFamily="monospace">
              {`${deg.toFixed(1)}°`}
            </text>
            {[sA, sO, sB].map((pt, idx) => (
              <circle
                key={idx}
                cx={pt.x}
                cy={pt.y}
                r={idx === 1 ? 9 : 7}
                fill={idx === 1 ? '#f59e0b' : '#fde68a'}
                stroke="#ffffff"
                strokeWidth={2}
                className="cursor-grab"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  setDragTarget({ tool: 'protractor', index: idx });
                }}
              />
            ))}
          </g>
        );
      })()}

      {activeTool === 'compass' && (() => {
        const sPts = compassPts.map(toScr);
        const sCenter = circumcircle ? toScr(circumcircle.center) : null;
        const scrRadius = circumcircle ? circumcircle.radius * ppm : 0;

        return (
          <g>
            {circumcircle && sCenter && Number.isFinite(scrRadius) && scrRadius < 6000 && (
              <>
                <circle
                  cx={sCenter.x}
                  cy={sCenter.y}
                  r={scrRadius}
                  fill="rgba(52, 211, 153, 0.08)"
                  stroke="#34d399"
                  strokeWidth={2}
                  strokeDasharray="6 4"
                />
                <circle cx={sCenter.x} cy={sCenter.y} r={4} fill="#34d399" />
                <line
                  x1={sCenter.x}
                  y1={sCenter.y}
                  x2={sPts[0]!.x}
                  y2={sPts[0]!.y}
                  stroke="#34d399"
                  strokeWidth={1.5}
                />
                <rect
                  x={sCenter.x + 10}
                  y={sCenter.y - 14}
                  width={126}
                  height={24}
                  rx={6}
                  fill="rgba(15, 23, 42, 0.9)"
                  stroke="#34d399"
                />
                <text
                  x={sCenter.x + 73}
                  y={sCenter.y + 2}
                  textAnchor="middle"
                  fill="#d1fae5"
                  fontSize={12}
                  fontFamily="monospace"
                >
                  {`R = ${circumcircle.radius.toFixed(3)} m`}
                </text>
              </>
            )}
            {sPts.map((pt, idx) => (
              <circle
                key={idx}
                cx={pt.x}
                cy={pt.y}
                r={8}
                fill="#34d399"
                stroke="#ffffff"
                strokeWidth={2}
                className="cursor-grab"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  setDragTarget({ tool: 'compass', index: idx });
                }}
              />
            ))}
          </g>
        );
      })()}
    </svg>
  );
};
