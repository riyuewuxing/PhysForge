import { resolvePluginParams } from '@physforge/sim-sdk';
import { describe, expect, it } from 'vitest';
import { emCapacitorMillikanPlugin } from './plugin.js';
import { capacitorMillikanPresets } from './presets.js';
import {
  BASE_AREA_M2,
  EPSILON_0,
  ELEMENTARY_CHARGE,
  capacitorGeometry,
  getDropPhysicalParams,
  computeObservables,
  checkInvariants,
  computeCapacitorMetrics,
  createInitialState,
  stepCapacitorMillikan,
  type CapacitorMillikanParams
} from './engine.js';

function getPreset(idx: number): CapacitorMillikanParams {
  return resolvePluginParams(emCapacitorMillikanPlugin.paramSchema, capacitorMillikanPresets[idx]!.params);
}

describe('em-capacitor-millikan dynamic analysis & Millikan balance (E02)', () => {
  it('matches analytical C, Q, U, E, phiP within < 1e-10 and preserves E identically when switch open and only d changes', () => {
    const baseOpen = getPreset(0);
    const m1 = computeCapacitorMetrics({ ...baseOpen, distanceMm: 16 });
    const m2 = computeCapacitorMetrics({ ...baseOpen, distanceMm: 36 });

    // Strict zero change in electric field when Q is constant and only d changes!
    expect(Math.abs(m2.fieldE - m1.fieldE)).toBeLessThan(1e-12);

    const closed = getPreset(1);
    const mc = computeCapacitorMetrics(closed);
    const expectedC = (EPSILON_0 * closed.dielectricEr * closed.areaRatioS * BASE_AREA_M2) / (closed.distanceMm * 1e-3);
    const expectedPhiP = closed.sourceVoltageU0 * closed.probeFracP;
    expect(Math.abs(mc.capacitanceF - expectedC) / expectedC).toBeLessThan(1e-10);
    expect(Math.abs(mc.chargeC - expectedC * closed.sourceVoltageU0) / mc.chargeC).toBeLessThan(1e-10);
    expect(Math.abs(mc.phiPV - expectedPhiP) / expectedPhiP).toBeLessThan(1e-10);
  });

  it('maintains static Millikan oil drop equilibrium (qE = mg) and damps toward terminal Stokes speed otherwise', () => {
    const eqParams = getPreset(2); // calibrated exact equilibrium
    let stEq = createInitialState(eqParams);
    for (let i = 0; i < 100; i++) {
      stEq = stepCapacitorMillikan(stEq, eqParams, 0.02).nextState;
    }
    expect(Math.abs(stEq.dropYFrac - 0.5)).toBeLessThan(1e-12);
    expect(Math.abs(stEq.dropVy)).toBeLessThan(1e-12);

    const riseParams: CapacitorMillikanParams = { ...eqParams, sourceVoltageU0: 250 };
    let stRise = createInitialState(riseParams);
    for (let i = 0; i < 10; i++) {
      stRise = stepCapacitorMillikan(stRise, riseParams, 0.005).nextState;
    }
    expect(stRise.dropYFrac).toBeGreaterThan(0.5);
    expect(stRise.dropYFrac).toBeLessThan(1.0);
    expect(stRise.dropVy).toBeGreaterThan(0);

    // Verify terminal Stokes speed v_t = (qE/m - g) / stokesDrag under high drag before hitting plate
    const stokesParams: CapacitorMillikanParams = {
      ...eqParams,
      distanceMm: 40,
      sourceVoltageU0: 400, // E = 10000 V/m -> matches 1*g at 2 steps
      dropChargeSteps: 3,   // qE/m = 1.5 g => net accel = +0.5 g
      stokesDrag: 250       // v_t = 0.5 * 9.8 / 250 = 0.0196 m/s
    };
    let stTerm = createInitialState(stokesParams);
    for (let i = 0; i < 100; i++) {
      stTerm = stepCapacitorMillikan(stTerm, stokesParams, 0.002).nextState;
    }
    const expectedVt = (0.5 * 9.8) / 250;
    expect(Math.abs(stTerm.dropVy - expectedVt) / expectedVt).toBeLessThan(1e-6);
  });

  it('handles zero voltage and zero dt safely without NaN', () => {
    const p0: CapacitorMillikanParams = { ...getPreset(0), sourceVoltageU0: 0 };
    const s0 = createInitialState(p0);
    expect(stepCapacitorMillikan(s0, p0, 0).nextState.voltageV).toBe(0);
    const s1 = stepCapacitorMillikan(s0, p0, 0.05).nextState;
    expect(Number.isFinite(s1.fieldE)).toBe(true);
  });
});

describe('H31 E02 independent signed field, charge and exact events',()=>{
  it('matches absolute SI values, fixed reference charge and all potential gauges',()=>{
    const p={...getPreset(0),distanceMm:20,probeFracP:.25};
    const a=computeCapacitorMetrics(p);
    expect(a.capacitanceF*1e12).toBeCloseTo(17.7083756256,10);
    expect(a.chargeC*1e9).toBeCloseTo(3.54167512512,10);
    expect(a.fieldEy).toBeCloseTo(-10000,10);
    expect(a.phiPV).toBeCloseTo(50,10);
    for(const groundMode of ['bottom','top','none'] as const){
      const b=computeCapacitorMetrics({...p,distanceMm:40,groundMode});
      expect(b.chargeC).toBe(a.chargeC);
      expect(b.voltageV).toBeCloseTo(400,10);
      expect(b.fieldEy).toBe(a.fieldEy);
      expect(b.phiPV).toBeCloseTo(groundMode==='bottom'?100:groundMode==='top'?-300:-100,10);
      expect(b.phiTopV-b.phiBottomV).toBeCloseTo(400,10);
    }
    const reverse=computeCapacitorMetrics({...p,sourceVoltageU0:-200});
    expect(reverse.fieldEy).toBeCloseTo(10000,10);
    expect(reverse.fieldE).toBeCloseTo(10000,10);
    expect(reverse.phiPV).toBeCloseTo(-50,10);
    const changed=computeCapacitorMetrics({...p,areaRatioS:.5,dielectricEr:4});
    expect(changed.chargeC).toBe(a.chargeC);
    expect(changed.fieldEy).toBeCloseTo(-5000,10);
  });
  it('uses exactly integer electron charges and a declared calibrated mass',()=>{
    expect(ELEMENTARY_CHARGE).toBe(1.602176634e-19);
    const p=getPreset(2),q=getDropPhysicalParams(p);
    expect(q.charge/ELEMENTARY_CHARGE).toBe(-2);
    expect(q.mass).toBeCloseTo(2*1.602176634e-19*10000/9.8,28);
    const o=computeObservables(createInitialState(p),p);
    expect(o.dropElectricForceN).toBeCloseTo(o.dropWeightN!,27);
    expect(o.dropAcceleration).toBeCloseTo(0,12);
  });
  it('captures free fall at the first plate, independent of frame size, and freezes',()=>{
    const p={...getPreset(2),sourceVoltageU0:0,stokesDrag:0};
    const hit=Math.sqrt(.02/9.8);
    for(const dt of [.003,.037,1]){
      const init=createInitialState(p);let s=init;
      for(let i=0;i<100&&!s.terminal;i++)s=stepCapacitorMillikan(s,p,dt).nextState;
      expect(s.terminal).toBe('bottom');
      expect(s.t).toBeCloseTo(hit,10);
      expect(s.dropYFrac).toBe(0);
      expect(s.dropVy).toBeCloseTo(-9.8*hit,10);
      expect(s.events).toHaveLength(1);
      expect(checkInvariants(s,init,p).every(i=>i.passed)).toBe(true);
      const again=stepCapacitorMillikan(s,p,1);
      expect(again.advancedTime).toBe(0);expect(again.nextState).toBe(s);
    }
  });
  it('captures a top collision even when the coarse endpoint has returned inside',()=>{
    const p={...getPreset(2),sourceVoltageU0:0,stokesDrag:0};
    const init={...createInitialState(p),dropVy:.5};
    const t=(.5-Math.sqrt(.25-2*9.8*.01))/9.8;
    const r=stepCapacitorMillikan(init,p,.09);
    expect(r.halt).toBe(true);
    expect(r.nextState.terminal).toBe('top');
    expect(r.nextState.t).toBeCloseTo(t,10);
    expect(r.nextState.dropVy).toBeGreaterThan(0);
  });
  it('matches the exponential Stokes solution at high drag and small drag without cancellation',()=>{
    const p={...getPreset(2),dropChargeSteps:3,stokesDrag:250,distanceMm:40,sourceVoltageU0:400};
    const s=createInitialState(p),t=.2,a=4.9,b=250;
    const r=stepCapacitorMillikan(s,p,t).nextState;
    const expectedY=.02+a/b*(t-(1-Math.exp(-b*t))/b);
    expect(r.dropYFrac*.04).toBeCloseTo(expectedY,12);
    expect(r.dropVy).toBeCloseTo(a/b*(1-Math.exp(-b*t)),12);
    const tiny={...p,stokesDrag:1e-12};
    const z=stepCapacitorMillikan(createInitialState(tiny),tiny,.01).nextState;
    expect(z.dropVy).toBeCloseTo(.049,12);
    expect(z.dropYFrac*.04).toBeCloseTo(.02+.5*4.9*.01**2,12);
  });
  it('does not simulate a hidden oil drop and separates physical field and reference charge observables',()=>{
    const p=getPreset(0),s=createInitialState(p),r=stepCapacitorMillikan(s,p,10);
    expect(r.nextState.dropYFrac).toBe(.5);
    expect(r.nextState.events).toEqual([]);
    const o=computeObservables(r.nextState,p);
    expect(o.dropVyMmS).toBeUndefined();
    expect(o.fieldEy).toBeCloseTo(-10000,10);
    expect(o.referenceChargeNC).toBeCloseTo(3.54167512512,10);
  });
});

describe('H31 geometry and teaching force parity',()=>{
  it('uses the same true overlap for probe, oil drop, handles and black-and-white field arrows',()=>{
    for(const ratio of [.3,.5,.85,1])for(const voltage of [-200,0,200]){
      const p={...getPreset(2),areaRatioS:ratio,sourceVoltageU0:voltage};
      const g=capacitorGeometry(p),s=createInitialState(p),ir=emCapacitorMillikanPlugin.exportDiagramIR!(s,p);
      expect((g.right-g.left)/3).toBeCloseTo(ratio,12);
      expect(g.probeX).toBeGreaterThan(g.left);expect(g.probeX).toBeLessThan(g.right);
      expect(g.dropX).toBeGreaterThan(g.left);expect(g.dropX).toBeLessThan(g.right);
      const arrows=ir.primitives.filter(x=>x.kind==='arrow');
      expect(arrows).toHaveLength(voltage===0?0:5);
      for(const a of arrows){if(a.kind!=='arrow')throw Error('unexpected primitive');expect(Math.sign(a.y2-a.y1)).toBe(-Math.sign(voltage));expect(a.x1).toBeGreaterThan(g.left);expect(a.x1).toBeLessThan(g.right);}
      const handles=emCapacitorMillikanPlugin.getControlHandles!(s,p);
      expect(handles.find(h=>h.id==='probe-p')!.position.x).toBe(g.probeX);
      const forces=emCapacitorMillikanPlugin.getForceVectors!(s,p);
      const o=computeObservables(s,p);
      expect(forces.find(f=>f.id==='drop-mg')!.force.y).toBe(-o.dropWeightN!);
      expect(forces.find(f=>f.id==='drop-qe')!.force.y).toBe(o.dropElectricForceN);
      expect(forces.every(f=>f.origin.x===g.dropX&&f.unit==='N')).toBe(true);
    }
  });
});

describe('H32 E02 viewport regression',()=>{
  it('fits the actual plate, gauge, marker and label bounds over all supported extremes',()=>{
    const model=emCapacitorMillikanPlugin;
    const layers=new Set(['plates','electrometer','oilDrop']);
    for(const width of [620,1024,1440])for(const height of [310,570,900])for(const distanceMm of [8,20,40])for(const areaRatioS of [.3,.65,1])for(const groundMode of ['bottom','top','none'] as const){
      const p={...getPreset(2),distanceMm,areaRatioS,groundMode,sourceVoltageU0:400};
      const v={width,height,dpr:1,scale:1,offsetX:0,offsetY:0};
      const safe={left:30,right:width-26,top:28,bottom:height-28};
      const fit=model.fitCapacitorViewport(p,v,safe);
      expect(fit).not.toBeNull();
      const state=createInitialState(p);
      expect(model.capacitorBoundsFit(state,p,fit!,safe)).toBe(true);
      const l=model.capacitorLayout(state,p,fit!,layers);
      const text=l.boxes.filter(b=>l.labels.some(t=>t.id===b.id));
      const overlap=(a:typeof text[number],b:typeof text[number])=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
      for(let i=0;i<text.length;i++)for(let j=i+1;j<text.length;j++)expect(overlap(text[i]!,text[j]!),JSON.stringify({width,height,distanceMm,areaRatioS,groundMode,a:text[i]!.id,b:text[j]!.id})).toBe(false);
      for(const label of text)for(const box of l.boxes.filter(b=>['top-plate','bottom-plate','meter'].includes(b.id)))expect(overlap(label,box),JSON.stringify({width,height,distanceMm,areaRatioS,groundMode,label:label.id,box:box.id})).toBe(false);
    }
  });
});
