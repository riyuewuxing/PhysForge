import type { Vec2 } from '../vectors/index.js';

export interface IsolineSegment {
  readonly a: Vec2;
  readonly b: Vec2;
}

export interface IsolineContour {
  readonly level: number;
  readonly segments: readonly IsolineSegment[];
}

export interface GridBounds2D {
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
}

function interpEdge(p1: Vec2, p2: Vec2, v1: number, v2: number, level: number): Vec2 {
  const denom = v2 - v1;
  if (Math.abs(denom) < 1e-14) {
    return { x: 0.5 * (p1.x + p2.x), y: 0.5 * (p1.y + p2.y) };
  }
  const t = Math.max(0, Math.min(1, (level - v1) / denom));
  return {
    x: p1.x + t * (p2.x - p1.x),
    y: p1.y + t * (p2.y - p1.y)
  };
}

/**
 * Marching Squares 二维标量势场等值线提取器（支持等势面、等压线、等高线）
 * fieldGrid 为行主序数组，长度 nx * ny，下标 idx = j * nx + i
 */
export function extractIsolines(
  fieldGrid: ArrayLike<number>,
  nx: number,
  ny: number,
  bounds: GridBounds2D,
  levels: readonly number[]
): IsolineContour[] {
  if (nx < 2 || ny < 2 || fieldGrid.length < nx * ny) {
    throw new Error(`Invalid field grid dimensions ${nx}x${ny}.`);
  }

  const dx = (bounds.xMax - bounds.xMin) / (nx - 1);
  const dy = (bounds.yMax - bounds.yMin) / (ny - 1);

  return levels.map((level) => {
    const segments: IsolineSegment[] = [];

    for (let j = 0; j < ny - 1; j++) {
      const y0 = bounds.yMin + j * dy;
      const y1 = y0 + dy;
      for (let i = 0; i < nx - 1; i++) {
        const x0 = bounds.xMin + i * dx;
        const x1 = x0 + dx;

        const vBL = fieldGrid[j * nx + i]!;
        const vBR = fieldGrid[j * nx + i + 1]!;
        const vTR = fieldGrid[(j + 1) * nx + i + 1]!;
        const vTL = fieldGrid[(j + 1) * nx + i]!;

        const mask =
          (vBL >= level ? 1 : 0) |
          (vBR >= level ? 2 : 0) |
          (vTR >= level ? 4 : 0) |
          (vTL >= level ? 8 : 0);

        if (mask === 0 || mask === 15) continue;

        const pBL: Vec2 = { x: x0, y: y0 };
        const pBR: Vec2 = { x: x1, y: y0 };
        const pTR: Vec2 = { x: x1, y: y1 };
        const pTL: Vec2 = { x: x0, y: y1 };

        const eBot = () => interpEdge(pBL, pBR, vBL, vBR, level);
        const eRight = () => interpEdge(pBR, pTR, vBR, vTR, level);
        const eTop = () => interpEdge(pTL, pTR, vTL, vTR, level);
        const eLeft = () => interpEdge(pBL, pTL, vBL, vTL, level);

        switch (mask) {
          case 1:
          case 14:
            segments.push({ a: eLeft(), b: eBot() });
            break;
          case 2:
          case 13:
            segments.push({ a: eBot(), b: eRight() });
            break;
          case 3:
          case 12:
            segments.push({ a: eLeft(), b: eRight() });
            break;
          case 4:
          case 11:
            segments.push({ a: eTop(), b: eRight() });
            break;
          case 5: {
            const center = 0.25 * (vBL + vBR + vTR + vTL);
            if (center >= level) {
              segments.push({ a: eLeft(), b: eTop() }, { a: eBot(), b: eRight() });
            } else {
              segments.push({ a: eLeft(), b: eBot() }, { a: eTop(), b: eRight() });
            }
            break;
          }
          case 6:
          case 9:
            segments.push({ a: eBot(), b: eTop() });
            break;
          case 7:
          case 8:
            segments.push({ a: eLeft(), b: eTop() });
            break;
          case 10: {
            const center = 0.25 * (vBL + vBR + vTR + vTL);
            if (center >= level) {
              segments.push({ a: eLeft(), b: eBot() }, { a: eTop(), b: eRight() });
            } else {
              segments.push({ a: eLeft(), b: eTop() }, { a: eBot(), b: eRight() });
            }
            break;
          }
        }
      }
    }

    return { level, segments };
  });
}
