import { bisectEvent } from '../geometry/index.js';

export interface HybridEventRecord {
  readonly id: string;
  readonly time: number;
  readonly label: string;
  readonly metrics?: Record<string, number>;
}

export interface HybridGuard<TMode extends string, TState extends { readonly t: number; readonly mode: TMode }> {
  readonly id: string;
  readonly label: string;
  readonly fromModes: readonly TMode[];
  /** 连续守卫函数 g(state)；从负变正或变号触发 */
  readonly eventFn: (state: TState) => number;
  /** 可选目标端点符号偏置 */
  readonly biasEndpoint?: 'midpoint' | 'negative' | 'positive';
  /** 到达边界点后的状态重映射 (Reset Map) */
  readonly reset: (boundaryState: TState, eventTime: number) => {
    readonly nextState: TState;
    readonly metrics?: Record<string, number>;
  };
}

export interface HybridAutomatonConfig<
  TMode extends string,
  TState extends { readonly t: number; readonly mode: TMode }
> {
  readonly advanceContinuous: (state: TState, dt: number) => TState;
  readonly guards: readonly HybridGuard<TMode, TState>[];
  readonly maxTransitionsPerStep?: number;
  readonly timeTolerance?: number;
}

export interface HybridStepOutcome<TState> {
  readonly nextState: TState;
  readonly events: readonly HybridEventRecord[];
  readonly transitions: number;
  readonly zenoClamped: boolean;
}

export const DEFAULT_MAX_TRANSITIONS_PER_STEP = 8;

/**
 * 零速度静摩擦/接触死区滞回锁定辅助：
 * 当速度落入 [-epsilonVelocity, +epsilonVelocity] 且驱动力未突破最大静极限时直接锁定为零。
 */
export function applyZeroVelocityHysteresis(
  velocity: number,
  drivingForce: number,
  staticLimit: number,
  epsilonVelocity = 1e-4
): { readonly locked: boolean; readonly velocity: number } {
  if (Math.abs(velocity) <= epsilonVelocity && Math.abs(drivingForce) <= staticLimit) {
    return { locked: true, velocity: 0 };
  }
  return { locked: false, velocity };
}

/**
 * 混合动力自动机单步推进器：
 * 在 [0, dt] 内循环搜索最早触发的离散模式切换守卫，通过 bisectEvent 精确收敛后执行 Reset Map，
 * 并以 MAX_TRANSITIONS_PER_STEP 防止 Zeno 无限颤振。
 */
export function stepHybridAutomaton<
  TMode extends string,
  TState extends { readonly t: number; readonly mode: TMode }
>(
  config: HybridAutomatonConfig<TMode, TState>,
  initialState: TState,
  dt: number
): HybridStepOutcome<TState> {
  if (!Number.isFinite(dt) || dt < 0) {
    throw new Error(`HybridAutomaton dt must be non-negative finite, got ${dt}.`);
  }
  if (dt === 0) {
    return { nextState: initialState, events: [], transitions: 0, zenoClamped: false };
  }

  const maxTransitions = config.maxTransitionsPerStep ?? DEFAULT_MAX_TRANSITIONS_PER_STEP;
  const timeTolerance = config.timeTolerance ?? 1e-8;

  let cur = initialState;
  let remaining = dt;
  let transitions = 0;
  let zenoClamped = false;
  const events: HybridEventRecord[] = [];

  while (remaining > 1e-12) {
    if (transitions >= maxTransitions) {
      zenoClamped = true;
      cur = config.advanceContinuous(cur, remaining);
      break;
    }

    let earliest: {
      guard: HybridGuard<TMode, TState>;
      timeOffset: number;
      time: number;
      boundaryState: TState;
    } | null = null;

    for (const guard of config.guards) {
      if (!guard.fromModes.includes(cur.mode)) continue;
      const ev = bisectEvent(cur, cur.t, remaining, config.advanceContinuous, guard.eventFn, {
        timeTolerance,
        biasEndpoint: guard.biasEndpoint ?? 'midpoint'
      });
      if (ev && (!earliest || ev.timeOffset < earliest.timeOffset)) {
        earliest = {
          guard,
          timeOffset: ev.timeOffset,
          time: ev.time,
          boundaryState: ev.state
        };
      }
    }

    if (!earliest) {
      cur = config.advanceContinuous(cur, remaining);
      remaining = 0;
      break;
    }

    const resetOutcome = earliest.guard.reset(earliest.boundaryState, earliest.time);
    events.push({
      id: `${earliest.guard.id}-${earliest.time.toFixed(6)}`,
      time: earliest.time,
      label: earliest.guard.label,
      metrics: resetOutcome.metrics
    });

    cur = resetOutcome.nextState;
    remaining = Math.max(0, remaining - earliest.timeOffset);
    transitions++;
  }

  return {
    nextState: cur,
    events,
    transitions,
    zenoClamped
  };
}
