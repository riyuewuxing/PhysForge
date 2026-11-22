import { degToRad, vec2, type Vec2 } from '@physforge/physics-core';
import type { InvariantReport, PhysicsEvent, StepResult } from '@physforge/sim-sdk';

export type WaveMode = 'transverse' | 'interference' | 'doppler';

export type WaveCouplingParams = {
  mode: WaveMode;
  amplitude: number;
  frequency: number;
  wavelength: number;
  direction: 'right' | 'left';
  causalFront: boolean;
  probeX: number;
  probeY: number;
  sourceSeparation: number;
  phaseDiffDeg: number;
  sourceSpeedRatio: number; // v_s / v_wave for Doppler
};

export interface WavefrontCircle {
  readonly cx: number;
  readonly cy: number;
  readonly emittedAt: number;
}

export interface WaveCouplingState {
  readonly t: number;
  readonly sourceX: number;
  readonly wavefronts: readonly WavefrontCircle[];
  readonly lastEmitTime: number;
  readonly probeDisplacement: number;
  readonly probeVelocityY: number;
  readonly probeAccelY: number;
  readonly probeHistory: readonly Vec2[]; // (t, y_probe)
}

const MAX_HISTORY_POINTS = 600;
const MAX_WAVEFRONTS = 40;

export function computeWaveSpeed(params: WaveCouplingParams): number {
  return Math.max(0, params.wavelength * params.frequency);
}

/**
 * 一维横波在 (x, t) 处的位移、质点速度与加速度
 */
export function evaluateTransverseWave(
  x: number,
  t: number,
  params: WaveCouplingParams
): { y: number; vy: number; ay: number } {
  const A = params.amplitude;
  const f = params.frequency;
  const lambda = params.wavelength;
  if (A === 0 || f <= 0 || lambda <= 0) {
    return { y: 0, vy: 0, ay: 0 };
  }

  const omega = 2 * Math.PI * f;
  const vWave = lambda * f;
  const dirSign = params.direction === 'right' ? 1 : -1;

  if (params.causalFront) {
    // 因果起振模式：从原点 x = 0 在 t = 0 起振，沿设定方向（或双向）传播
    const dist = params.direction === 'right' ? x : -x;
    if (dist < 0 || dist > vWave * t) {
      return { y: 0, vy: 0, ay: 0 };
    }
    const phase = omega * (t - dist / vWave);
    const y = A * Math.sin(phase);
    const vy = A * omega * Math.cos(phase);
    const ay = -omega * omega * y;
    return { y, vy, ay };
  }

  const phase = omega * (t - (dirSign * x) / vWave);
  const y = A * Math.sin(phase);
  const vy = A * omega * Math.cos(phase);
  const ay = -omega * omega * y;
  return { y, vy, ay };
}

/**
 * 双波源二维干涉在点 (x, y) 处的合位移与解析合振幅
 */
export function evaluateInterferenceAtPoint(
  x: number,
  y: number,
  t: number,
  params: WaveCouplingParams
): { displacement: number; vy: number; analyticalAmplitude: number; pathDiff: number } {
  const A = params.amplitude;
  const f = params.frequency;
  const lambda = params.wavelength;
  if (A === 0 || f <= 0 || lambda <= 0) {
    return { displacement: 0, vy: 0, analyticalAmplitude: 0, pathDiff: 0 };
  }

  const halfD = 0.5 * params.sourceSeparation;
  const r1 = Math.hypot(x + halfD, y);
  const r2 = Math.hypot(x - halfD, y);
  const pathDiff = Math.abs(r2 - r1);

  const omega = 2 * Math.PI * f;
  const k = (2 * Math.PI) / lambda;
  const vWave = lambda * f;
  const dPhi = degToRad(params.phaseDiffDeg);

  const wave1Active = !params.causalFront || r1 <= vWave * t;
  const wave2Active = !params.causalFront || r2 <= vWave * t;

  const y1 = wave1Active ? A * Math.sin(omega * t - k * r1) : 0;
  const y2 = wave2Active ? A * Math.sin(omega * t - k * r2 + dPhi) : 0;

  const vy1 = wave1Active ? A * omega * Math.cos(omega * t - k * r1) : 0;
  const vy2 = wave2Active ? A * omega * Math.cos(omega * t - k * r2 + dPhi) : 0;

  const analyticalAmplitude =
    wave1Active && wave2Active
      ? 2 * A * Math.abs(Math.cos(0.5 * (k * (r2 - r1) - dPhi)))
      : wave1Active || wave2Active
        ? A
        : 0;

  return {
    displacement: y1 + y2,
    vy: vy1 + vy2,
    analyticalAmplitude,
    pathDiff
  };
}

/**
 * 多普勒效应解析表观频率
 */
export function computeDopplerFrequencies(params: WaveCouplingParams): {
  frontFreq: number;
  backFreq: number;
} {
  const f0 = Math.max(0, params.frequency);
  const beta = params.sourceSpeedRatio;
  const frontFreq = beta < 0.999 ? f0 / (1 - beta) : Number.POSITIVE_INFINITY;
  const backFreq = f0 / (1 + Math.max(0, beta));
  return { frontFreq, backFreq };
}

function evaluateProbe(
  t: number,
  params: WaveCouplingParams
): { y: number; vy: number; ay: number } {
  if (params.mode === 'transverse') {
    return evaluateTransverseWave(params.probeX, t, params);
  }
  if (params.mode === 'interference') {
    const res = evaluateInterferenceAtPoint(params.probeX, params.probeY, t, params);
    const omega = 2 * Math.PI * params.frequency;
    return { y: res.displacement, vy: res.vy, ay: -omega * omega * res.displacement };
  }
  // doppler 探测点以波源发射后的正弦信号估算局部振动
  const f0 = params.frequency;
  if (f0 <= 0 || params.amplitude === 0) return { y: 0, vy: 0, ay: 0 };
  const vWave = computeWaveSpeed(params);
  const vSource = params.sourceSpeedRatio * vWave;
  const sourceX = -2 + vSource * t;
  const r = Math.hypot(params.probeX - sourceX, params.probeY);
  const omega = 2 * Math.PI * f0;
  const k = (2 * Math.PI) / Math.max(params.wavelength, 1e-6);
  const y = params.amplitude * Math.sin(omega * t - k * r);
  const vy = params.amplitude * omega * Math.cos(omega * t - k * r);
  return { y, vy, ay: -omega * omega * y };
}

export function createInitialState(params: WaveCouplingParams): WaveCouplingState {
  const probe = evaluateProbe(0, params);
  const initialSourceX = params.mode === 'doppler' ? -2.0 : 0;
  return {
    t: 0,
    sourceX: initialSourceX,
    wavefronts: params.mode === 'doppler' ? [{ cx: initialSourceX, cy: 0, emittedAt: 0 }] : [],
    lastEmitTime: 0,
    probeDisplacement: probe.y,
    probeVelocityY: probe.vy,
    probeAccelY: probe.ay,
    probeHistory: [vec2(0, probe.y)]
  };
}

export function stepWaveCoupling(
  state: WaveCouplingState,
  params: WaveCouplingParams,
  dt: number
): StepResult<WaveCouplingState> {
  if (!Number.isFinite(dt) || dt < 0) {
    throw new Error(`Time step dt must be non-negative finite, got ${dt}.`);
  }
  if (dt === 0) {
    return { nextState: state, events: [] };
  }

  const nextT = state.t + dt;
  const vWave = computeWaveSpeed(params);
  const events: PhysicsEvent[] = [];

  let nextSourceX = state.sourceX;
  let nextWavefronts = [...state.wavefronts];
  let nextLastEmitTime = state.lastEmitTime;

  if (params.mode === 'doppler') {
    const vSource = params.sourceSpeedRatio * vWave;
    nextSourceX = -2.0 + vSource * nextT;
    // 在波形周期内循环保持波源在视窗内演示，如跑太远可保留波前
    const emitInterval = params.frequency > 0 ? 1 / params.frequency : 1;
    if (nextT - nextLastEmitTime >= emitInterval) {
      nextLastEmitTime = nextT;
      nextWavefronts.push({ cx: nextSourceX, cy: 0, emittedAt: nextT });
      if (nextWavefronts.length > MAX_WAVEFRONTS) {
        nextWavefronts = nextWavefronts.slice(nextWavefronts.length - MAX_WAVEFRONTS);
      }
    }
  }

  // 检查因果波前首次抵达探测点事件
  if (params.mode === 'transverse' && params.causalFront && vWave > 0) {
    const dist = params.direction === 'right' ? params.probeX : -params.probeX;
    if (dist > 0) {
      const arrivalT = dist / vWave;
      if (state.t < arrivalT && nextT >= arrivalT) {
        events.push({
          id: `wave-arrive-${arrivalT.toFixed(5)}`,
          time: arrivalT,
          label: '波前抵达探测质点 P',
          position: { x: params.probeX, y: 0 }
        });
      }
    }
  }

  const probe = evaluateProbe(nextT, params);
  const nextHistory =
    state.probeHistory.length >= MAX_HISTORY_POINTS
      ? [...state.probeHistory.slice(state.probeHistory.length - MAX_HISTORY_POINTS + 1), vec2(nextT, probe.y)]
      : [...state.probeHistory, vec2(nextT, probe.y)];

  return {
    nextState: {
      t: nextT,
      sourceX: nextSourceX,
      wavefronts: nextWavefronts,
      lastEmitTime: nextLastEmitTime,
      probeDisplacement: probe.y,
      probeVelocityY: probe.vy,
      probeAccelY: probe.ay,
      probeHistory: nextHistory
    },
    events
  };
}

export function computeObservables(
  state: WaveCouplingState,
  params: WaveCouplingParams
): Record<string, number> {
  const vWave = computeWaveSpeed(params);
  const interference =
    params.mode === 'interference'
      ? evaluateInterferenceAtPoint(params.probeX, params.probeY, state.t, params)
      : null;

  return {
    probeY: state.probeDisplacement,
    probeVy: state.probeVelocityY,
    probeAy: state.probeAccelY,
    waveSpeed: vWave,
    analyticalAmplitude: interference ? interference.analyticalAmplitude : params.amplitude,
    pathDifference: interference ? interference.pathDiff : 0
  };
}

export function checkInvariants(
  state: WaveCouplingState,
  _initial: WaveCouplingState,
  params: WaveCouplingParams
): InvariantReport[] {
  if (params.frequency <= 0 || params.wavelength <= 0 || params.amplitude === 0) {
    return [];
  }
  const omega = 2 * Math.PI * params.frequency;
  const expectedAy = -omega * omega * state.probeDisplacement;
  const err = Math.abs(state.probeAccelY - expectedAy) / Math.max(Math.abs(expectedAy), 1e-9);
  return [
    {
      name: '简谐振动动力学关系 (ay = -ω²y)',
      measuredError: err,
      tolerance: 1e-6,
      passed: err < 1e-6
    }
  ];
}
