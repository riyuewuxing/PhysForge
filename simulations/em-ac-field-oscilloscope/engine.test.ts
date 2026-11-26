import { resolvePluginParams } from '@physforge/sim-sdk';
import { describe, expect, it } from 'vitest';
import { emAcFieldOscilloscopePlugin } from './plugin.js';
import { acScopePresets } from './presets.js';
import {
  computeObservables,
  solveDeflectionAxis,
  sampleCrt,
  isCrtContinuouslyLit,
  CRT_SCREEN_RADIUS,
  equivalentMetrics,
  createInitialState,
  integrateDeflectionTrajectory,
  stepAcScope,
  type AcScopeParams
} from './engine.js';

function getPreset(idx: number): AcScopeParams {
  return resolvePluginParams(emAcFieldOscilloscopePlugin.paramSchema, acScopePresets[idx]!.params);
}

describe('em-ac-field-oscilloscope physics invariants (E03)', () => {
  it('matches oscilloscope plate deflection formula within < 1e-6 via numerical RK4 verification', () => {
    const { numericY, analyticalY } = integrateDeflectionTrajectory(1200, 80);
    expect(numericY).not.toBeNull();expect(analyticalY).not.toBeNull();
    const relErr = Math.abs(numericY! - analyticalY!) / Math.abs(analyticalY!);
    expect(relErr).toBeLessThan(1e-6);
  });

  it('yields zero net displacement (< 1e-7 m) over one full square-wave period for particle released at t0 = T/4', () => {
    const params = getPreset(0); // square-wave T=2.0s => t0 = 0.5s, one full period later = 2.5s
    let state = createInitialState(params);
    const steps = 125; // dt = 0.02s => 2.50s
    for (let i = 0; i < steps; i++) {
      state = stepAcScope(state, params, 0.02).nextState;
    }
    const quarterParticle = state.particles[2]!;
    expect(quarterParticle.t0Frac).toBe(0.25);
    expect(Math.abs(quarterParticle.x)).toBeLessThan(1e-7);
    expect(Math.abs(quarterParticle.v)).toBeLessThan(1e-7);

    // Meanwhile t0=0 particle advances strictly monotonically forward
    expect(state.particles[0]!.x).toBeGreaterThan(2.0);
  });

  it('conserves equivalent-gravity pendulum total energy within < 1e-5', () => {
    const params = getPreset(2);
    let state = createInitialState(params);
    const e0 = state.initialEqEnergy;
    for (let i = 0; i < 150; i++) {
      state = stepAcScope(state, params, 0.02).nextState;
    }
    const obs = computeObservables(state, params);
    const relErr = Math.abs(obs.eqTotalEnergy! - e0) / Math.max(1, Math.abs(e0));
    expect(relErr).toBeLessThan(1e-5);
  });

  it('handles zero acceleration and zero dt cleanly without NaN', () => {
    const p0: AcScopeParams = { ...getPreset(0), accelA0: 0 };
    const s0 = createInitialState(p0);
    expect(stepAcScope(s0, p0, 0).nextState).toEqual(s0);
    const s1 = stepAcScope(s0, p0, 0.1).nextState;
    expect(Number.isFinite(s1.particles[0]!.x)).toBe(true);
  });
});

describe('H33 E03 independent analytical and physical boundary regressions',()=>{
  it('advances all square-wave cycles in one coarse step and retains exact boundary events',()=>{
    const p=getPreset(0),s=createInitialState(p),r=stepAcScope(s,p,40);
    expect(r.nextState.t).toBe(40);
    expect(r.nextState.particles[0]!.x).toBeCloseTo(80,10);
    expect(r.nextState.particles[0]!.v).toBeCloseTo(0,10);
    expect(r.events.filter(e=>e.id.startsWith('ac-flip-'))).toHaveLength(40);
    expect(r.events.at(-1)!.time).toBeCloseTo(40,10);
    const a=stepAcScope(s,p,1),b=stepAcScope(a.nextState,p,1);
    expect(a.events.filter(e=>e.id.startsWith('ac-flip-')).map(e=>e.time)).toEqual([1]);
    expect(b.events.filter(e=>e.id.startsWith('ac-flip-')).map(e=>e.time)).toEqual([2]);
    const q=stepAcScope(s,p,.5).nextState.particles[2]!;
    expect(q.active).toBe(true);expect(q.x).toBe(0);expect(q.v).toBe(0);
  });
  it('matches the independent sine primitive for an entire period and for every release phase',()=>{
    const p=getPreset(3),init=createInitialState(p);
    const full=stepAcScope(init,p,2).nextState;
    expect(full.particles[0]!.x).toBeCloseTo(10/Math.PI,10);
    expect(full.particles[0]!.v).toBeCloseTo(0,10);
    const coarse=stepAcScope(init,p,2.5).nextState;
    expect(coarse.particles[2]!.x).toBeCloseTo(0,10);
    expect(coarse.particles[2]!.v).toBeCloseTo(0,10);
    let fine=init;for(let i=0;i<100;i++)fine=stepAcScope(fine,p,.025).nextState;
    for(let i=0;i<4;i++){
      expect(coarse.particles[i]!.x).toBeCloseTo(fine.particles[i]!.x,9);
      expect(coarse.particles[i]!.v).toBeCloseTo(fine.particles[i]!.v,9);
    }
  });
  it('uses the actual signal phase at t=0 and excludes blocked or out-of-screen beam samples',()=>{
    const p=getPreset(1),s=createInitialState(p);
    expect(s.screenX).toBeCloseTo(0,10);
    expect(s.screenY).toBeCloseTo(11/3,10);
    const block={...p,uAccelV:400,uYMaxV:200};
    const blocked=createInitialState(block);
    expect(blocked.screenY).toBeNull();
    expect(blocked.scopeTrail).toHaveLength(0);
    const noBeam={...p,uAccelV:0};
    const n=stepAcScope(createInitialState(noBeam),noBeam,1).nextState;
    expect(n.screenX).toBeNull();expect(n.screenY).toBeNull();
    const miss={...p,uXMaxV:145,uYMaxV:145,freqRatioYOverX:1,phaseDeltaDeg:0};
    const m=stepAcScope(createInitialState(miss),miss,miss.periodT/4).nextState;
    expect(m.screenX).toBeNull();expect(m.screenY).toBeNull();
  });
  it('uses all three forces of a rigid rod and distinguishes compression from tension',()=>{
    const p={...getPreset(2),eqFieldAccelX:0,eqFieldAccelY:12,initialAngleDeg:0};
    const s=createInitialState(p),f=emAcFieldOscilloscopePlugin.getForceVectors!(s,p);
    expect(f).toHaveLength(3);
    expect(f.reduce((y,v)=>y+v.force.y,0)).toBeCloseTo(0,10);
    const z={...p,eqFieldAccelY:9.8,initialAngleDeg:35};
    const zs=stepAcScope(createInitialState(z),z,4).nextState;
    expect(zs.theta).toBeCloseTo(35*Math.PI/180,10);
    expect(zs.omega).toBeCloseTo(0,10);
    expect(computeObservables(zs,z).gEffMag).toBe(0);
  });
});

describe('H33 E03 contact, real screen samples and geometry',()=>{
  it('locates contact at the actual physical plate instead of extrapolating a screen hit',()=>{
    const r=solveDeflectionAxis(400,200);
    expect(r.status).toBe('plate-hit');
    expect(r.contactY).toBe(.01);
    expect(r.contactTime).not.toBeNull();
    expect(r.contactTime!).toBeCloseTo(Math.sqrt(.02/(1.75882001076e11*200/.02)),15);
    expect(r.exitY).toBeNull();
    expect(integrateDeflectionTrajectory(400,200).numericY).toBeNull();
    expect(solveDeflectionAxis(1200,150).status).toBe('plate-hit');
    expect(solveDeflectionAxis(1200,-150).contactY).toBe(-.01);
    expect(solveDeflectionAxis(0,80).analyticalY).toBeNull();
  });
  it('records only actual lit samples and breaks the trace after a dark interval',()=>{
    const dark={...getPreset(1),uAccelV:400,uYMaxV:200};
    for(let i=0;i<=400;i++)expect(sampleCrt(i*dark.periodT/400,dark).status).not.toBe('lit');
    const p={...dark,uXMaxV:20};
    let s=createInitialState(p);expect(s.beamStatus).toBe('y-plate');
    let wasDark=true,found=false;
    for(let i=0;i<400;i++){
      s=stepAcScope(s,p,.004).nextState;
      const o=computeObservables(s,p);
      if(s.beamStatus==='lit'){
        expect(Math.hypot(s.screenX!,s.screenY!)).toBeLessThanOrEqual(CRT_SCREEN_RADIUS*100+1e-10);
        if(wasDark){expect(s.scopeTrail.at(-1)!.breakBefore).toBe(true);found=true;}
        expect(o.screenXCm).toBe(s.screenX);
      }else expect(o.screenXCm).toBeUndefined();
      wasDark=s.beamStatus!=='lit';
      for(const q of s.scopeTrail)expect(Math.hypot(q.x,q.y)).toBeLessThanOrEqual(6+1e-10);
    }
    expect(found).toBe(true);
  });
  it('fits actual long-time x coordinates without truncating the motion',()=>{
    const p=getPreset(0),s=stepAcScope(createInitialState(p),p,40).nextState;
    const v={width:1024,height:570,dpr:1,scale:1,offsetX:0,offsetY:0},safe={left:30,right:730,top:28,bottom:410};
    const fit=emAcFieldOscilloscopePlugin.fitAcScopeViewport(s,p,v,safe);
    expect(fit).not.toBeNull();
    expect(emAcFieldOscilloscopePlugin.acScopeBoundsFit(s,p,fit!,safe)).toBe(true);
    const ir=emAcFieldOscilloscopePlugin.exportDiagramIR!(s,p);
    expect(ir.primitives.some(q=>q.kind==='circle'&&Math.abs(q.cx-80)<1e-9)).toBe(true);
  });
  it('matches radial reaction and the actual net acceleration for a moving rigid rod',()=>{
    const p=getPreset(2),s=stepAcScope(createInitialState(p),p,.73).nextState,e=equivalentMetrics(s,p),f=emAcFieldOscilloscopePlugin.getForceVectors!(s,p);
    const x=f.reduce((a,v)=>a+v.force.x,0),y=f.reduce((a,v)=>a+v.force.y,0);
    expect(x).toBeCloseTo(e.L*(e.tx*e.thetaDDot-e.rx*s.omega*s.omega),10);
    expect(y).toBeCloseTo(e.L*(e.ty*e.thetaDDot-e.ry*s.omega*s.omega),10);
  });
});

describe('H33 short dark interval cannot bridge the phosphor trace',()=>{
  it('detects a hidden plate contact between two lit endpoints without oversampling',()=>{
    const p={...getPreset(1),periodT:2,uAccelV:1200,uXMaxV:150.0001,uYMaxV:0};
    expect(sampleCrt(.498,p).status).toBe('lit');
    expect(sampleCrt(.5,p).status).toBe('x-plate');
    expect(sampleCrt(.502,p).status).toBe('lit');
    expect(isCrtContinuouslyLit(.498,.502,p)).toBe(false);
    const a=stepAcScope(createInitialState(p),p,.498).nextState;
    const b=stepAcScope(a,p,.004).nextState;
    expect(b.scopeTrail.at(-1)!.breakBefore).toBe(true);
    const safe={...p,uXMaxV:140};
    expect(isCrtContinuouslyLit(.498,.502,safe)).toBe(true);
  });
  it('detects a screen-only miss between two lit endpoints with neither axis contacting a plate',()=>{
    const p={...getPreset(1),periodT:2,uAccelV:1200,uXMaxV:127.28,uYMaxV:127.28,freqRatioYOverX:1,phaseDeltaDeg:0};
    expect(sampleCrt(.498,p).status).toBe('lit');
    expect(sampleCrt(.5,p).status).toBe('screen-miss');
    expect(sampleCrt(.502,p).status).toBe('lit');
    expect(isCrtContinuouslyLit(.498,.502,p)).toBe(false);
    const a=stepAcScope(createInitialState(p),p,.498).nextState;
    expect(stepAcScope(a,p,.004).nextState.scopeTrail.at(-1)!.breakBefore).toBe(true);
    const safe={...p,uXMaxV:110,uYMaxV:110};
    expect(isCrtContinuouslyLit(.498,.502,safe)).toBe(true);
  });
});
