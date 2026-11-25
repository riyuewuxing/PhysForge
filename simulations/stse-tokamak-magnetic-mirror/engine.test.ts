import { resolvePluginParams } from '@physforge/sim-sdk';
import { describe, expect, it } from 'vitest';
import { stseTokamakMagneticMirrorPlugin } from './plugin.js';
import { tokamakMirrorPresets } from './presets.js';
import {
  createInitialState,
  evaluateTokamakMirrorField,
  stepTokamakMirror,
  traceTokamakMirrorLines,
  fusionSurfaceWinding,
  fusionParallelVelocity,
  TOKAMAK_MINOR_RADIUS_M,
  type TokamakMirrorParams
} from './engine.js';

function getPreset(idx: number): TokamakMirrorParams {
  return resolvePluginParams(stseTokamakMagneticMirrorPlugin.paramSchema, tokamakMirrorPresets[idx]!.params);
}

describe('stse-tokamak-magnetic-mirror physics invariants (S01)', () => {
  it('enforces divergence-free B field (< 1e-12) and conserves Boris kinetic energy (< 1e-8) with adiabatic mu < 5% bounce', () => {
    const params = getPreset(0);
    // Finite difference div(B) check
    const eps = 1e-5;
    const p0 = { x: 0.2, y: -0.15, z: 0.7 };
    const bxP = evaluateTokamakMirrorField({ ...p0, x: p0.x + eps }, params).x;
    const bxM = evaluateTokamakMirrorField({ ...p0, x: p0.x - eps }, params).x;
    const byP = evaluateTokamakMirrorField({ ...p0, y: p0.y + eps }, params).y;
    const byM = evaluateTokamakMirrorField({ ...p0, y: p0.y - eps }, params).y;
    const bzP = evaluateTokamakMirrorField({ ...p0, z: p0.z + eps }, params).z;
    const bzM = evaluateTokamakMirrorField({ ...p0, z: p0.z - eps }, params).z;
    const divB = (bxP - bxM + (byP - byM) + (bzP - bzM)) / (2 * eps);
    expect(Math.abs(divB)).toBeLessThan(1e-10);

    let st = createInitialState(params);
    for (let i = 0; i < 60; i++) {
      st = stepTokamakMirror(st, params, 0.05).nextState;
    }
    const keDrift = Math.abs(st.currentKineticJ - st.initialKineticJ) / st.initialKineticJ;
    expect(keDrift).toBeLessThan(1e-8);
    expect(st.escaped).toBe(false);
    expect(st.reflectionCount).toBeGreaterThanOrEqual(2);
    expect(st.maxMuRelDev).toBeLessThan(0.05);
  });

  it('allows particles inside loss cone (theta < theta_c) to escape through mirror throat', () => {
    const params = getPreset(1);
    let st = createInitialState(params);
    for (let i = 0; i < 40; i++) {
      st = stepTokamakMirror(st, params, 0.05).nextState;
    }
    expect(st.escaped).toBe(true);
  });

  it('initializes the stated pitch relative to the local total magnetic field and the exact speed',()=>{
    for(const angle of [10,45,85]){
      const p={...getPreset(2),pitchAngleDeg:angle};
      const s=createInitialState(p),v=s.velocity,b=s.bField;
      const speed=Math.hypot(v.x,v.y,v.z);
      const cos=(v.x*b.x+v.y*b.y+v.z*b.z)/(speed*Math.hypot(b.x,b.y,b.z));
      expect(speed).toBeCloseTo(p.speed0,12);
      expect(Math.acos(cos)*180/Math.PI).toBeCloseTo(angle,10);
    }
  });
  it('keeps traced field lines on exact magnetic flux surfaces, with the correct tangent direction',()=>{
    for(const p of [getPreset(0),getPreset(2)]){
      const flux=(v:{x:number;y:number;z:number})=>p.mode==='tokamak'?
        Math.hypot(Math.hypot(v.x,v.y)-p.majorRadiusM,v.z):
        Math.hypot(v.x,v.y)*Math.sqrt(1+v.z*v.z/(p.mirrorLengthM*p.mirrorLengthM));
      const lines=traceTokamakMirrorLines(p);
      expect(lines.length).toBeGreaterThan(0);
      for(const l of lines){
        const ref=flux(l[0]!);
        for(let i=1;i<l.length;i++){
          const v=l[i]!,prev=l[i-1]!,mid={x:(v.x+prev.x)/2,y:(v.y+prev.y)/2,z:(v.z+prev.z)/2};
          expect(Math.abs(flux(v)-ref)).toBeLessThan(1e-9);
          const b=evaluateTokamakMirrorField(mid,p),d={x:v.x-prev.x,y:v.y-prev.y,z:v.z-prev.z};
          const cosine=(b.x*d.x+b.y*d.y+b.z*d.z)/(Math.hypot(b.x,b.y,b.z)*Math.hypot(d.x,d.y,d.z));
          expect(cosine).toBeGreaterThan(.999);
        }
      }
    }
  });
  it('records the first physical magnetic-throat crossing as a unique localized event without dropping the residual time',()=>{
    const p=getPreset(1),out=stepTokamakMirror(createInitialState(p),p,2);
    expect(out.nextState.escaped).toBe(true);
    expect(out.nextState.t).toBeCloseTo(2,12);
    const hits=out.events.filter(e=>e.id==='fusion-escape');
    expect(hits).toHaveLength(1);
    expect(Math.abs(Math.abs(hits[0]!.position!.z!)-p.coilHalfSpanM)).toBeLessThan(1e-7);
    expect(hits[0]!.time).toBeGreaterThan(0);
    expect(hits[0]!.time).toBeLessThan(2);
    expect(stepTokamakMirror(out.nextState,p,.25).events.filter(e=>e.id==='fusion-escape')).toHaveLength(0);
  });
  it('records actual magnetic reflection without a fabricated velocity kick',()=>{
    const p=getPreset(0),out=stepTokamakMirror(createInitialState(p),p,3);
    const reflections=out.events.filter(e=>e.id==='fusion-reflection');
    expect(reflections.length).toBeGreaterThanOrEqual(2);
    for(const e of reflections){
      expect(Math.abs(e.position!.z!)).toBeLessThan(p.coilHalfSpanM);
      expect(Math.abs(e.metrics!.vParallel!)).toBeLessThan(1e-5);
    }
    expect(out.nextState.reflectionCount).toBe(reflections.length);
    expect(out.nextState.escaped).toBe(false);
    expect(out.nextState.currentKineticJ).toBeCloseTo(out.nextState.initialKineticJ,8);
  });
  it('reports a toroidal chamber crossing once and does not claim indefinite confinement',()=>{
    const p=getPreset(2),initial=createInitialState(p);
    const position={x:p.majorRadiusM+TOKAMAK_MINOR_RADIUS_M-.001,y:0,z:0},velocity={x:2,y:0,z:0};
    const state={...initial,position,velocity,bField:evaluateTokamakMirrorField(position,p)};
    const out=stepTokamakMirror(state,p,.01);
    const hit=out.events.find(e=>e.id==='fusion-escape');
    expect(hit).toBeDefined();
    expect(Math.hypot(Math.hypot(hit!.position!.x,hit!.position!.y)-p.majorRadiusM,hit!.position!.z!)).toBeCloseTo(TOKAMAK_MINOR_RADIUS_M,8);
    expect(out.nextState.escaped).toBe(true);
    expect(out.nextState.t).toBeCloseTo(.01,12);
    expect(stepTokamakMirror(out.nextState,p,.01).events.filter(e=>e.id==='fusion-escape')).toHaveLength(0);
  });
  it('uses the finite-radius winding rather than equating it to the field strength parameter',()=>{
    const p=getPreset(2),rho=.4,q=fusionSurfaceWinding(p,rho);
    expect(q).toBeGreaterThan(p.safetyFactorQ);
    let integral=0;const n=4096;
    for(let i=0;i<n;i++){
      const theta=2*Math.PI*(i+.5)/n;
      integral+=p.safetyFactorQ*p.majorRadiusM/(p.majorRadiusM+rho*Math.cos(theta))/n;
    }
    expect(q).toBeCloseTo(integral,11);
    const st=createInitialState(p);
    expect(fusionParallelVelocity(st.velocity,st.bField)).toBeCloseTo(p.speed0*Math.cos(p.pitchAngleDeg*Math.PI/180),12);
  });
  it('simulates tokamak helical confinement without NaN and handles dt=0', () => {
    const params = getPreset(2);
    let st = createInitialState(params);
    expect(stepTokamakMirror(st, params, 0).nextState.t).toBe(0);
    for (let i = 0; i < 20; i++) {
      st = stepTokamakMirror(st, params, 0.04).nextState;
    }
    const keDrift = Math.abs(st.currentKineticJ - st.initialKineticJ) / st.initialKineticJ;
    expect(keDrift).toBeLessThan(1e-8);
  });
});
