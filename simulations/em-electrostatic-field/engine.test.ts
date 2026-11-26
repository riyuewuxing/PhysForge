import { resolvePluginParams } from '@physforge/sim-sdk';
import { describe, expect, it } from 'vitest';
import { emElectrostaticFieldPlugin } from './plugin.js';
import { electrostaticPresets } from './presets.js';
import {
  createInitialState,
  computeObservables,
  checkInvariants,
  traceFieldLines,
  evalPointChargePotentialAndField,
  extractElectrostaticIsolines,
  solveThreePointUniformField,
  stepElectrostatic,
  type ElectrostaticParams
} from './engine.js';

function getPreset(idx: number): ElectrostaticParams {
  return resolvePluginParams(emElectrostaticFieldPlugin.paramSchema, electrostaticPresets[idx]!.params);
}

describe('em-electrostatic-field physics & numerical verification (E01)', () => {
  it('ensures Marching Squares equipotentials are orthogonal to E field within < 1 deg', () => {
    const params = getPreset(0);
    const contours = extractElectrostaticIsolines(params);
    const deviations: number[] = [];
    for (const c of contours) {
      for (const seg of c.segments) {
        const tx = seg.b.x - seg.a.x;
        const ty = seg.b.y - seg.a.y;
        const tMag = Math.hypot(tx, ty);
        if (tMag < 1e-4) continue;
        const mx = 0.5 * (seg.a.x + seg.b.x);
        const my = 0.5 * (seg.a.y + seg.b.y);
        if (Math.hypot(mx - params.x1, my) < 0.35 || Math.hypot(mx - params.x2, my) < 0.35) continue;
        const { Ex, Ey } = evalPointChargePotentialAndField(mx, my, params);
        const eMag = Math.hypot(Ex, Ey);
        if (eMag < 1e-4) continue;
        const cosAngle = Math.abs((tx * Ex + ty * Ey) / (tMag * eMag));
        const degFrom90 = Math.abs(90 - (Math.acos(Math.min(1, cosAngle)) * 180) / Math.PI);
        deviations.push(degFrom90);
      }
    }
    expect(deviations.length).toBeGreaterThan(20);
    const avgDeviation = deviations.reduce((a, b) => a + b, 0) / deviations.length;
    expect(avgDeviation).toBeLessThan(1.0);
  });

  it('conserves RK45 test-particle energy Ek + q*phi within < 1e-5', () => {
    const params = getPreset(0);
    let state = createInitialState(params);
    const e0 = state.initialEnergy;
    for (let i = 0; i < 60; i++) {
      state = stepElectrostatic(state, params, 0.02).nextState;
    }
    const { phi } = evalPointChargePotentialAndField(state.px, state.py, params);
    const eNow = 0.5 * (state.vx ** 2 + state.vy ** 2) + params.testChargeRatio * phi;
    const relErr = Math.abs(eNow - e0) / Math.max(1e-6, Math.abs(e0));
    expect(relErr).toBeLessThan(1e-5);
  });

  it('solves three-point trisection uniform field & parallel-plate deflection formula accurately (< 1e-6)', () => {
    const threePt = getPreset(2);
    const sol = solveThreePointUniformField(threePt);
    const eqVecX = sol.equalPointOnAC!.x - sol.B.x;
    const eqVecY = sol.equalPointOnAC!.y - sol.B.y;
    // Uniform field E must be strictly perpendicular to equipotential segment B -> equalPointOnAC
    expect(Math.abs(eqVecX * sol.Ex + eqVecY * sol.Ey)).toBeLessThan(1e-10);

    const defl = getPreset(3);
    // Enter at x=-1.4, plates from x=-1.0 to x=1.0 (Lp=2.0), d=2.0, y_exit = U2*Lp^2 / (4*d*U1)
    let st = createInitialState(defl);
    const vx = st.vx;
    const dtToEnter = (-1.0 - st.px) / vx;
    const dtInside = 2.0 / vx;
    st = stepElectrostatic(st, defl, dtToEnter + dtInside).nextState;
    const expectedY = (defl.uDeflectV * 2.0 * 2.0) / (4 * 2.0 * defl.uAccelV);
    expect(Math.abs(st.py - expectedY) / expectedY).toBeLessThan(1e-6);
  });

  it('handles zero charges and zero dt boundaries cleanly', () => {
    const p0: ElectrostaticParams = { ...getPreset(0), q1MicroC: 0, q2MicroC: 0, testChargeRatio: 0 };
    const s0 = createInitialState(p0);
    expect(stepElectrostatic(s0, p0, 0).nextState).toEqual(s0);
    const s1 = stepElectrostatic(s0, p0, 0.1).nextState;
    expect(Number.isFinite(s1.px)).toBe(true);
  });
});

describe('H30 E01 boundary and independent electrostatic contracts',()=>{
  it('constructs a real equipotential segment for every potential ordering and ties',()=>{
    for(const [a,b,c] of [[0,4,12],[0,12,4],[4,0,12],[4,12,0],[12,0,4],[12,4,0],[4,4,12],[4,12,4],[12,4,4],[4,4,4]]){
      const p={...getPreset(2),phiA:a!,phiB:b!,phiC:c!};
      const sol=solveThreePointUniformField(p);
      if(a===b&&b===c){expect(sol.Ex).toBe(0);expect(sol.Ey).toBe(0);expect(sol.construction).toBeNull();continue;}
      const e=sol.construction!;
      expect(e).not.toBeNull();
      expect(Math.hypot(e.end.x-e.start.x,e.end.y-e.start.y)).toBeGreaterThan(0.1);
      expect(sol.Ex*(e.end.x-e.start.x)+sol.Ey*(e.end.y-e.start.y)).toBeCloseTo(0,10);
      expect(sol.A.phi-sol.Ex*(e.end.x-sol.A.x)-sol.Ey*(e.end.y-sol.A.y)).toBeCloseTo(e.start.phi,10);
    }
  });
  it('locates entry and exit exactly independently of frame partition, including negative charge',()=>{
    for(const eta of [-1,1]){
      const p={...getPreset(3),testChargeRatio:eta};
      const vx=Math.sqrt(2*Math.abs(eta)*p.uAccelV);
      const te=0.4/vx, tx=2.4/vx, ey=eta*p.uDeflectV/(4*p.uAccelV*Math.abs(eta))*2;
      for(const h of [0.007,0.19,1.2]){
        let s=createInitialState(p);
        for(let i=0;i<Math.ceil(1.2/h);i++)s=stepElectrostatic(s,p,h).nextState;
        const entry=s.events.find(e=>e.id.startsWith('entry-plate'))!;
        const exit=s.events.find(e=>e.id.startsWith('exit-plate'))!;
        expect(entry.time).toBeCloseTo(te,7);
        expect(exit.time).toBeCloseTo(tx,7);
        expect(exit.position!.x).toBeCloseTo(1,10);
        expect(exit.position!.y).toBeCloseTo(ey,7);
        expect(s.events.filter(e=>e.id.startsWith('exit-plate'))).toHaveLength(1);
      }
    }
  });
  it('stops on a plate before exit and never invents collision dynamics',()=>{
    for(const eta of [-2,2]){
      const p={...getPreset(3),testChargeRatio:eta,uAccelV:4,uDeflectV:16};
      const v=Math.sqrt(2*Math.abs(eta)*p.uAccelV);
      const t=0.4/v+Math.sqrt(2/Math.abs(eta*p.uDeflectV/2));
      const result=stepElectrostatic(createInitialState(p),p,2);
      expect(result.halt).toBe(true);
      expect(result.advancedTime).toBeCloseTo(t,7);
      expect(result.nextState.py).toBeCloseTo(Math.sign(eta),10);
      expect(result.nextState.px).toBeCloseTo(-1+v*(t-0.4/v),7);
      expect(result.nextState.events.some(e=>e.id.startsWith('exit-plate'))).toBe(false);
      expect(stepElectrostatic(result.nextState,p,1).advancedTime).toBe(0);
    }
  });
  it('neutral particle cannot acquire acceleration-stage speed',()=>{
    const p={...getPreset(3),testChargeRatio:0};
    const s=createInitialState(p);
    expect(s.vx).toBe(0);
    const r=stepElectrostatic(s,p,1);
    expect(r.nextState.px).toBe(s.px);
    expect(r.nextState.py).toBe(0);
    expect(r.nextState.events).toHaveLength(0);
  });
});

describe('H30 E01 additional analytical and geometry verification',()=>{
  it('matches the negative gradient of the softened potential and the zero-field midpoint',()=>{
    const p=getPreset(1),h=1e-5;
    for(const [x,y] of [[-0.6,0.4],[0,0.6],[1.9,-0.8]]){
      const f=evalPointChargePotentialAndField(x!,y!,p);
      expect(f.Ex).toBeCloseTo(-(evalPointChargePotentialAndField(x!+h,y!,p).phi-evalPointChargePotentialAndField(x!-h,y!,p).phi)/(2*h),7);
      expect(f.Ey).toBeCloseTo(-(evalPointChargePotentialAndField(x!,y!+h,p).phi-evalPointChargePotentialAndField(x!,y!-h,p).phi)/(2*h),7);
    }
    const f=evalPointChargePotentialAndField(0,0,p);expect(f.Ex).toBe(0);expect(f.Ey).toBe(0);expect(f.phi).toBeGreaterThan(0);
  });
  it('does not invent zero-field contours and orients negative-source lines with E',()=>{
    expect(extractElectrostaticIsolines({...getPreset(2),phiA:4,phiB:4,phiC:4})).toEqual([]);
    const p={...getPreset(0),q1MicroC:0,q2MicroC:-3};
    const lines=traceFieldLines(p);expect(lines.length).toBeGreaterThan(0);
    for(const pts of lines){
      expect(Math.hypot(pts.at(-1)!.x-p.x2,pts.at(-1)!.y)).toBeCloseTo(.18,8);
      for(let i=1;i<pts.length;i++){
        const a=pts[i-1]!,b=pts[i]!,f=evalPointChargePotentialAndField((a.x+b.x)/2,(a.y+b.y)/2,p);
        expect((b.x-a.x)*f.Ex+(b.y-a.y)*f.Ey).toBeGreaterThan(0);
      }
    }
  });
  it('uses work-energy balance in the tube instead of fictitious global potential conservation',()=>{
    for(const eta of [-2,-1,0,1,2])for(const U2 of [-16,0,8,16]){
      const p={...getPreset(3),testChargeRatio:eta,uDeflectV:U2,uAccelV:4};
      const init=createInitialState(p);let state=init;
      for(let i=0;i<100;i++){
        state=stepElectrostatic(state,p,.037).nextState;
        const o=computeObservables(state,p);
        expect(o.totalEnergy).toBeUndefined();
        expect(o.energyResidual).toBeLessThan(1e-8);
        expect(checkInvariants(state,init,p).every(x=>x.passed)).toBe(true);
      }
    }
  });
  it('prioritizes first contact at the simultaneous exit and wall boundary',()=>{
    const p={...getPreset(3),testChargeRatio:1,uAccelV:4,uDeflectV:8};
    const r=stepElectrostatic(createInitialState(p),p,2);
    expect(r.halt).toBe(true);
    expect(r.nextState.px).toBeCloseTo(1,10);
    expect(r.nextState.py).toBe(1);
    expect(r.nextState.events.map(e=>e.id.split('-plate')[0])).toEqual(['entry','hit']);
  });
});

describe('H30 E01 mode-aware teaching contracts',()=>{
  it('does not export charge circles or pretend a tube field is conservative in the other modes',()=>{
    const p=getPreset(3),s=createInitialState(p);
    const ir=emElectrostaticFieldPlugin.exportDiagramIR!(s,p);
    expect(ir.primitives.filter(x=>x.kind==='line'&&x.x1===-1&&x.x2===1&&x.y1===x.y2)).toHaveLength(2);
    expect(ir.primitives.filter(x=>x.kind==='circle')).toHaveLength(1);
    expect(emElectrostaticFieldPlugin.getTelemetryChannels!(p).map(c=>c.key)).not.toContain('totalEnergy');
    expect(emElectrostaticFieldPlugin.getTelemetryChannels!(getPreset(0))[0]!.unit).toBe('Φ₀');
    expect(emElectrostaticFieldPlugin.getTelemetryChannels!(getPreset(2))[0]!.unit).toBe('V');
  });
});
