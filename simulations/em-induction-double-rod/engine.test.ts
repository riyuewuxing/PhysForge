import { createWorldMapper, resolveInitialCameraTransform, resolvePluginParams } from '@physforge/sim-sdk';
import { describe, expect, it } from 'vitest';
import { emInductionDoubleRodPlugin } from './plugin.js';
import { inductionDiagramGeometry, inductionLoadDimensions } from './diagramGeometry.js';
import {
  checkInvariants,
  computeObservables,
  createInitialState,
  stepInduction,
  type InductionParams
} from './engine.js';

const baseParams: InductionParams = {
  rodMode: 'double',
  circuitLoad: 'resistor',
  magneticB: 1.5,
  railWidth: 1.0,
  mass1: 2.0,
  mass2: 1.0,
  resistorR: 1.5,
  rodResistance1: 0.5,
  rodResistance2: 0.5,
  capacitance: 0.5,
  batteryEmf: 6.0,
  externalForce: 0,
  frictionMu: 0,
  v1Initial: 6.0,
  v2Initial: 0
};

describe('em-induction-double-rod engine', () => {
  it('fits every initial circuit preset in the unobscured desktop viewport', () => {
    for (const preset of emInductionDoubleRodPlugin.presets) {
      const params = resolvePluginParams(emInductionDoubleRodPlugin.paramSchema, preset.params);
      const state = createInitialState(params);
      const g = inductionDiagramGeometry(state, params);
      for (const [width, height] of [[976, 720], [1232, 752], [1392, 852]] as const) {
        const camera = resolveInitialCameraTransform(emInductionDoubleRodPlugin, params, width, height);
        const m = createWorldMapper({ width, height, dpr: 1, ...camera });
        expect(m.toX(g.minX)).toBeGreaterThan(16);
        expect(m.toX(g.maxX)).toBeLessThan(width - 280 - 16);
        if (!g.double) {
          const { halfPlateWidth } = inductionLoadDimensions(g.l1);
          expect(m.toX(g.x2 - halfPlateWidth)).toBeGreaterThan(16);
          expect(m.toX(g.x2 + halfPlateWidth)).toBeLessThan(width - 280 - 16);
        }
      }
    }
  });

  it('uses the benchmark resistance value without changing the physical total resistance', () => {
    const preset = emInductionDoubleRodPlugin.presets.find((item) => item.id === 'single-rod-battery-drive');
    const params = resolvePluginParams(emInductionDoubleRodPlugin.paramSchema, preset?.params);
    const state = createInitialState(params);
    const formula = emInductionDoubleRodPlugin.formatFormulas?.(state, params)[0];

    expect(preset?.params.resistorR).toBe(2);
    expect(preset?.params.rodResistance1).toBe(0);
    expect(preset?.params.mass1).toBe(4.5);
    expect(formula?.latex).toContain('BLv');
  });

  it('conserves total momentum (< 1e-6) and mechanical+Joule energy (< 1e-4) in smooth double-rod motion', () => {
    const initial = createInitialState(baseParams);
    let state = initial;
    const dt = 0.002;
    // 运行 6000 步 (t = 12 s ≈ 16 倍时间常数)，使指数衰减残余 < 1e-7
    for (let i = 0; i < 6000; i++) {
      state = stepInduction(state, baseParams, dt).nextState;
    }

    // 解析共速：v_eq = (m1*v10 + m2*v20)/(m1 + m2) = (2*6 + 0)/3 = 4.0 m/s
    // 理论总焦耳热：Q = 0.5 * (m1*m2/(m1+m2)) * (v10 - v20)^2 = 0.5 * (2/3) * 36 = 12.0 J
    expect(state.v1).toBeCloseTo(4.0, 4);
    expect(state.v2).toBeCloseTo(4.0, 4);
    expect(state.jouleHeat).toBeCloseTo(12.0, 4);

    const reports = checkInvariants(state, initial, baseParams);
    for (const r of reports) {
      expect(r.passed).toBe(true);
    }
  });

  it('matches analytical terminal speed and capacitor charge for single-rod + capacitor (< 1e-4)', () => {
    const capParams: InductionParams = {
      ...baseParams,
      rodMode: 'single',
      circuitLoad: 'capacitor',
      magneticB: 2.0,
      railWidth: 1.0,
      mass1: 1.0,
      resistorR: 1.0,
      rodResistance1: 0,
      capacitance: 0.25,
      v1Initial: 4.0,
      externalForce: 0
    };
    const initial = createInitialState(capParams);
    let state = initial;
    for (let i = 0; i < 2000; i++) {
      state = stepInduction(state, capParams, 0.002).nextState;
    }

    // 解析稳态速度 v_inf = m1*v0 / (m1 + B^2 * L^2 * C) = 4 / (1 + 4 * 1 * 0.25) = 2.0 m/s
    // 解析稳态电荷 q_inf = C * B * L * v_inf = 0.25 * 2 * 1 * 2 = 1.0 C
    expect(state.v1).toBeCloseTo(2.0, 4);
    expect(state.qCap).toBeCloseTo(1.0, 4);

    const reports = checkInvariants(state, initial, capParams);
    expect(reports[0]?.passed).toBe(true);
  });

  it('matches analytical terminal speed and work-energy theorem under constant force', () => {
    const forceParams: InductionParams = {
      ...baseParams,
      rodMode: 'single',
      circuitLoad: 'resistor',
      magneticB: 1.0,
      railWidth: 1.0,
      mass1: 1.0,
      resistorR: 2.0,
      rodResistance1: 0,
      externalForce: 6.0,
      v1Initial: 0
    };
    const initial = createInitialState(forceParams);
    let state = initial;
    const tEnd = 8.0;
    const dt = 0.002;
    const steps = Math.round(tEnd / dt);
    for (let i = 0; i < steps; i++) {
      state = stepInduction(state, forceParams, dt).nextState;
    }

    // 任意时刻精确解析解：v(t) = v_term * (1 - exp(-t / tau)), tau = m*R/(B^2*L^2) = 2.0 s
    const vTerm = 12.0;
    const tau = 2.0;
    const exactV = vTerm * (1 - Math.exp(-tEnd / tau));
    expect(Math.abs(state.v1 - exactV) / exactV).toBeLessThan(1e-4);

    const reports = checkInvariants(state, initial, forceParams);
    expect(reports[0]?.passed).toBe(true);
  });

  it('handles B=0, v0=0, dt=0, and friction stop without NaN or Infinity', () => {
    const roughParams: InductionParams = {
      ...baseParams,
      rodMode: 'single',
      circuitLoad: 'resistor',
      magneticB: 0,
      frictionMu: 0.2,
      v1Initial: 2.0,
      externalForce: 0
    };
    let s = createInitialState(roughParams);
    s = stepInduction(s, roughParams, 0).nextState;
    for (let i = 0; i < 150; i++) {
      s = stepInduction(s, roughParams, 0.01).nextState;
    }
    expect(s.rod1Stopped).toBe(true);
    expect(s.v1).toBe(0);

    const obs = computeObservables(s, roughParams);
    for (const val of Object.values(obs)) {
      expect(Number.isFinite(val)).toBe(true);
    }
  });

  it('matches zero-resistance single-rod capacitor acceleration F/(m + C*B^2*L^2) within < 1e-7', () => {
    const idealCap: InductionParams = {
      ...baseParams,
      rodMode: 'single',
      circuitLoad: 'capacitor',
      magneticB: 2.0,
      railWidth: 1.0,
      mass1: 1.0,
      resistorR: 0,
      rodResistance1: 0,
      capacitance: 0.25,
      externalForce: 6.0,
      v1Initial: 0
    };
    const expectedA = 6.0 / (1.0 + 0.25 * 4.0 * 1.0); // 6 / 2 = 3.0 m/s^2
    let st = createInitialState(idealCap);
    for (let i = 0; i < 100; i++) {
      st = stepInduction(st, idealCap, 0.01).nextState;
    }
    const expectedV = expectedA * 1.0;
    expect(Math.abs(st.v1 - expectedV) / expectedV).toBeLessThan(1e-7);
    expect(Math.abs(st.qCap - 0.25 * 2.0 * expectedV) / st.qCap).toBeLessThan(1e-7);
  });

  it('allows the zero-resistance capacitor mode through the model parameter schema', () => {
    const resolved = resolvePluginParams(emInductionDoubleRodPlugin.paramSchema, {
      rodMode: 'single',
      circuitLoad: 'capacitor',
      resistorR: 0,
      rodResistance1: 0
    });

    expect(resolved.resistorR).toBe(0);
    expect(createInitialState({ ...baseParams, ...resolved }).current).toBe(0);
  });

  it('conserves generalized momentum and reaches L1*v1 - L2*v2 < 1e-6 with energy conservation < 1e-6 for unequal double rods', () => {
    const unequal: InductionParams = {
      ...baseParams,
      rodMode: 'double',
      railWidth: 1.2,
      railWidth2: 0.6,
      mass1: 2.0,
      mass2: 1.0,
      resistorR: 1.5,
      rodResistance1: 0.5,
      rodResistance2: 0.5,
      externalForce: 0,
      v1Initial: 4.0,
      v2Initial: 0
    };
    const initial = createInitialState(unequal);
    let st = initial;
    for (let i = 0; i < 8000; i++) {
      st = stepInduction(st, unequal, 0.002).nextState;
    }
    expect(Math.abs(unequal.railWidth * st.v1 - unequal.railWidth2! * st.v2)).toBeLessThan(1e-6);
    const reports = checkInvariants(st, initial, unequal);
    for (const r of reports) {
      expect(r.passed).toBe(true);
      expect(r.measuredError).toBeLessThan(1e-6);
    }
  });
});
