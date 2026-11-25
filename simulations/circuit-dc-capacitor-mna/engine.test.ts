import { resolvePluginParams } from '@physforge/sim-sdk';
import { describe, expect, it } from 'vitest';
import { circuitDcCapacitorMnaPlugin } from './plugin.js';
import {
  checkInvariants,
  computeObservables,
  createInitialState,
  sampleDividerLampIvCurve,
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

  it('matches independent scalar circuit balance and exact divider endpoints', () => {
    const base: CircuitParams = { ...baseParams, topology: 'divider-lamp', emf: 12, internalR: 1.5 };
    for (const sliderR of [0, .5, 5, 10, 19.5, 20]) {
      const p = { ...base, sliderR };
      const state = createInitialState(p);
      // Independent bisection of source current minus the two branch currents.
      let lo = 0, hi = p.emf;
      if (sliderR > 0) for (let j=0;j<80;j++) {
        const v=(lo+hi)/2;
        const i=(p.emf-v)/(p.internalR+20-sliderR);
        const load=v/sliderR+.25*v*Math.pow(v+1e-6,-.35);
        if(i>load)lo=v;else hi=v;
      }
      const expected = sliderR===0?0:(lo+hi)/2;
      expect(state.terminalVoltage).toBeCloseTo(expected,8);
      expect(state.divider?.sourceTerminalVoltage).toBeCloseTo(p.emf-state.totalCurrent*p.internalR,10);
      expect(state.divider?.lowerResistance).toBe(sliderR);
      expect(state.divider?.upperResistance).toBe(20-sliderR);
      expect(checkInvariants(state,state,p).every(report=>report.passed)).toBe(true);
      expect(state.capVoltage).toBe(0);
      expect(computeObservables(state).lampVoltage).toBe(state.terminalVoltage);
    }
    const bottom = createInitialState({...base, sliderR:0});
    expect(bottom.branchCurrent2).toBe(0);
    expect(bottom.totalCurrent).toBeCloseTo(12/21.5,12);
    const top = createInitialState({...base, sliderR:20,internalR:0});
    expect(top.terminalVoltage).toBe(12);
    expect(top.divider?.sourceTerminalVoltage).toBe(12);
    expect(top.totalCurrent).toBeCloseTo(12/20+.25*12*Math.pow(12+1e-6,-.35),12);
    const off=createInitialState({...base,emf:0,sliderR:10});
    expect(off.outputPower).toBeCloseTo(0,12);
  });

  it('solves the divider-lamp branch with MNA KCL and returns the physical lamp I-U curve', () => {
    const dividerParams = { ...baseParams, topology: 'divider-lamp' as const, sliderR: 10 };
    const state = createInitialState(dividerParams);
    const samples = sampleDividerLampIvCurve(dividerParams.emf, 16);

    expect(state.nodeVoltages).toHaveLength(3);
    expect(state.terminalVoltage).toBeGreaterThan(0);
    expect(state.outputPower).toBeGreaterThan(0);
    expect(state.totalCurrent).toBeCloseTo(state.branchCurrent1 + state.branchCurrent2, 9);
    expect(checkInvariants(state, state, dividerParams)[0]?.passed).toBe(true);
    expect(samples).toHaveLength(16);
    expect(samples[0]).toEqual({ u: 0, i: 0 });
    expect(samples.at(-1)?.u).toBe(dividerParams.emf);
    expect(samples.at(-1)?.i).toBeGreaterThan(samples[1]!.i);

    for (const sliderR of [0, 20]) {
      const boundary = createInitialState({ ...dividerParams, sliderR, emf: 0 });
      expect(Object.values(computeObservables(boundary)).every(Number.isFinite)).toBe(true);
    }
  });
});

describe('B2 non-divider independent physical limits', () => {
  it('preserves the exact zero-ohm endpoints when a finite series resistance remains', () => {
    const idealSource = createInitialState({...baseParams, internalR:0, sliderR:3});
    expect(idealSource.terminalVoltage).toBe(12);
    expect(idealSource.totalCurrent).toBeCloseTo(4,12);
    const idealWire = createInitialState({...baseParams, internalR:2, sliderR:0});
    expect(idealWire.terminalVoltage).toBe(0);
    expect(idealWire.totalCurrent).toBeCloseTo(6,12);
    expect(idealWire.outputPower).toBe(0);
  });
  it('does not assign a fictitious capacitor to a purely resistive network', () => {
    const s = createInitialState({...baseParams,topology:'series-parallel-dynamic',sliderR:3});
    expect(s.capVoltage).toBe(0);
    expect(s.capCharge).toBe(0);
    expect(s.capEnergy).toBe(0);
    const shortBranch = createInitialState({...baseParams,topology:'series-parallel-dynamic',internalR:0,sliderR:0});
    expect(shortBranch.nodeVoltages[2]).toBe(12);
    expect(shortBranch.nodeVoltages[3]).toBe(0);
    expect(shortBranch.branchCurrent1).toBe(0);
    expect(shortBranch.branchCurrent2).toBeCloseTo(3,12);
  });
  it('uses the new RC circuit immediately after switching without reusing pre-switch current', () => {
    const p: CircuitParams = {...baseParams,topology:'rc-transient',emf:10,internalR:1,r1:9,capacitance:.05};
    let s=createInitialState(p);
    s=stepCircuit(s,p,.2).nextState;
    const v=s.capVoltage;
    const off={...p,switchClosed:false};
    const next=stepCircuit(s,off,.02).nextState;
    const expected=v*Math.exp(-.02/(9*.05));
    expect(next.capVoltage).toBeCloseTo(expected,10);
    expect(next.capCurrent).toBeCloseTo(-expected/9,10);
    expect(next.capEnergy).toBeLessThan(s.capEnergy);
    expect(next.nodeVoltages[0]).toBe(0);
  });
  it('preserves bridge capacitor voltage at topology parameter changes and follows independent Thevenin evolution', () => {
    const p: CircuitParams={...baseParams,topology:'rc-bridge-charge',internalR:0,r1:4,r2:6,sliderR:2,capacitance:.2};
    const s=createInitialState(p);
    const changed={...p,sliderR:8};
    const next=stepCircuit(s,changed,.1).nextState;
    const vTh=12*6/10-12*6/14;
    const rTh=4*6/10+8*6/14;
    const expected=vTh+(s.capVoltage-vTh)*Math.exp(-.1/(rTh*.2));
    expect(next.capVoltage).toBeCloseTo(expected,9);
    expect(next.capCurrent).toBeCloseTo((vTh-expected)/rTh,9);
    expect(next.nodeVoltages[3]!-next.nodeVoltages[4]!).toBeCloseTo(next.capVoltage,10);
  });
  it('does not mistake a nonlinear resistor or diode for a capacitor', () => {
    const s=createInitialState({...baseParams,topology:'nonlinear-lamp-diode',emf:5,sliderR:10});
    expect(s.capVoltage).toBe(0);
    expect(s.capCharge).toBe(0);
    expect(s.capEnergy).toBe(0);
  });
});
