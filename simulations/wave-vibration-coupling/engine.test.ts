import { describe, expect, it } from 'vitest';
import {
  checkInvariants,
  computeDopplerFrequencies,
  computeObservables,
  computeWaveSpeed,
  createInitialState,
  evaluateInterferenceAtPoint,
  evaluateTransverseWave,
  stepWaveCoupling,
  type WaveCouplingParams
} from './engine.js';

const baseParams: WaveCouplingParams = {
  mode: 'transverse',
  amplitude: 0.5,
  frequency: 1.5,
  wavelength: 2.0,
  direction: 'right',
  causalFront: false,
  probeX: 1.5,
  probeY: 0,
  sourceSeparation: 4.0,
  phaseDiffDeg: 0,
  sourceSpeedRatio: 0.4
};

describe('wave-vibration-coupling engine', () => {
  it('satisfies wave speed v = lambda * f and partial time derivative v_y = dy/dt (< 1e-4)', () => {
    expect(computeWaveSpeed(baseParams)).toBeCloseTo(3.0, 12);

    const t = 0.73;
    const x = 1.25;
    const eps = 1e-6;
    const center = evaluateTransverseWave(x, t, baseParams);
    const plus = evaluateTransverseWave(x, t + eps, baseParams);
    const minus = evaluateTransverseWave(x, t - eps, baseParams);
    const numVy = (plus.y - minus.y) / (2 * eps);

    expect(Math.abs(center.vy - numVy) / Math.max(Math.abs(center.vy), 1e-6)).toBeLessThan(1e-4);

    const s0 = createInitialState(baseParams);
    const s1 = stepWaveCoupling(s0, baseParams, 0.2).nextState;
    const inv = checkInvariants(s1, s0, baseParams);
    expect(inv[0]?.passed).toBe(true);
  });

  it('verifies causal wavefront arrival time at probeX', () => {
    const causalParams: WaveCouplingParams = {
      ...baseParams,
      causalFront: true,
      probeX: 3.0 // vWave = 3.0 m/s -> 精确抵达时刻 1.0 s
    };
    let state = createInitialState(causalParams);
    expect(state.probeDisplacement).toBe(0);

    let arrivedTime: number | null = null;
    for (let i = 0; i < 150; i++) {
      const res = stepWaveCoupling(state, causalParams, 0.01);
      state = res.nextState;
      if (res.events.length > 0) {
        arrivedTime = res.events[0]!.time;
      }
    }

    expect(arrivedTime).toBeCloseTo(1.0, 6);
    expect(Math.abs(state.probeDisplacement)).toBeGreaterThan(0);
  });

  it('matches analytical constructive and destructive interference amplitudes (< 1e-4)', () => {
    // S1 = (-2, 0), S2 = (+2, 0), d = 4.0, lambda = 2.0
    // 中垂线 (0, 2) 处 r1 == r2, pathDiff = 0 -> 同相加强 (2A = 1.0), 反相减弱 (0)
    const inPhase = evaluateInterferenceAtPoint(0, 2, 0.4, {
      ...baseParams,
      mode: 'interference',
      phaseDiffDeg: 0
    });
    expect(inPhase.pathDiff).toBeCloseTo(0, 12);
    expect(inPhase.analyticalAmplitude).toBeCloseTo(1.0, 12);

    const antiPhase = evaluateInterferenceAtPoint(0, 2, 0.4, {
      ...baseParams,
      mode: 'interference',
      phaseDiffDeg: 180
    });
    expect(antiPhase.analyticalAmplitude).toBeCloseTo(0, 12);

    // 在 x 轴上 S1-S2 连线间取点 (0.5, 0): r1 = 2.5, r2 = 1.5 -> pathDiff = 1.0 = lambda/2
    // 同相时应为相消点 A_net = 0
    const nodePoint = evaluateInterferenceAtPoint(0.5, 0, 0.4, {
      ...baseParams,
      mode: 'interference',
      phaseDiffDeg: 0
    });
    expect(nodePoint.pathDiff).toBeCloseTo(1.0, 12);
    expect(nodePoint.analyticalAmplitude).toBeLessThan(1e-12);
  });

  it('computes Doppler shifted frequencies accurately', () => {
    const { frontFreq, backFreq } = computeDopplerFrequencies({
      ...baseParams,
      mode: 'doppler',
      frequency: 2.0,
      sourceSpeedRatio: 0.5
    });
    expect(frontFreq).toBeCloseTo(4.0, 12);
    expect(backFreq).toBeCloseTo(2.0 / 1.5, 12);
  });

  it('handles zero amplitude, zero frequency, and dt=0 without NaN or Infinity', () => {
    const cases: WaveCouplingParams[] = [
      { ...baseParams, amplitude: 0 },
      { ...baseParams, frequency: 0 },
      { ...baseParams, mode: 'doppler', sourceSpeedRatio: 0 }
    ];

    for (const p of cases) {
      const s0 = createInitialState(p);
      const s1 = stepWaveCoupling(s0, p, 0).nextState;
      const s2 = stepWaveCoupling(s1, p, 0.02).nextState;
      const obs = computeObservables(s2, p);
      for (const v of Object.values(obs)) {
        expect(Number.isFinite(v)).toBe(true);
      }
    }
  });
});
