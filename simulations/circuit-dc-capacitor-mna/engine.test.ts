import { resolvePluginParams } from '@physforge/sim-sdk';
import { describe, expect, it } from 'vitest';
import { circuitDcCapacitorMnaPlugin } from './plugin.js';
import {
  checkInvariants,
  computeObservables,
  createInitialState,
  stepCircuit,
  type CircuitParams
} from './engine.js';

const baseParams: CircuitParams = {
  topology: 'closed-power',
  emf: 12,
  internalR: 2,
  r1: 4,
  r2: 6,
  sliderR: 2,
  capacitance: 0.1,
  switchClosed: true
};

describe('circuit-dc-capacitor-mna engine', () => {
  it('satisfies closed-circuit Ohm law, KVL (< 1e-9), and maximum output power at R = r', () => {
    const matched = createInitialState(baseParams);
    expect(matched.totalCurrent).toBeCloseTo(3.0, 10); // 12 / (2+2) = 3 A
    expect(matched.terminalVoltage).toBeCloseTo(6.0, 10);
    expect(matched.outputPower).toBeCloseTo(18.0, 10); // P_max = E^2 / (4r) = 144 / 8 = 18 W
    expect(matched.efficiency).toBeCloseTo(0.5, 10);
    expect(checkInvariants(matched, matched, baseParams)[0]?.passed).toBe(true);

    const smallerR = createInitialState({ ...baseParams, sliderR: 1 });
    const largerR = createInitialState({ ...baseParams, sliderR: 4 });
    expect(smallerR.outputPower).toBeLessThan(matched.outputPower);
    expect(largerR.outputPower).toBeLessThan(matched.outputPower);
  });

  it('satisfies KCL (< 1e-9) in series-parallel slider circuit', () => {
    const dynParams: CircuitParams = {
      ...baseParams,
      topology: 'series-parallel-dynamic',
      sliderR: 3
    };
    const s = createInitialState(dynParams);
    // R2=6 || Rp=3 => 2 Ω, + R1(4) + r(2) = 8 Ω => I = 12/8 = 1.5 A
    expect(s.totalCurrent).toBeCloseTo(1.5, 10);
    expect(s.branchCurrent1).toBeCloseTo(0.5, 10);
    expect(s.branchCurrent2).toBeCloseTo(1.0, 10);
    expect(checkInvariants(s, s, dynParams)[0]?.passed).toBe(true);
  });

  it('matches analytical RC charging exponential curve within < 1e-4', () => {
    const rcParams: CircuitParams = {
      ...baseParams,
      topology: 'rc-transient',
      emf: 10,
      internalR: 1,
      r1: 9,
      capacitance: 0.05, // tau = (1+9)*0.05 = 0.5 s
      switchClosed: true
    };
    let s = createInitialState(rcParams);
    const dt = 0.002;
    const tEnd = 0.5;
    const steps = Math.round(tEnd / dt);
    for (let i = 0; i < steps; i++) {
      s = stepCircuit(s, rcParams, dt).nextState;
    }

    const tau = (rcParams.internalR + rcParams.r1) * rcParams.capacitance;
    const exactUc = rcParams.emf * (1 - Math.exp(-tEnd / tau));
    const exactIc = (rcParams.emf / (rcParams.internalR + rcParams.r1)) * Math.exp(-tEnd / tau);
    expect(Math.abs(s.capVoltage - exactUc) / exactUc).toBeLessThan(1e-4);
    expect(Math.abs(s.capCurrent - exactIc) / exactIc).toBeLessThan(1e-4);
  });

  it('computes steady bridge capacitor charge and handles E=0, dt=0 without NaN', () => {
    const bridgeParams: CircuitParams = {
      ...baseParams,
      topology: 'rc-bridge-charge',
      emf: 12,
      internalR: 0,
      r1: 4,
      r2: 6,
      sliderR: 2, // 左分压 12*6/10 = 7.2 V, 右分压 12*6/8 = 9.0 V -> U34 = -1.8 V
      capacitance: 0.2
    };
    const s = createInitialState(bridgeParams);
    // 左分压 U3 = 12 * 6 / (4+6) = 7.2 V, 右分压 U4 = 12 * 6 / (2+6) = 9.0 V -> U34 = -1.8 V
    expect(s.capVoltage).toBeCloseTo(-1.8, 8);
    expect(s.capCharge).toBeCloseTo(-0.36, 8);

    const zeroEmf = createInitialState({ ...baseParams, emf: 0 });
    const zeroStep = stepCircuit(zeroEmf, { ...baseParams, emf: 0 }, 0).nextState;
    const obs = computeObservables(zeroStep);
    for (const v of Object.values(obs)) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('reports a near-zero-resistance short circuit as a structured event without throwing', () => {
    const shortParams = { ...baseParams, internalR: 0, sliderR: 0 };

    expect(() => createInitialState(shortParams)).not.toThrow();
    const state = createInitialState(shortParams);

    expect(state.events).toContainEqual(
      expect.objectContaining({ id: 'SHORT_CIRCUIT', time: 0 })
    );
    expect(Number.isFinite(state.totalCurrent)).toBe(true);
  });

  it('allows an exact zero-ohm demo through the controls and does not flag unrelated topologies', () => {
    const zeroOhm = resolvePluginParams(circuitDcCapacitorMnaPlugin.paramSchema, {
      topology: 'closed-power',
      internalR: 0,
      sliderR: 0
    });
    expect(zeroOhm.internalR).toBe(0);
    expect(zeroOhm.sliderR).toBe(0);
    expect(createInitialState(zeroOhm).events.some((event) => event.id === 'SHORT_CIRCUIT')).toBe(true);

    const rcState = createInitialState({ ...zeroOhm, topology: 'rc-transient', r1: 4 });
    expect(rcState.events.some((event) => event.id === 'SHORT_CIRCUIT')).toBe(false);
  });
});
