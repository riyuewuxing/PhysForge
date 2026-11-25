import { describe, expect, it } from 'vitest';
import { degToRad } from '@physforge/physics-core';
import {
  checkInvariants,
  computeObservables,
  createInitialState,
  fresnelPowerUnpolarized,
  stepOptics,
  type OpticsParams
} from './engine.js';

const baseParams: OpticsParams = {
  sceneMode: 'tir-interface',
  incidentAngleDeg: 30,
  n1: 1.5,
  n2: 1.0,
  slabThickness: 1.0,
  prismApexDeg: 60,
  fiberHalfWidth: 0.3,
  wavelengthNm: 600,
  slitSeparationMm: 0.5,
  screenDistanceM: 1.5,
  animateSweep: false
};

describe('optics-ray-studio engine', () => {
  it('uses physical unpolarized Fresnel power fractions, including matched indices and TIR', () => {
    expect(fresnelPowerUnpolarized(1,1.5,0).R).toBeCloseTo(.04,12);
    expect(fresnelPowerUnpolarized(1.5,1.5,60)).toEqual({R:0,T:1});
    expect(fresnelPowerUnpolarized(1.5,1,45)).toEqual({R:1,T:0});
    const theta=degToRad(35), ci=Math.cos(theta), ct=Math.sqrt(1-(1.5*Math.sin(theta))**2);
    // Independent transmitted-power expression using electric-field
    // coefficients and the normal Poynting-flux factor.
    const ts=2*1.5*ci/(1.5*ci+ct), tp=2*1.5*ci/(ci+1.5*ct);
    const expectedT=ct/(1.5*ci)*(ts*ts+tp*tp)/2;
    const state=createInitialState({...baseParams,incidentAngleDeg:35});
    expect(state.interfaceTransmittance).toBeCloseTo(expectedT,12);
    expect(state.interfaceReflectance).toBeCloseTo(1-expectedT,12);
    expect(state.rays.find(r=>r.label==='折射光')?.intensity).toBeCloseTo(expectedT,12);
    expect(state.rays.find(r=>r.label==='反射光')?.intensity).toBeCloseTo(1-expectedT,12);
    const matched=createInitialState({...baseParams,n2:1.5});
    expect(matched.rays.some(r=>r.label==='反射光')).toBe(false);
    const crit=createInitialState({...baseParams,incidentAngleDeg:Math.asin(2/3)*180/Math.PI});
    expect(crit.interfaceTransmittance).toBe(0);
    expect(crit.rays.some(r=>r.label==='折射光')).toBe(false);
  });

  it('satisfies Snell law and triggers exact critical angle total internal reflection', () => {
    // n1=1.5, n2=1.0 -> critical angle arcsin(2/3) ≈ 41.8103°
    const belowCrit = createInitialState({ ...baseParams, incidentAngleDeg: 30 });
    expect(belowCrit.isTotalInternalReflection).toBe(false);
    expect(belowCrit.criticalAngleDeg!).toBeCloseTo(41.8103149, 5);
    const expectedTheta2 = Math.asin((1.5 * Math.sin(degToRad(30))) / 1.0);
    expect(degToRad(belowCrit.refractedAngleDeg!)).toBeCloseTo(expectedTheta2, 8);
    expect(checkInvariants(belowCrit, belowCrit, baseParams)[0]?.passed).toBe(true);

    const aboveCrit = createInitialState({ ...baseParams, incidentAngleDeg: 45 });
    expect(aboveCrit.isTotalInternalReflection).toBe(true);
    expect(aboveCrit.refractedAngleDeg).toBeNull();
  });

  it('matches analytical parallel-slab lateral displacement (< 1e-6)', () => {
    const slabParams: OpticsParams = {
      ...baseParams,
      sceneMode: 'parallel-slab',
      incidentAngleDeg: 50,
      n1: 1.5,
      slabThickness: 1.2
    };
    const s = createInitialState(slabParams);
    const theta1 = degToRad(50);
    const theta2 = Math.asin(Math.sin(theta1) / 1.5);
    const exactShift = (1.2 * Math.sin(theta1 - theta2)) / Math.cos(theta2);
    expect(Math.abs(s.lateralShift - exactShift)).toBeLessThan(1e-6);
  });

  it('matches analytical double-slit fringe spacing Δx = L*λ/d', () => {
    const slitParams: OpticsParams = {
      ...baseParams,
      sceneMode: 'double-slit',
      wavelengthNm: 600,
      slitSeparationMm: 0.5,
      screenDistanceM: 1.5
    };
    const s = createInitialState(slitParams);
    // (1.5 * 600e-9 / 0.5e-3) * 1e3 = 1.8 mm
    expect(s.fringeSpacingMm).toBeCloseTo(1.8, 10);
  });

  it('starts the sweep at the configured incident angle without a discontinuity', () => {
    const sweepingParams = { ...baseParams, incidentAngleDeg: 35, animateSweep: true };
    const initial = createInitialState(sweepingParams);
    expect(initial.activeAngleDeg).toBe(35);

    const firstStep = stepOptics(initial, sweepingParams, 1 / 240).nextState;
    expect(Math.abs(firstStep.activeAngleDeg - initial.activeAngleDeg)).toBeLessThan(0.2);
  });

  it('handles optical fiber TIR guidance and dt=0 without NaN', () => {
    const fiber = createInitialState({
      ...baseParams,
      sceneMode: 'optical-fiber',
      incidentAngleDeg: 20,
      n1: 1.6,
      n2: 1.4
    });
    expect(fiber.isTotalInternalReflection).toBe(true);
    const stepped = stepOptics(fiber, { ...baseParams, sceneMode: 'optical-fiber' }, 0).nextState;
    const obs = computeObservables(stepped);
    for (const v of Object.values(obs)) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe('H9 independent non-interface optical geometry', () => {
  it('represents the focal plane as parallel emergent rays, not a fictitious finite image', () => {
    const p:OpticsParams={...baseParams,sceneMode:'thin-lens-imaging',focalLengthM:.65,objectDistanceM:.65};
    const s=createInitialState(p);
    expect(s.imageDistanceM).toBeUndefined();
    expect(s.magnification).toBeUndefined();
    expect(computeObservables(s)).not.toHaveProperty('imageDistanceM');
    const outgoing=s.rays.filter(r=>!r.dashed&&Math.abs(r.from.x)<1e-10&&r.to.x>0);
    expect(outgoing.length).toBeGreaterThanOrEqual(2);
    for(const r of outgoing) expect((r.to.y-r.from.y)/(r.to.x-r.from.x)).toBeCloseTo(-.55/.65,10);
  });
  it('starts both real outgoing principal rays at the lens and back-projects virtual rays from that same plane', () => {
    for(const u of [.45,1.4]){
      const p:OpticsParams={...baseParams,sceneMode:'thin-lens-imaging',focalLengthM:.65,objectDistanceM:u};
      const s=createInitialState(p),v=u*.65/(u-.65),y=-.55*v/u;
      const outgoing=s.rays.filter(r=>!r.dashed&&Math.abs(r.from.x)<1e-10&&r.to.x>0);
      expect(outgoing.length).toBeGreaterThanOrEqual(2);
      for(const r of outgoing) expect(r.from.y+(r.to.y-r.from.y)/(r.to.x-r.from.x)*v).toBeCloseTo(y,10);
      if(u<.65){
        const dashed=s.rays.filter(r=>r.dashed);
        expect(dashed.length).toBeGreaterThanOrEqual(2);
        for(const r of dashed){
          expect(r.from.x).toBe(0);
          expect(r.from.y+(r.to.y-r.from.y)/(r.to.x-r.from.x)*v).toBeCloseTo(y,10);
        }
      }
    }
  });
  it('does not replace the requested fiber indices or zero axial incidence with hidden clamps', () => {
    const p:OpticsParams={...baseParams,sceneMode:'optical-fiber',incidentAngleDeg:0,n1:1.6,n2:1.4};
    const s=createInitialState(p);
    expect(s.rays[0]!.from.y).toBe(0);
    expect(s.rays.filter(r=>r.color==='#38bdf8').every(r=>r.from.y===0&&r.to.y===0)).toBe(true);
    const equal=createInitialState({...p,n2:1.6,incidentAngleDeg:45});
    expect(equal.criticalAngleDeg).toBeNull();
    expect(equal.isTotalInternalReflection).toBe(false);
    const inverted=createInitialState({...p,n2:1.8,incidentAngleDeg:45});
    expect(inverted.criticalAngleDeg).toBeNull();
    expect(inverted.isTotalInternalReflection).toBe(false);
  });
  it('reports real transmitted power and parallel displacement from ray geometry through an air-glass-air slab', () => {
    const p:OpticsParams={...baseParams,sceneMode:'parallel-slab',incidentAngleDeg:0,n1:1.5};
    const s=createInitialState(p);
    expect(s.rays.find(r=>r.label==='出射光')?.intensity).toBeCloseTo(.96*.96,12);
    expect(s.lateralShift).toBe(0);
    const matched=createInitialState({...p,n1:1});
    expect(matched.rays.find(r=>r.label==='出射光')?.intensity).toBe(1);
    const angled=createInitialState({...p,incidentAngleDeg:65});
    const first=angled.rays[0]!,last=angled.rays.find(r=>r.label==='出射光')!;
    const dx=first.to.x-first.from.x,dy=first.to.y-first.from.y;
    expect(Math.abs((last.from.x-first.from.x)*dy-(last.from.y-first.from.y)*dx)/Math.hypot(dx,dy)).toBeCloseTo(angled.lateralShift,10);
  });
  it('does not treat a prism internal reflection as a transmitted ray or fabricate a zero deviation when no yellow ray emerges', () => {
    const p:OpticsParams={...baseParams,sceneMode:'prism-dispersion',incidentAngleDeg:5,n1:2.2,prismApexDeg:75};
    const s=createInitialState(p);
    const h=1.6,b=h*Math.tan(75*Math.PI/360);
    const inside=(x:number,y:number)=>y>=-.4*h-1e-8&&y<=.6*h+1e-8&&Math.abs(x)<=b*(.6*h-y)/h+1e-8;
    for(const r of s.rays.filter(r=>r.label==='全反射光')) expect(inside(r.to.x,r.to.y)).toBe(true);
    expect(s.rays.some(r=>r.label==='全反射光')).toBe(true);
    expect(s.rays.filter(r=>r.label==='出射光').every(r=>!inside(r.to.x,r.to.y))).toBe(true);
  });
});

describe('H9 independent optical limits',()=>{
  it('matches the independent scalar prism deviation for the direct yellow band and normal dispersion order',()=>{
    const p:OpticsParams={...baseParams,sceneMode:'prism-dispersion',incidentAngleDeg:45,n1:1.52,prismApexDeg:60};
    const s=createInitialState(p),i=Math.PI/4,A=Math.PI/3,r1=Math.asin(Math.sin(i)/1.52),r2=A-r1;
    const expected=(i+Math.asin(1.52*Math.sin(r2))-A)*180/Math.PI;
    expect(s.prismDeviationDeg).toBeCloseTo(expected,9);
    const incoming=s.rays[0]!,a=Math.atan2(incoming.to.y-incoming.from.y,incoming.to.x-incoming.from.x);
    const dev=(color:string)=>{const ray=s.rays.find(r=>r.color===color&&r.label==='出射光')!;return Math.abs(Math.atan2(ray.to.y-ray.from.y,ray.to.x-ray.from.x)-a);};
    expect(dev('#ef4444')).toBeLessThan(dev('#eab308'));expect(dev('#eab308')).toBeLessThan(dev('#a855f7'));
  });
  it('checks air acceptance angle and the geometry of a finite fiber leak at the parameter boundary',()=>{
    const p:OpticsParams={...baseParams,sceneMode:'optical-fiber',n1:1.5,n2:1.49,incidentAngleDeg:45,fiberHalfWidth:.3};
    const s=createInitialState(p);
    expect(s.fiberAcceptanceDeg).toBeCloseTo(Math.asin(Math.sqrt(1.5**2-1.49**2))*180/Math.PI,10);
    expect(s.isTotalInternalReflection).toBe(false);
    const leak=s.rays.find(r=>r.label==='进入包层')!;
    expect(leak.from.y).toBeCloseTo(.3,10);expect(leak.to.y).toBeLessThanOrEqual(.55+1e-10);
    expect(leak.to.x).toBeLessThanOrEqual(2.4+1e-10);
  });
});
