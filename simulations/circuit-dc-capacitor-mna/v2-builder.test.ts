import { describe, expect, it } from 'vitest';
import { resolvePluginParams } from '@physforge/sim-sdk';
import { circuitDcCapacitorMnaPlugin } from './plugin.js';
import { createInitialState, stepCircuit, type CircuitParams } from './engine.js';

describe('B2 builder-circuit-mna V2 verification', () => {
  it('matches RC charging time-constant tau analytical voltage E*(1 - 1/e) within < 1e-4', () => {
    const params = resolvePluginParams<CircuitParams>(circuitDcCapacitorMnaPlugin.paramSchema, {
      topology: 'rc-transient',
      emf: 10,
      internalR: 1,
      r1: 9,
      capacitance: 0.05,
      switchClosed: true
    });

    const tau = (params.internalR + params.r1) * params.capacitance; // 0.5s
    const steps = 1000;
    const dt = tau / steps;
    let state = createInitialState(params);
    for (let i = 0; i < steps; i++) {
      state = stepCircuit(state, params, dt).nextState;
    }

    const expectedUc = params.emf * (1 - Math.exp(-1));
    expect(Math.abs(state.capVoltage - expectedUc)).toBeLessThan(1e-4);
  });

  it('converges nonlinear diode branch KCL < 1e-9 and emits SHORT_CIRCUIT alert safely without NaN', () => {
    const diodeParams = resolvePluginParams<CircuitParams>(
      circuitDcCapacitorMnaPlugin.paramSchema,
      {
        topology: 'nonlinear-lamp-diode',
        emf: 5,
        internalR: 0.5,
        sliderR: 10,
        switchClosed: true
      }
    );
    const diodeState = createInitialState(diodeParams);
    expect(Math.abs(diodeState.totalCurrent - diodeState.branchCurrent1)).toBeLessThan(1e-9);
    expect(diodeState.terminalVoltage).toBeGreaterThan(0.5);
    expect(diodeState.terminalVoltage).toBeLessThan(0.8);

    // Direct zero-load short-circuit condition triggers alert event with finite numbers
    const shortParams: CircuitParams = {
      ...diodeParams,
      topology: 'closed-power',
      internalR: 0,
      sliderR: 0,
      emf: 12
    };
    const shortState = createInitialState(shortParams);
    expect(shortState.events.some((e) => e.id === 'SHORT_CIRCUIT')).toBe(true);
    expect(Number.isFinite(shortState.totalCurrent)).toBe(true);

    const ir = circuitDcCapacitorMnaPlugin.exportDiagramIR?.(diodeState, diodeParams);
    // The old generic circuitElement assertion accepted an incorrect lamp
    // placeholder. Require the actual diode geometry and separate cathode.
    const triangle=ir?.primitives.find(p=>p.kind==='polyline'&&p.closed&&p.points.length===3);
    expect(triangle?.kind).toBe('polyline');
    if(triangle?.kind!=='polyline')throw new Error('missing diode triangle');
    const tip=triangle.points[2]!;
    expect(tip.y).toBeLessThan(triangle.points[0]!.y);
    expect(ir?.primitives.some(p=>p.kind==='polyline'&&p.points.length===2&&p.points.every(a=>Math.abs(a.y-tip.y)<1e-10)&&p.points[0]!.x<tip.x&&p.points[1]!.x>tip.x)).toBe(true);
    expect(ir?.primitives.some(p=>p.kind==='circle'&&!p.fill)).toBe(false);
  });
});
