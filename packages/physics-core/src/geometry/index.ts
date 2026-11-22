import type { Vec2 } from '../vectors/index.js';

/**
 * 二维半空间有向距离（沿 outwardNormal 方向为正，边界为 0，内部为负）
 */
export function signedDistanceHalfSpace2D(
  point: Vec2,
  planePoint: Vec2,
  outwardNormal: Vec2
): number {
  const normLen = Math.hypot(outwardNormal.x, outwardNormal.y);
  if (normLen === 0) {
    throw new Error('Half-space outwardNormal must be non-zero.');
  }
  const dx = point.x - planePoint.x;
  const dy = point.y - planePoint.y;
  return (dx * outwardNormal.x + dy * outwardNormal.y) / normLen;
}

/**
 * 二维圆形区域有向距离（内部 < 0，圆周 = 0，外部 > 0）
 */
export function signedDistanceCircle2D(point: Vec2, center: Vec2, radius: number): number {
  if (!Number.isFinite(radius) || radius < 0) {
    throw new Error(`Circle radius must be a non-negative finite number, got ${radius}.`);
  }
  return Math.hypot(point.x - center.x, point.y - center.y) - radius;
}

/**
 * 二维轴对齐矩形有向距离（内部 < 0，边界 = 0，外部 > 0）
 */
export function signedDistanceRect2D(
  point: Vec2,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number
): number {
  if (minX > maxX || minY > maxY) {
    throw new Error('Invalid rectangle bounds: min must be <= max.');
  }
  const halfW = 0.5 * (maxX - minX);
  const halfH = 0.5 * (maxY - minY);
  const cx = 0.5 * (minX + maxX);
  const cy = 0.5 * (minY + maxY);

  const dx = Math.abs(point.x - cx) - halfW;
  const dy = Math.abs(point.y - cy) - halfH;

  const outsideDist = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  const insideDist = Math.min(Math.max(dx, dy), 0);
  return outsideDist + insideDist;
}

/**
 * 点到斜面直线的垂直有向高度：
 * origin 为斜面上一点，angleRad 为斜面与 +x 轴夹角（逆时针为正），
 * 斜面上方空间法向为 (-sin(angle), cos(angle))，上方为正、斜面为 0、穿透下方为负。
 */
export function signedHeightAboveIncline2D(
  point: Vec2,
  origin: Vec2,
  angleRad: number
): number {
  const nx = -Math.sin(angleRad);
  const ny = Math.cos(angleRad);
  return (point.x - origin.x) * nx + (point.y - origin.y) * ny;
}

export function isPointInCircle2D(point: Vec2, center: Vec2, radius: number): boolean {
  return signedDistanceCircle2D(point, center, radius) <= 0;
}

export function isPointInRect2D(
  point: Vec2,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number
): boolean {
  return point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
}

export interface BisectEventOptions {
  /** 允许的临界时刻区间宽度上限（单位 s），默认 1e-8 s（严于 1e-7 s 红线） */
  timeTolerance?: number;
  /** 最大二分迭代次数，默认 64 */
  maxIterations?: number;
  /** 当初始状态恰好 g0 === 0 时是否触发事件，默认 false 以避免离开边界瞬间重复触发 */
  triggerOnStartZero?: boolean;
  /** 收敛后优先选取区间内侧（negative: g<=0）或外侧（positive: g>=0）端点，防止跨界后立即重复反向触发 */
  biasEndpoint?: 'midpoint' | 'negative' | 'positive';
}

export interface BisectEventResult<TState> {
  readonly timeOffset: number;
  readonly time: number;
  readonly state: TState;
  readonly eventValue: number;
  readonly bracketWidth: number;
  readonly iterations: number;
}

/**
 * 基于真实物理步进积分回溯 + 二分搜索的精确事件定位器
 * 当事件函数 g(state) 在 [0, dt] 步内发生变号 (g0 * g1 <= 0) 时，
 * 通过重复调用 advance(state0, mid) 收敛临界时刻至 |Δt| <= timeTolerance（默认 1e-8 s）。
 */
export function bisectEvent<TState>(
  state0: TState,
  t0: number,
  dt: number,
  advance: (state: TState, subDt: number) => TState,
  eventFn: (state: TState) => number,
  options: BisectEventOptions = {}
): BisectEventResult<TState> | null {
  if (!Number.isFinite(t0) || !Number.isFinite(dt)) {
    throw new Error(`bisectEvent requires finite t0 and dt, got t0=${t0}, dt=${dt}.`);
  }
  if (dt === 0) {
    return null;
  }

  const timeTolerance = options.timeTolerance ?? 1e-8;
  const maxIterations = options.maxIterations ?? 64;
  const triggerOnStartZero = options.triggerOnStartZero ?? false;

  if (!Number.isFinite(timeTolerance) || timeTolerance <= 0) {
    throw new Error(`timeTolerance must be positive finite, got ${timeTolerance}.`);
  }

  const g0 = eventFn(state0);
  if (!Number.isFinite(g0)) {
    throw new Error(`Event function returned non-finite value at start state: ${g0}.`);
  }

  if (g0 === 0) {
    if (triggerOnStartZero) {
      return {
        timeOffset: 0,
        time: t0,
        state: state0,
        eventValue: 0,
        bracketWidth: 0,
        iterations: 0
      };
    }
    // 起点已在边界上且不立即触发时，需检查步末是否依然严格同号或穿透；仅在未要求起点触发时返回 null
    // 若一步之内离开再返回，应由更小物理步长处理；此处避免原地死锁重复命中
    return null;
  }

  const stateEnd = advance(state0, dt);
  const g1 = eventFn(stateEnd);
  if (!Number.isFinite(g1)) {
    throw new Error(`Event function returned non-finite value at end state: ${g1}.`);
  }

  // 同号未过零
  if ((g0 > 0 && g1 > 0) || (g0 < 0 && g1 < 0)) {
    return null;
  }

  if (g1 === 0) {
    return {
      timeOffset: dt,
      time: t0 + dt,
      state: stateEnd,
      eventValue: 0,
      bracketWidth: 0,
      iterations: 0
    };
  }

  let lo = 0;
  let hi = dt;
  let gLo = g0;
  let bestState = stateEnd;
  let bestOffset = dt;
  let bestG = g1;
  let iterations = 0;

  while (Math.abs(hi - lo) > timeTolerance && iterations < maxIterations) {
    const mid = 0.5 * (lo + hi);
    const midState = advance(state0, mid);
    const gMid = eventFn(midState);
    if (!Number.isFinite(gMid)) {
      throw new Error(`Event function returned non-finite value during bisection: ${gMid}.`);
    }

    iterations++;
    bestOffset = mid;
    bestState = midState;
    bestG = gMid;

    if (gMid === 0) {
      lo = mid;
      hi = mid;
      break;
    }

    // gLo 与 gMid 同号 -> 零点在 [mid, hi]
    if ((gLo > 0 && gMid > 0) || (gLo < 0 && gMid < 0)) {
      lo = mid;
      gLo = gMid;
    } else {
      hi = mid;
    }
  }

  // 根据 biasEndpoint 选择精确中点或满足目标符号侧的端点（区间宽度已 <= timeTolerance）
  const bias = options.biasEndpoint ?? 'midpoint';
  let finalOffset = 0.5 * (lo + hi);
  if (bias === 'negative') {
    finalOffset = gLo <= 0 ? lo : hi;
  } else if (bias === 'positive') {
    finalOffset = gLo >= 0 ? lo : hi;
  }
  if (finalOffset !== bestOffset) {
    bestOffset = finalOffset;
    bestState = advance(state0, finalOffset);
    bestG = eventFn(bestState);
  }

  return {
    timeOffset: bestOffset,
    time: t0 + bestOffset,
    state: bestState,
    eventValue: bestG,
    bracketWidth: Math.abs(hi - lo),
    iterations
  };
}
