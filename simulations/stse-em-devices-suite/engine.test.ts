import { resolvePluginParams } from '@physforge/sim-sdk';
import { stepBorisPusher } from '@physforge/physics-core';
import { describe, expect, it } from 'vitest';
import { stseEmDevicesSuitePlugin } from './plugin.js';
import { emDevicesPresets } from './presets.js';
import { getDeviceSchematic } from './deviceGeometry.js';
import { getCyclotronPlan,sampleCyclotron,cyclotronHistory,C_LIGHT,CYCL_DISPLAY_RADIUS } from './cyclotronFlight.js';
import { BEAM_LENGTH_M,RIGHT_X,SELECTOR_HALF_GAP,beamScale,sampleBeamFlight } from './particleFlight.js';
import {
  computeCyclotronExitMetrics,
  computeHallVoltageV,
  computeMhdMetrics,
  createInitialState,
  stepEmDevices,
  checkInvariants,
  type EmDevicesParams
} from './engine.js';

function getPreset(idx: number): EmDevicesParams {
  return resolvePluginParams(stseEmDevicesSuitePlugin.paramSchema, emDevicesPresets[idx]!.params);
}

describe('stse-em-devices-suite physics invariants (S02)', () => {
  it('selects v=E/B exactly and locates exit once at the physical aperture',()=>{
    const p={...getPreset(3),device:'velocity-selector' as const};
    const init=createInitialState(p),out=stepEmDevices(init,p,100);
    expect(out.nextState.flight?.status).toBe('transmitted');
    expect(out.nextState.particlePos.x).toBeCloseTo(RIGHT_X,8);
    expect(out.nextState.particlePos.y).toBeCloseTo(0,12);
    expect(out.nextState.flight?.physicalTimeS).toBeCloseTo(3*BEAM_LENGTH_M/p.particleSpeedMps,14);
    expect(out.events).toHaveLength(1);
    expect(stepEmDevices(out.nextState,p,1).events).toHaveLength(0);
    expect(stepEmDevices(out.nextState,p,1).nextState.particlePos).toEqual(out.nextState.particlePos);
  });
  it('uses the actual Lorentz acceleration on both sides of the selected speed and conserves work-energy',()=>{
    const base={...getPreset(3),device:'velocity-selector' as const};
    for(const speed of [0.5*base.eFieldVPerM/base.bFieldT,1.5*base.eFieldVPerM/base.bFieldT]){
      const p={...base,particleSpeedMps:speed},omega=p.chargeC*p.bFieldT/p.massKg;
      const f=sampleBeamFlight(p,1e-3/omega);
      const accel=p.chargeC*(p.eFieldVPerM-speed*p.bFieldT)/p.massKg;
      expect(f.velocityMps.y/(1e-3/omega)/accel).toBeCloseTo(1,5);
      expect(Math.sign(f.position.y)).toBe(Math.sign(accel));
      const init=createInitialState(p),s=stepEmDevices(init,p,0.25).nextState;
      expect(checkInvariants(s,init,p)[0]?.passed).toBe(true);
      const terminal=stepEmDevices(init,p,100).nextState;
      expect(Math.abs(terminal.particlePos.y)).toBeLessThanOrEqual(SELECTOR_HALF_GAP+1e-8);
    }
  });
  it('maps a true half circle to the same spatial scale for different m, q and B2',()=>{
    const base={...getPreset(3),device:'mass-spectrometer' as const,massKg:1.67262192369e-27};
    for(const p of [base,{...base,massKg:base.massKg*2},{...base,bDeflectT:base.bDeflectT*2},{...base,chargeC:base.chargeC*2}]){
      const init=createInitialState(p),omega=p.chargeC*p.bDeflectT/p.massKg;
      const radius=p.massKg*p.particleSpeedMps/(p.chargeC*p.bDeflectT),entry=1.5*BEAM_LENGTH_M/p.particleSpeedMps;
      const f=sampleBeamFlight(p,entry+Math.PI/(2*omega));
      expect(f.position.x*BEAM_LENGTH_M).toBeCloseTo(radius,10);
      expect(f.position.y*BEAM_LENGTH_M).toBeCloseTo(-radius,10);
      expect(f.velocityMps.y).toBeCloseTo(-p.particleSpeedMps,5);
      const out=stepEmDevices(init,p,10),s=out.nextState;
      expect(s.flight?.status).toBe('detected');
      expect(s.particlePos.x).toBeCloseTo(0,10);
      expect(s.particlePos.y*BEAM_LENGTH_M).toBeCloseTo(-2*radius,10);
      expect(checkInvariants(s,init,p)[0]?.passed).toBe(true);
      expect(out.events).toHaveLength(1);
      expect(s.trail.length).toBeGreaterThan(100);
      expect(stseEmDevicesSuitePlugin.getForceVectors!(init,p,new Set(['main']))).toEqual([]);
      const mid=stepEmDevices(init,p,(entry+Math.PI/(2*omega))/beamScale(p).timeUnit).nextState;
      const force=stseEmDevicesSuitePlugin.getForceVectors!(mid,p,new Set(['main']))[0]!.force;
      expect(force.x).toBeLessThan(0);
      expect(Math.abs(force.y/force.x)).toBeLessThan(1e-8);
    }
  });
  it('stops at the finite analyzer wall when the orbit cannot fit, without inventing a detector hit',()=>{
    const p={...getPreset(3),device:'mass-spectrometer' as const,massKg:1e-25,bDeflectT:0.2};
    const out=stepEmDevices(createInitialState(p),p,10);
    expect(out.nextState.flight?.status).toBe('missed');
    expect(out.nextState.particlePos.x).toBeCloseTo(RIGHT_X,8);
    expect(out.events[0]?.id).toBe('beam-missed');
  });
  it('uses independent exact gap work, circular radius and period instead of equating end energy to the ideal limit',()=>{
    const p={...getPreset(0),bFieldT:0.6,cyclotronRadiusM:0.15},plan=getCyclotronPlan(p),q=p.chargeC,m=p.massKg,B=p.bFieldT;
    expect(plan.status).toBe('wall');expect(plan.arcs.length).toBeGreaterThan(3);
    for(const [i,a] of plan.arcs.entries()){
      const expectedK=(i+1)*q*p.cyclotronVoltageV;
      expect(Math.abs(a.energyJ/expectedK-1)).toBeLessThan(1e-10);
      const expectedR=Math.sqrt(2*m*expectedK)/(q*B);
      expect(Math.abs(a.radius*p.cyclotronRadiusM/expectedR-1)).toBeLessThan(1e-5);
      const f=sampleCyclotron(p,(a.startTau+Math.min(a.endAngle,Math.PI/2)*a.gamma/2)*plan.physicalUnitS);
      expect(Math.abs(0.5*m*(f.velocityMps.x**2+f.velocityMps.y**2)/expectedK-1)).toBeLessThan(1e-8);
      expect(f.gapCount).toBe(i+1);
      if(i<plan.arcs.length-1){
        expect((a.endTau-a.startTau)*plan.physicalUnitS).toBeCloseTo(Math.PI*m/(q*B),14);
        const next=plan.arcs[i+1]!;
        expect(next.y0).toBeCloseTo(a.y0-2*a.direction*a.radius,12);
      }
    }
    const initial=createInitialState(p),out=stepEmDevices(initial,p,100),s=out.nextState;
    expect(s.cyclotron?.status).toBe('wall');
    expect(Math.hypot(s.particlePos.x,s.particlePos.y)*0.7).toBeCloseTo(CYCL_DISPLAY_RADIUS,9);
    expect(out.events).toHaveLength(1);
    expect(out.events[0]?.id).toBe('cyclotron-wall');
    expect(s.cyclotron?.energyJ).toBe(plan.arcs.at(-1)?.energyJ);
    const metrics=computeCyclotronExitMetrics(p);
    expect(metrics.discreteMaxJ).toBe(s.cyclotron?.energyJ);
    expect(s.cyclotronMaxEnergyJ).not.toBe(s.cyclotronAnalyticalEnergyJ);
    expect(checkInvariants(s,initial,p).every(x=>x.passed)).toBe(true);
    expect(stepEmDevices(s,p,1).events).toHaveLength(0);
    expect(stepEmDevices(s,p,1).nextState.particlePos).toEqual(s.particlePos);
  });
  it('matches independent Boris integration for each side and is right-continuous at exact gap crossings',()=>{
    const p={...getPreset(0),bFieldT:0.6,cyclotronRadiusM:0.15},plan=getCyclotronPlan(p);
    const L=p.cyclotronRadiusM*0.7/CYCL_DISPLAY_RADIUS;
    for(const a of plan.arcs.slice(0,4)){
      const t0=a.startTau*plan.physicalUnitS,f=sampleCyclotron(p,t0);
      expect(f.gapCount).toBe(a.gapCount);
      let numeric={position:{x:f.position.x*L,y:f.position.y*L,z:0},velocity:{...f.velocityMps,z:0},t:t0};
      const delta=Math.PI*plan.physicalUnitS/3,h=delta/2000;
      for(let i=0;i<2000;i++)numeric=stepBorisPusher(numeric,()=>({E:{x:0,y:0,z:0},B:{x:0,y:0,z:p.bFieldT}}),p.chargeC,p.massKg,h);
      const exact=sampleCyclotron(p,t0+delta);
      expect(Math.hypot(numeric.position.x-exact.position.x*L,numeric.position.y-exact.position.y*L)/(a.radius*p.cyclotronRadiusM)).toBeLessThan(1e-5);
      expect(Math.hypot(numeric.velocity.x-exact.velocityMps.x,numeric.velocity.y-exact.velocityMps.y)/a.speedMps).toBeLessThan(1e-5);
      expect(Math.sign(f.rfVoltageV)).toBe(a.direction);
    }
  });
  it('samples bounded historical arcs without fabricating connecting trajectories',()=>{
    const p=getPreset(0),plan=getCyclotronPlan(p),f=sampleCyclotron(p,plan.endTau*plan.physicalUnitS),history=cyclotronHistory(p,f);
    expect(history.length).toBe(12);
    expect(history).toBe(cyclotronHistory(p,f));
    expect(history[0]?.gapCount).toBe(1);
    for(const path of history){
      const a=plan.arcs[path.gapCount-1]!;
      expect(a.gapCount).toBeLessThanOrEqual(f.arcIndex-7);
      expect(path.points).toHaveLength(25);
      for(const v of path.points){
        const x=v.x*.7/CYCL_DISPLAY_RADIUS,y=v.y*.7/CYCL_DISPLAY_RADIUS;
        expect(Math.hypot(x,y-a.y0+a.direction*a.radius)).toBeCloseTo(a.radius,10);
        expect(Math.hypot(x,y)).toBeLessThanOrEqual(1+1e-9);
      }
    }
    const state=stepEmDevices(createInitialState(p),p,100).nextState;
    const ir=stseEmDevicesSuitePlugin.exportDiagramIR!(state,p);
    expect(ir?.primitives.filter(x=>x.kind==='trajectory')).toHaveLength(history.length+1);
  });
  it('computes relativistic half periods after each actual kick and terminates on loss of accelerating phase',()=>{
    const p={...getPreset(0),bFieldT:3.5,cyclotronRadiusM:1,relativisticDetune:true},plan=getCyclotronPlan(p);
    expect(plan.status).toBe('detuned');
    let expected=0,previousTau=0;
    for(const [i,a] of plan.arcs.entries()){
      const phase=previousTau-i*Math.PI;
      expect(a.phaseSlip).toBeCloseTo(phase,11);
      expect(phase).toBeLessThan(Math.PI/2);
      expected+=p.chargeC*p.cyclotronVoltageV*Math.cos(phase);
      expect(Math.abs(a.energyJ/expected-1)).toBeLessThan(1e-9);
      const gamma=1+expected/(p.massKg*C_LIGHT*C_LIGHT);
      expect(a.gamma).toBeCloseTo(gamma,12);
      expect(a.endTau-a.startTau).toBeCloseTo(Math.PI*gamma,10);
      previousTau+=Math.PI*gamma;
    }
    const init=createInitialState(p),s=stepEmDevices(init,p,100).nextState;
    expect(s.cyclotron?.status).toBe('detuned');
    expect(s.cyclotron!.phaseSlip).toBeGreaterThanOrEqual(Math.PI/2);
    expect(s.cyclotronMaxEnergyJ).toBeLessThan(s.cyclotronAnalyticalEnergyJ);
    expect(checkInvariants(s,init,p).every(x=>x.passed)).toBe(true);
  });
  it('preserves step partition, voltage sensitivity and safe inactive/capped limits',()=>{
    const p={...getPreset(0),bFieldT:0.6,cyclotronRadiusM:0.15};
    const init=createInitialState(p),one=stepEmDevices(init,p,0.8).nextState;
    let many=init;for(let i=0;i<80;i++)many=stepEmDevices(many,p,0.01).nextState;
    expect(many.particlePos.x).toBeCloseTo(one.particlePos.x,10);
    expect(many.particlePos.y).toBeCloseTo(one.particlePos.y,10);
    expect(many.cyclotron?.energyJ).toBe(one.cyclotron?.energyJ);
    for(const patch of [{bFieldT:0},{chargeC:0},{cyclotronVoltageV:0}]){
      const q={...p,...patch},s=createInitialState(q);
      expect(s.cyclotron?.status).toBe('inactive');
      expect(Object.values(s.particlePos).every(Number.isFinite)).toBe(true);
    }
    const high=getCyclotronPlan({...p,bFieldT:4,cyclotronRadiusM:1.2,chargeC:1e-18,massKg:1e-28,cyclotronVoltageV:5000});
    expect(high.arcs.length).toBe(50000);expect(high.status).toBe('limit');
    expect(getCyclotronPlan({...p,cyclotronVoltageV:2*p.cyclotronVoltageV}).arcs.length).toBeLessThan(getCyclotronPlan(p).arcs.length);
  });

  it('flips Hall voltage sign between electron and hole (< 1e-8) and maximizes MHD power at R = r', () => {
    const pElec = getPreset(1);
    const uElec = computeHallVoltageV(pElec);
    const uHole = computeHallVoltageV({ ...pElec, carrierType: 'hole' });
    expect(uElec).toBeLessThan(0);
    expect(uHole).toBeGreaterThan(0);
    expect(Math.abs(uElec + uHole)).toBeLessThan(1e-8);

    const pMhd = getPreset(2);
    const mMatch = computeMhdMetrics(pMhd);
    const mAtExactR = computeMhdMetrics({ ...pMhd, mhdLoadOhm: mMatch.internalOhm });
    const mLowR = computeMhdMetrics({ ...pMhd, mhdLoadOhm: mMatch.internalOhm * 0.5 });
    const mHighR = computeMhdMetrics({ ...pMhd, mhdLoadOhm: mMatch.internalOhm * 2.0 });
    expect(Math.abs(mAtExactR.outputWatt - mAtExactR.maxPowerWatt)).toBeLessThan(1e-8);
    expect(mAtExactR.outputWatt).toBeGreaterThan(mLowR.outputWatt);
    expect(mAtExactR.outputWatt).toBeGreaterThan(mHighR.outputWatt);
  });

  it('uses signed Hall drift, force direction and a common lower-minus-upper reference',()=>{
    const base=getPreset(1),e=1.602176634e-19,expected=base.hallCurrentA*base.bFieldT/(base.hallDensityPerM3*e*base.hallThicknessM);
    for(const carrierType of ['electron','hole'] as const){
      const p={...base,carrierType},sign=carrierType==='electron'?-1:1;
      const init=createInitialState(p),s=stepEmDevices(init,p,.2).nextState;
      expect(s.hallVoltageV).toBeCloseTo(sign*expected,12);
      expect(Math.sign(s.particlePos.x-init.particlePos.x)).toBe(sign);
      expect(Math.sign(s.particleVel.x)).toBe(sign);
      const diagram=getDeviceSchematic(p.device,p);
      expect(diagram.cues.find(c=>c.id==='hall-carrier-drift')?.dx).toBeCloseTo(sign*.96,12);
      expect(diagram.cues.find(c=>c.id==='hall-equilibrium-electric')?.dy).toBeCloseTo(sign*.26,12);
      expect(diagram.cues.find(c=>c.id==='hall-magnetic-force')?.dy).toBeLessThan(0);
      expect(diagram.labels.some(l=>l.text===('下 '+(sign>0?'＋':'−')))).toBe(true);
      const wrapped=stepEmDevices(init,p,3).nextState;
      expect(wrapped.trail).toHaveLength(1);
      expect(Math.abs(wrapped.particlePos.x)).toBeLessThanOrEqual(1.35);
      const zero={...p,hallCurrentA:0},z=createInitialState(zero);
      expect(stepEmDevices(z,zero,1).nextState.particlePos).toEqual(z.particlePos);
      expect(getDeviceSchematic(zero.device,zero).cues).toHaveLength(0);
    }
    expect(computeHallVoltageV({...base,bFieldT:0})).toBe(0);
  });
  it('distinguishes MHD open and loaded voltage and independently checks power, current and electrode signs',()=>{
    const p=getPreset(2),s=createInitialState(p);
    expect(s.mhdEmfV).toBeCloseTo(960,10);expect(s.mhdInternalOhm).toBeCloseTo(.8,12);
    expect(s.mhdLoadCurrentA).toBeCloseTo(600,10);expect(s.mhdTerminalVoltageV).toBeCloseTo(480,10);
    expect(s.mhdOutputWatt).toBeCloseTo(288000,7);expect(s.mhdInternalLossWatt).toBeCloseTo(288000,7);
    expect(checkInvariants(s,s,p)[0]?.passed).toBe(true);
    expect(getDeviceSchematic(p.device,p).cues.find(c=>c.id==='mhd-load-current')?.dx).toBeLessThan(0);
    expect(getDeviceSchematic(p.device,p).labels.some(l=>l.text==='下 ＋')).toBe(true);
    const zero=createInitialState({...p,bFieldT:0});
    expect(zero.mhdLoadCurrentA).toBe(0);expect(zero.mhdOutputWatt).toBe(0);
  });
  it('recovers volume flow independently of the open circuit voltage and retains flow at B=0',()=>{
    const p={...getPreset(2),device:'em-flowmeter' as const,bFieldT:1,flowDiameterM:.2,particleSpeedMps:100};
    const s=createInitialState(p);
    expect(s.flowVoltageV).toBeCloseTo(20,12);expect(s.flowRateM3ps).toBeCloseTo(Math.PI,12);
    expect(Math.PI*p.flowDiameterM*s.flowVoltageV/(4*p.bFieldT)).toBeCloseTo(s.flowRateM3ps,12);
    const zero=createInitialState({...p,bFieldT:0});
    expect(zero.flowVoltageV).toBe(0);expect(zero.flowRateM3ps).toBe(s.flowRateM3ps);
    expect(getDeviceSchematic(p.device,p).labels.some(l=>l.text==='下 ＋')).toBe(true);
  });

  it('handles dt=0 cleanly across all 6 devices without NaN', () => {
    for (const dev of ['velocity-selector', 'mass-spectrometer', 'cyclotron', 'hall-sensor', 'mhd-generator', 'em-flowmeter'] as const) {
      const p: EmDevicesParams = { ...getPreset(0), device: dev };
      const st = createInitialState(p);
      expect(stepEmDevices(st, p, 0).nextState.t).toBe(0);
      expect(Number.isFinite(st.selectedSpeed)).toBe(true);
    }
  });
});
