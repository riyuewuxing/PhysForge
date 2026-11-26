import { resolvePluginParams } from '@physforge/sim-sdk';
import { describe, expect, it } from 'vitest';
import { thermoPistonGasLawsPlugin } from './plugin.js';
import { thermoGasPresets } from './presets.js';
import { makeThermoApparatus, makeThermoPlot } from './sceneGeometry.js';
import {
  P_ATM,
  R_GAS,
  computeDetachCriticalTempK,
  computeObservables,
  computePumpStages,
  solveMercuryTiltState,
  computeMultiStrokePressure,
  createInitialState,
  stepThermoGasLaws,
  type ThermoGasParams
} from './engine.js';

function getPreset(idx: number): ThermoGasParams {
  return resolvePluginParams(thermoPistonGasLawsPlugin.paramSchema, thermoGasPresets[idx]!.params);
}

describe('thermo-piston-gas-laws hybrid stop-pin & pump invariants (T01)', () => {
  it('captures exact piston stop-pin detachment critical temperature (< 1e-7 K) and satisfies PV/(nRT) = 1 (< 1e-10)', () => {
    const params = getPreset(0);
    const expectedTCrit = computeDetachCriticalTempK(params);
    let st = createInitialState(params);
    expect(st.mode).toBe('pinned');

    for (let i = 0; i < 60; i++) {
      st = stepThermoGasLaws(st, params, 0.05).nextState;
      const pvErr = Math.abs((st.pressurePa * st.volumeM3) / (st.molesN * R_GAS * st.temperatureK) - 1);
      expect(pvErr).toBeLessThan(1e-10);
    }

    expect(st.mode).toBe('floating');
    expect(st.detachTempK).not.toBeNull();
    expect(Math.abs(st.detachTempK! - expectedTCrit)).toBeLessThan(1e-7);
  });

  it('matches k-stroke vacuum extraction formula P0*(V/(V+dV))^k within < 1e-10', () => {
    const params = getPreset(2);
    const expected = P_ATM * Math.pow(params.tankVolumeL / (params.tankVolumeL + params.pumpDeltaVL), params.pumpStrokesK);
    const measured = computeMultiStrokePressure(params);
    expect(Math.abs(measured - expected) / expected).toBeLessThan(1e-10);
  });

  it('handles zero tilt and zero dt cleanly without NaN', () => {
    const tilt = { ...getPreset(1), tubeTiltDeg: 0 };
    const s0 = createInitialState(tilt);
    expect(stepThermoGasLaws(s0, tilt, 0).nextState).toEqual(s0);
    expect(Number.isFinite(s0.pressurePa)).toBe(true);
  });
});

describe('H44 independent gas mass, contact and work regressions',()=>{
  it('solves spilled mercury and trapped gas together, rather than reconstructing n from an inconsistent state',()=>{
    const p={...getPreset(1),pistonAreaCm2:20,tubeLengthCm:45,mercuryCm:30,tubeTiltDeg:-90,targetTempK:300};
    const s=createInitialState(p),h=(121-Math.sqrt(4913))/2,L0=13;
    expect(s.overflowed).toBe(true);
    expect(s.mercuryColumnCm).toBeCloseTo(h,10);
    expect(s.airColumnCm).toBeCloseTo(45-h,10);
    expect(s.pressurePa).toBeCloseTo(101325*(76-h)/76,7);
    expect(s.molesN).toBeCloseTo(101325*L0*.01*.002/(R_GAS*300),12);
  });
  it('keeps the horizontal-reference amount fixed at every tilt, even after overflow',()=>{
    const p={...getPreset(1),pistonAreaCm2:20,tubeLengthCm:45,mercuryCm:30,targetTempK:300};
    const n0=101325*.13*.002/(R_GAS*300);
    for(const theta of [-90,-75,-60,-45,-15,0,30,90]){
      const s=createInitialState({...p,tubeTiltDeg:theta});
      expect(s.molesN).toBeCloseTo(n0,12);
      expect(s.pressurePa*s.airColumnCm/101325).toBeCloseTo(13,10);
      expect(s.pressurePa).toBeCloseTo(101325*(1+s.mercuryColumnCm*Math.sin(theta*Math.PI/180)/76),7);
      expect(s.airColumnCm+s.mercuryColumnCm).toBeLessThanOrEqual(45+1e-10);
    }
  });
  it('treats mercury tilt as an independent static equilibrium scan, not a false clock',()=>{
    const p=getPreset(1),s=createInitialState(p);
    expect(stepThermoGasLaws(s,p,3).nextState).toEqual(s);
  });
  it('records each ideal isothermal pump stage, including k=0, for extraction and injection',()=>{
    for(const direction of ['extract','inject'] as const){
      const p={...getPreset(2),tankVolumeL:10,pumpDeltaVL:2.5,pumpStrokesK:5,pumpDirection:direction};
      const s=createInitialState(p);
      expect(s.pvHistory).toHaveLength(6);
      for(let k=0;k<=5;k++){
        expect(s.pvHistory[k]!.vL).toBeCloseTo(10,12);
        expect(s.pvHistory[k]!.pKPa).toBeCloseTo(101.325*(direction==='extract' ? .8**k : 1+.25*k),10);
      }
    }
  });
  it('does not append fictitious duplicate pump strokes or advance a static clock',()=>{
    const p=getPreset(2),s=createInitialState(p);
    expect(stepThermoGasLaws(s,p,3).nextState).toEqual(s);
  });
  it('accepts an independent hot initial temperature and crosses the pin during cooling',()=>{
    const p={...getPreset(0),initialTempK:420,targetTempK:220,heatingRateKPerS:60};
    const tc=(101325+10*9.8/.005)*.005/(.25*R_GAS);
    const s=createInitialState(p);
    expect(s.temperatureK).toBe(420);expect(s.mode).toBe('floating');expect(s.detachTempK).toBeNull();
    const outcome=stepThermoGasLaws(s,p,4);
    expect(outcome.nextState.mode).toBe('pinned');
    expect(outcome.nextState.temperatureK).toBe(220);
    expect(outcome.events).toHaveLength(1);
    expect(outcome.events[0]!.id.startsWith('hit-pin')).toBe(true);
    expect(outcome.events[0]!.time).toBeCloseTo((420-tc)/60,9);
    expect(outcome.nextState.pvHistory.some(q=>Math.abs(q.vL-5)<1e-10&&Math.abs(q.pKPa-120.925)<1e-8)).toBe(true);
  });
  it('inserts the physical P-V corner even when one step crosses it',()=>{
    const p=getPreset(0),s=createInitialState(p),outcome=stepThermoGasLaws(s,p,3);
    const tc=120925*.005/(.25*R_GAS);
    expect(outcome.events[0]!.time).toBeCloseTo((tc-260)/60,8);
    expect(outcome.nextState.pvHistory.some(q=>Math.abs(q.vL-5)<1e-10&&Math.abs(q.pKPa-120.925)<1e-8)).toBe(true);
  });
  it('accounts for signed quasistatic boundary work, zero while held by the lower stop',()=>{
    const p=getPreset(0),s=createInitialState(p);
    const held=stepThermoGasLaws(s,p,.1).nextState;
    expect(computeObservables(held).workByGasJ).toBeCloseTo(0,12);
    const heated=stepThermoGasLaws(s,p,3).nextState;
    const expected=.25*R_GAS*420-120925*.005;
    expect(computeObservables(heated).workByGasJ).toBeCloseTo(expected,8);
    const cooling={...p,initialTempK:420,targetTempK:220};
    const cooled=stepThermoGasLaws(createInitialState(cooling),cooling,4).nextState;
    expect(computeObservables(cooled).workByGasJ).toBeCloseTo(-expected,8);
  });
  it('does not invent a detachment event or temperature when already above the stop initially',()=>{
    const p={...getPreset(0),molesN:.6,pinVolumeL:3};
    const s=createInitialState(p);
    expect(s.mode).toBe('floating');
    expect(s.detachTempK).toBeNull();expect(s.events).toEqual([]);
  });
});

describe('F01 geometry, equilibrium and exact boundary cases',()=>{
  it('uses one exact boundary event at equality, and reverses on the subsequent cooling step',()=>{
    const p=getPreset(0),tc=120925*.005/(.25*R_GAS),heat={...p,targetTempK:tc};
    const start=createInitialState(heat),at=stepThermoGasLaws(start,heat,10);
    expect(at.events).toHaveLength(1);expect(at.events[0]!.time).toBeCloseTo((tc-260)/60,10);
    expect(at.nextState.mode).toBe('floating');
    const still=stepThermoGasLaws(at.nextState,heat,1);expect(still.events).toEqual([]);
    const back=stepThermoGasLaws(still.nextState,{...p,targetTempK:220},.1);
    expect(back.events).toHaveLength(1);expect(back.events[0]!.time).toBeCloseTo(still.nextState.t,10);
    expect(back.nextState.mode).toBe('pinned');expect(computeObservables(back.nextState).workByGasJ).toBeCloseTo(0,10);
  });
  it('keeps overflow solution continuous at the first spill boundary',()=>{
    const p={...getPreset(1),tubeLengthCm:45,mercuryCm:30};
    const theta=Math.asin((13/15-1)*76/30)*180/Math.PI;
    const a=solveMercuryTiltState({...p,tubeTiltDeg:theta+1e-5}),b=solveMercuryTiltState({...p,tubeTiltDeg:theta-1e-5});
    expect(a.overflowed).toBe(false);expect(b.overflowed).toBe(true);
    expect(Math.abs(a.airCm-b.airCm)).toBeLessThan(1e-4);
    expect(Math.abs(a.mercCm-b.mercCm)).toBeLessThan(1e-4);
  });
  it('preserves gas and mercury geometric length fractions and sums every force to zero',()=>{
    for(const p of [getPreset(0),{...getPreset(0),initialTempK:420},{...getPreset(1),tubeLengthCm:45,mercuryCm:30,tubeTiltDeg:-90},{...getPreset(1),tubeTiltDeg:30}]){
      const s=createInitialState(p),g=makeThermoApparatus(s,p);
      const forces=thermoPistonGasLawsPlugin.getForceVectors!(s,p);
      expect(forces.length).toBeGreaterThanOrEqual(3);
      expect(forces.reduce((sum,v)=>sum+v.force.x,0)).toBeCloseTo(0,8);
      expect(forces.reduce((sum,v)=>sum+v.force.y,0)).toBeCloseTo(0,8);
      for(const f of forces)expect(f.origin).toEqual(g.forceOrigin);
      if(g.tube){
        const t=g.tube,d=(a:{x:number;y:number},b:{x:number;y:number})=>Math.hypot(a.x-b.x,a.y-b.y);
        expect(d(t.closed,t.airEnd)/t.length).toBeCloseTo(s.airColumnCm/p.tubeLengthCm,12);
        expect(d(t.airEnd,t.mercuryEnd)/t.length).toBeCloseTo(s.mercuryColumnCm/p.tubeLengthCm,12);
      }else expect(g.cylinder!.gasY).toBeGreaterThanOrEqual(g.cylinder!.pinY-1e-12);
    }
  });
  it('uses real discrete pump stage amounts and does not clamp high pressure or volume at plot edges',()=>{
    const p={...getPreset(2),tankVolumeL:2,pumpDeltaVL:5,pumpStrokesK:10,pumpDirection:'inject' as const};
    const stages=computePumpStages(p),s=createInitialState(p),plot=makeThermoPlot(s,p);
    expect(stages).toHaveLength(11);
    for(const q of stages.slice(1))expect(q.deltaMolesN).toBeCloseTo(P_ATM*.005/(R_GAS*p.targetTempK),12);
    expect(plot.kind).toBe('discrete-strokes');expect(plot.raw).toHaveLength(11);
    expect(plot.yMax).toBeGreaterThan(s.pressurePa/1000);expect(plot.xMax).toBeGreaterThan(10);
    const large={...getPreset(0),molesN:.6,initialTempK:600,targetTempK:600,pistonMassKg:0,pinVolumeL:3};
    const q=createInitialState(large),g=makeThermoPlot(q,large);
    expect(g.xMax).toBeGreaterThan(q.volumeM3*1000);
  });
  it('exports the actual apparatus and appropriate state axes for all three modes',()=>{
    for(const p of [getPreset(0),getPreset(1),getPreset(2)]){
      const s=createInitialState(p),a=makeThermoApparatus(s,p),g=makeThermoPlot(s,p),ir=thermoPistonGasLawsPlugin.exportDiagramIR!(s,p);
      expect(ir.primitives).toEqual([...a.primitives,...g.primitives]);
      expect(ir.primitives.some(v=>v.kind==='text'&&v.text===g.xLabel)).toBe(true);
    }
  });
});
