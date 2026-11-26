import { resolvePluginParams } from '@physforge/sim-sdk';
import { describe, expect, it } from 'vitest';
import { emEddyVortexFieldPlugin } from './plugin.js';
import { eddyVortexPresets } from './presets.js';
import {
  computeClosedLoopCirculation,
  evalVortexField,
  computeObservables,
  checkInvariants,
  createInitialState,
  stepEddyVortex,
  type EddyVortexParams
} from './engine.js';

function getPreset(idx: number): EddyVortexParams {
  return resolvePluginParams(emEddyVortexFieldPlugin.paramSchema, eddyVortexPresets[idx]!.params);
}

describe('em-eddy-vortex-field Maxwell circulation & damping (E06)', () => {
  it('verifies closed-loop line integral \\oint E.dl = -dPhi/dt within < 1e-8 inside, outside, and off-center', () => {
    const Rc = 1.2;
    const bDot = 1.5;

    // 1. Inside core (r = 0.7 < Rc)
    const cIn = computeClosedLoopCirculation(0.7, Rc, bDot, 0);
    expect(Math.abs(cIn.lineIntegral - cIn.negDPhiDt) / Math.abs(cIn.negDPhiDt)).toBeLessThan(1e-8);

    // 2. Surrounding entire cylinder (r = 1.8 > Rc)
    const cOut = computeClosedLoopCirculation(1.8, Rc, bDot, 0);
    expect(Math.abs(cOut.lineIntegral - cOut.negDPhiDt) / Math.abs(cOut.negDPhiDt)).toBeLessThan(1e-8);

    // 3. Off-center circular loop completely inside magnetic core (offset = 0.3, r = 0.6)
    const cOff = computeClosedLoopCirculation(0.6, Rc, bDot, 0.3);
    expect(Math.abs(cOff.lineIntegral - cOff.negDPhiDt) / Math.abs(cOff.negDPhiDt)).toBeLessThan(1e-8);
  });

  it('demonstrates strong eddy damping in solid plate vs minimal damping in slotted plate', () => {
    const damp = getPreset(1);
    let st = createInitialState(damp);
    for (let i = 0; i < 250; i++) {
      st = stepEddyVortex(st, damp, 0.02).nextState;
    }
    expect(Math.hypot(st.solidTheta, st.solidOmega)).toBeLessThan(
      0.3 * Math.hypot(st.slottedTheta, st.slottedOmega)
    );
  });

  it('handles zero Bdot and zero dt boundaries cleanly', () => {
    const p0: EddyVortexParams = { ...getPreset(0), bDotRate: 0 };
    const s0 = createInitialState(p0);
    expect(stepEddyVortex(s0, p0, 0).nextState).toEqual(s0);
    const s1 = stepEddyVortex(s0, p0, 0.05).nextState;
    expect(Number.isFinite(s1.px)).toBe(true);
  });
});

describe('E06 signed induction, true overlap, independent energy and mode isolation',()=>{
  it('checks intersecting and tangent loop circulation against independent two-circle lens area',()=>{
    const lens=2*Math.PI/3-Math.sqrt(3)/2;
    for(const d of [-1,1])for(const bDot of [-2,2]){
      const o=computeClosedLoopCirculation(1,1,bDot,d);
      expect(o.negDPhiDt).toBeCloseTo(-bDot*lens,12);
      expect(o.lineIntegral).toBeCloseTo(-bDot*lens,10);
    }
    for(const d of [2,2.001,2.5,-3]){
      const o=computeClosedLoopCirculation(1,1,2,d);
      expect(Math.abs(o.negDPhiDt)).toBeLessThan(1e-12);
      expect(Math.abs(o.lineIntegral)).toBeLessThan(1e-10);
    }
  });
  it('has signed continuous inner/outer field and vanishing circulation at zero ramp',()=>{
    const Rc=1.2;
    for(const bDot of [-3,0,3]){
      const inside=evalVortexField(.6,0,Rc,bDot),at=evalVortexField(Rc,0,Rc,bDot),outside=evalVortexField(2*Rc,0,Rc,bDot);
      expect(inside.Ey).toBeCloseTo(-.3*bDot,12);
      expect(at.Ey).toBeCloseTo(-.6*bDot,12);
      expect(outside.Ey).toBeCloseTo(-.3*bDot,12);
      expect(evalVortexField(0,0,Rc,bDot)).toEqual({Ex:0,Ey:0});
      const across=evalVortexField(Rc+1e-9,0,Rc,bDot);
      expect(across.Ey).toBeCloseTo(at.Ey,8);
    }
  });
  it('captures exact inertial core exit without moving the inactive pendulums',()=>{
    const p={...getPreset(0),cylinderRadiusR:1.2,particleInitRadius:.6,particleChargeRatio:0,bDotRate:0,bField0:1};
    const init=createInitialState(p),end=stepEddyVortex(init,p,2).nextState;
    const expected=Math.sqrt(1.2**2-.6**2)/.6;
    expect(end.px).toBeCloseTo(.6,12);expect(end.py).toBeCloseTo(-1.2,12);
    expect(end.events).toHaveLength(1);
    expect(end.events[0]!.time).toBeCloseTo(expected,9);
    expect(end.solidTheta).toBe(init.solidTheta);expect(end.solidOmega).toBe(init.solidOmega);
    expect(end.slottedTheta).toBe(init.slottedTheta);expect(end.slottedOmega).toBe(init.slottedOmega);
    const o=computeObservables(end,p);
    expect(o.solidAngleDeg).toBeUndefined();
    expect(o.specificElectricWork).toBe(0);
    expect(o.specificEnergyResidual).toBeCloseTo(0,12);
  });
  it('keeps kinetic energy in a pure magnetic field, with signed charge and an absolute analytic orbit',()=>{
    for(const eta of [-1,1]){
      const p={...getPreset(0),cylinderRadiusR:1.8,particleInitRadius:.3,particleChargeRatio:eta,bDotRate:0,bField0:2};
      const init=createInitialState(p),end=stepEddyVortex(init,p,Math.PI/4).nextState;
      // v(0)=(0,-.6), v rotates with angular speed -eta B.
      const w=eta*2;
      expect(end.px).toBeCloseTo(.3+.6*(Math.cos(w*Math.PI/4)-1)/w,7);
      expect(end.py).toBeCloseTo(-.6*Math.sin(w*Math.PI/4)/w,7);
      expect(end.vx).toBeCloseTo(-.6*Math.sin(w*Math.PI/4),7);
      expect(end.vy).toBeCloseTo(-.6*Math.cos(w*Math.PI/4),7);
      const o=computeObservables(end,p);
      expect(o.specificElectricWork).toBe(0);
      expect(o.specificKineticEnergy).toBeCloseTo(.18,8);
      expect(checkInvariants(end,init,p).every(r=>r.passed)).toBe(true);
    }
  });
  it('balances the electric work ledger for a ramp and both charge signs',()=>{
    for(const eta of [-1.6,1.6]){
      const p={...getPreset(0),particleChargeRatio:eta,bDotRate:1.5,cylinderRadiusR:1.8};
      const init=createInitialState(p),end=stepEddyVortex(init,p,.7).nextState,o=computeObservables(end,p);
      expect(o.specificKineticEnergy).toBeCloseTo(.5*(end.vx**2+end.vy**2),12);
      expect(o.specificKineticEnergy!-.18).toBeCloseTo(o.specificElectricWork!,7);
      expect(checkInvariants(end,init,p).every(r=>r.passed)).toBe(true);
    }
  });
  it('records nonnegative dissipated heat and balances both damped pendulums independently',()=>{
    const p=getPreset(1),init=createInitialState(p);
    let s=init;
    for(let i=0;i<250;i++)s=stepEddyVortex(s,p,.02).nextState;
    expect(s.px).toBe(init.px);expect(s.py).toBe(init.py);expect(s.trail).toEqual(init.trail);
    const o=computeObservables(s,p),E0=9.8*p.pendulumLengthL*(1-Math.cos(init.solidTheta));
    expect(o.eVortexMag).toBeUndefined();
    expect(o.solidHeatSpecific).toBeGreaterThan(o.slottedHeatSpecific!);
    expect(o.solidEnergySpecific!+o.solidHeatSpecific!).toBeCloseTo(E0,7);
    expect(o.slottedEnergySpecific!+o.slottedHeatSpecific!).toBeCloseTo(E0,7);
    expect(checkInvariants(s,init,p).every(r=>r.passed)).toBe(true);
    const noDrag={...p,solidDampingGamma:0,slottedDampingGamma:0};
    const z=stepEddyVortex(createInitialState(noDrag),noDrag,5).nextState,zo=computeObservables(z,noDrag);
    expect(z.solidTheta).toBe(z.slottedTheta);expect(zo.solidHeatSpecific).toBe(0);
    expect(zo.solidEnergySpecific).toBeCloseTo(E0,7);
  });
});

describe('E06 short boundary excursion',()=>{
  it('finds an exit between same-side trial endpoints using a radial extremum',()=>{
    const p={...getPreset(0),cylinderRadiusR:1.2,particleChargeRatio:1,bField0:2,bDotRate:0};
    const R=1.2,r=.3,center=R-r+1e-8,w=2,theta0=w*.0004;
    const init={...createInitialState(p),px:center+r*Math.cos(theta0),py:r*Math.sin(theta0),
      vx:w*r*Math.sin(theta0),vy:-w*r*Math.cos(theta0),particleInCore:true};
    // The unbroken inside cyclotron trajectory starts and ends inside;
    // it exits for a short interval near the radial maximum.
    const radiusAt=(t:number)=>Math.hypot(center+r*Math.cos(theta0-w*t),r*Math.sin(theta0-w*t));
    expect(radiusAt(0)).toBeLessThan(R);expect(radiusAt(.001)).toBeLessThan(R);expect(radiusAt(.002)).toBeLessThan(R);
    expect(radiusAt(.0004)).toBeGreaterThan(R);
    const tExit=(theta0-Math.acos((R*R-center*center-r*r)/(2*center*r)))/w;
    const result=stepEddyVortex(init,p,.002).nextState;
    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.time).toBeCloseTo(tExit,9);
    expect(result.particleInCore).toBe(false);
    expect(result.boundaryAmbiguous).toBe(false);
    expect(Math.hypot(result.px,result.py)).toBeGreaterThan(R);
  });
});
