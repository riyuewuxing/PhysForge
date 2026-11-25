import { describe, expect, it } from 'vitest';
import {
  checkInvariants,
  computeLarmorCircleForTrack,
  computeObservables,
  createInitialState,
  stepBoundedMagnetic,
  type BoundedMagneticParams
} from './engine.js';

const baseParams: BoundedMagneticParams = {
  mode: 'half-space',
  family: 'single',
  mass: 1,
  charge: 1,
  magneticFieldZ: 2,
  electricFieldY: 0,
  initialSpeed: 2,
  launchAngleDeg: 0,
  fieldScale: 1.2,
  beamCount: 1
};

describe('em-bounded-magnetic-field engine', () => {
  it('conserves kinetic energy (< 1e-6) and Larmor radius (< 1e-5) over 10 full periods', () => {
    const params: BoundedMagneticParams = {
      ...baseParams,
      mode: 'half-space',
      family: 'single',
      launchAngleDeg: 0,
      magneticFieldZ: 2,
      initialSpeed: 2,
      mass: 1,
      charge: 1
    };
    // 粒子从 x = -0.18 出发，先进入 x >= 0 转半圈再出界；若想跑满 10 周期，使用足够宽矩形或全空间
    // 在 crossed-eb 下 E_y = 0 即为全空间纯匀强磁场
    const fullFieldParams: BoundedMagneticParams = {
      ...params,
      mode: 'crossed-eb',
      electricFieldY: 0
    };
    const initial = createInitialState(fullFieldParams);
    let state = initial;
    const period = (2 * Math.PI * fullFieldParams.mass) / (fullFieldParams.charge * fullFieldParams.magneticFieldZ);
    const dt = period / 200;
    const analyticalR = (fullFieldParams.mass * fullFieldParams.initialSpeed) / (fullFieldParams.charge * fullFieldParams.magneticFieldZ);

    const initialKe = computeObservables(initial, fullFieldParams).kineticEnergy!;
    let maxKeRelErr = 0;
    let maxRadiusRelErr = 0;

    for (let i = 0; i < 10 * 200; i++) {
      state = stepBoundedMagnetic(state, fullFieldParams, dt).nextState;
      const obs = computeObservables(state, fullFieldParams);
      const keErr = Math.abs(obs.kineticEnergy! - initialKe) / initialKe;
      if (keErr > maxKeRelErr) maxKeRelErr = keErr;

      // 圆心在 (0, -R)（因为 q>0, Bz>0, v0=(+v,0), F=(0,-qvB) 向下）
      const radius = Math.hypot(obs.x!, obs.y! + analyticalR);
      const rErr = Math.abs(radius - analyticalR) / analyticalR;
      if (rErr > maxRadiusRelErr) maxRadiusRelErr = rErr;
    }

    expect(maxKeRelErr).toBeLessThan(1e-6);
    expect(maxRadiusRelErr).toBeLessThan(1e-5);
  });

  it('demonstrates exact magnetic focusing in circular field when R_c == R_field', () => {
    const R = 1.0;
    const params: BoundedMagneticParams = {
      ...baseParams,
      mode: 'circular',
      family: 'focusing',
      mass: 1,
      charge: 1,
      magneticFieldZ: 2,
      initialSpeed: 2, // R_c = mv/(qB) = 2 / 2 = 1.0 == R_field
      fieldScale: R,
      beamCount: 5
    };
    let state = createInitialState(params);
    const minDistToFocus = state.particles.map(() => Number.POSITIVE_INFINITY);
    const focusPoint = { x: 0, y: -R }; // q>0, Bz>0 向下偏转，精确汇聚于最低点 (0, -R)

    const dt = 0.002;
    for (let step = 0; step < 650; step++) {
      state = stepBoundedMagnetic(state, params, dt).nextState;
      state.particles.forEach((track, idx) => {
        const d = Math.hypot(
          track.state.position.x - focusPoint.x,
          track.state.position.y - focusPoint.y
        );
        if (d < minDistToFocus[idx]!) {
          minDistToFocus[idx] = d;
        }
      });
    }

    for (const d of minDistToFocus) {
      expect(d).toBeLessThan(2e-3);
    }
  });

  it('matches analytical crossed-EB cycloid and speed-splitting drift', () => {
    const params: BoundedMagneticParams = {
      ...baseParams,
      mode: 'crossed-eb',
      family: 'single',
      mass: 1,
      charge: 1,
      magneticFieldZ: 2,
      electricFieldY: 4,
      initialSpeed: 0
    };
    let state = createInitialState(params);
    const dt = 0.001;
    const tEnd = 2.5;
    const steps = Math.round(tEnd / dt);
    for (let i = 0; i < steps; i++) {
      state = stepBoundedMagnetic(state, params, dt).nextState;
    }

    const omega = (params.charge * params.magneticFieldZ) / params.mass;
    const vd = params.electricFieldY / params.magneticFieldZ; // 2 m/s 沿 +x
    const exactX = vd * (tEnd - Math.sin(omega * tEnd) / omega);
    const exactY = (vd / omega) * (1 - Math.cos(omega * tEnd));
    const obs = computeObservables(state, params);

    expect(Math.abs(obs.x! - exactX) / Math.max(exactX, 1e-6)).toBeLessThan(1e-4);
    expect(Math.abs(obs.y! - exactY) / Math.max(exactY, 1e-6)).toBeLessThan(1e-4);
    expect(obs.vDriftX).toBeCloseTo(vd, 10);
  });

  it('captures half-space entry and exit times via bisectEvent within < 1e-6 s', () => {
    const params: BoundedMagneticParams = {
      ...baseParams,
      mode: 'half-space',
      family: 'single',
      mass: 1,
      charge: 1,
      magneticFieldZ: 2,
      initialSpeed: 2, // R = 1.0, T = pi, 半圈时间 = pi/2
      launchAngleDeg: 0,
      fieldScale: 1.0
    };
    // 起点 x0 = -0.15 * 1.0 = -0.15, 速率 2 m/s -> 精确入射时刻 t_in = 0.075 s
    // 进入磁场走半圆精确穿出时刻 t_out = 0.075 + pi / 2
    const initial = createInitialState(params);
    let state = initial;
    const dt = 0.001;
    for (let i = 0; i < 1800; i++) {
      state = stepBoundedMagnetic(state, params, dt).nextState;
    }

    const track = state.particles[0]!;
    expect(track.hasEntered).toBe(true);
    expect(track.hasExited).toBe(true);
    expect(Math.abs(track.entryTime! - 0.075)).toBeLessThan(1e-6);
    expect(Math.abs(track.exitTime! - (0.075 + Math.PI / 2))).toBeLessThan(1e-6);

    const inv = checkInvariants(state, initial, params);
    expect(inv[0]?.passed).toBe(true);
  });

  it('captures BOTH rectangular crossings even when both outer-step endpoints are outside',()=>{
    const p:BoundedMagneticParams={...baseParams,mode:'rectangular',fieldScale:1,charge:0};
    const initial=createInitialState(p),out=stepBoundedMagnetic(initial,p,1);
    const track=out.nextState.particles[0]!;
    expect(out.events.map(e=>e.label)).toEqual(['进入磁场边界','穿出磁场边界']);
    expect(track.entryTime).toBeCloseTo(.075,8);
    expect(track.exitTime).toBeCloseTo(.575,8);
    expect(track.state.position.x).toBeCloseTo(1.85,8);
    expect(track.state.t).toBeCloseTo(out.nextState.t,12);
    expect(track.inField).toBe(false);
  });
  it('finishes the remaining free-flight time after a magnetic entry and exit within one step',()=>{
    const p:BoundedMagneticParams={...baseParams,fieldScale:1};
    const initial=createInitialState(p),out=stepBoundedMagnetic(initial,p,2);
    const track=out.nextState.particles[0]!,exit=.075+Math.PI/2;
    expect(out.events).toHaveLength(2);
    expect(track.entryTime).toBeCloseTo(.075,8);
    expect(track.exitTime).toBeCloseTo(exit,8);
    expect(track.state.position.x).toBeCloseTo(-2*(2-exit),7);
    expect(track.state.position.y).toBeCloseTo(-2,7);
    expect(track.state.velocity.x).toBeCloseTo(-2,7);
    expect(track.state.t).toBeCloseTo(out.nextState.t,12);
    expect(track.inField).toBe(false);
  });
  it('finds the first exit even if a hypothetical full magnetic orbit ends inside',()=>{
    const p:BoundedMagneticParams={...baseParams,fieldScale:1};
    const seed=createInitialState(p),track=seed.particles[0]!;
    const initial={...seed,particles:[{...track,inField:true,hasEntered:true,entryTime:0,entryPoint:{x:.1,y:0},state:{...track.state,position:{x:.1,y:0,z:0}},trail:[{x:.1,y:0}]}]};
    const out=stepBoundedMagnetic(initial,p,Math.PI);
    const exit=(Math.PI+Math.asin(.1))/2;
    const actual=out.nextState.particles[0]!;
    expect(out.events).toHaveLength(1);
    expect(actual.exitTime).toBeCloseTo(exit,8);
    expect(actual.state.position.x).toBeCloseTo(-2*Math.sqrt(.99)*(Math.PI-exit),7);
    expect(actual.state.position.y).toBeCloseTo(-1-Math.sqrt(.99)+.2*(Math.PI-exit),7);
    expect(actual.state.t).toBeCloseTo(Math.PI,12);
    expect(actual.inField).toBe(false);
  });
  it('keeps a tangent free ray outside a circular field without inventing a crossing',()=>{
    const p:BoundedMagneticParams={...baseParams,mode:'circular',fieldScale:1};
    const seed=createInitialState(p),track=seed.particles[0]!;
    const initial={...seed,particles:[{...track,state:{...track.state,position:{x:-2,y:1,z:0}},trail:[{x:-2,y:1}]}]};
    const out=stepBoundedMagnetic(initial,p,2);
    expect(out.events).toHaveLength(0);
    expect(out.nextState.particles[0]!.inField).toBe(false);
    expect(out.nextState.particles[0]!.state.position.x).toBeCloseTo(2,10);
  });
  it('uses exact phase, geometry and velocity for a single full uniform-B period',()=>{
    const p:BoundedMagneticParams={...baseParams,mode:'crossed-eb',electricFieldY:0};
    const initial=createInitialState(p),t=Math.PI/4;
    const quarter=stepBoundedMagnetic(initial,p,t).nextState.particles[0]!.state;
    expect(quarter.position.x).toBeCloseTo(1,10);
    expect(quarter.position.y).toBeCloseTo(-1,10);
    expect(quarter.velocity.x).toBeCloseTo(0,10);
    expect(quarter.velocity.y).toBeCloseTo(-2,10);
    const full=stepBoundedMagnetic(initial,p,Math.PI).nextState.particles[0]!.state;
    expect(Math.hypot(full.position.x,full.position.y)).toBeLessThan(1e-10);
    expect(full.velocity.x).toBeCloseTo(2,10);
  });
  it('does not attribute crossed-field drift to a neutral particle',()=>{
    const p:BoundedMagneticParams={...baseParams,mode:'crossed-eb',charge:0,electricFieldY:3};
    const initial=createInitialState(p),s=stepBoundedMagnetic(initial,p,1).nextState;
    expect(s.particles[0]!.state.position.x).toBeCloseTo(2,10);
    expect(s.particles[0]!.state.position.y).toBeCloseTo(0,10);
    expect(computeObservables(s,p).vDriftX).toBe(0);
  });

  it('matches exact E-only acceleration and the small-B limit without a spurious drift',()=>{
    const p:BoundedMagneticParams={...baseParams,mode:'crossed-eb',electricFieldY:4,magneticFieldZ:0};
    const init=createInitialState(p),s=stepBoundedMagnetic(init,p,.75).nextState;
    const q=s.particles[0]!.state;
    expect(q.position.x).toBeCloseTo(1.5,12);
    expect(q.position.y).toBeCloseTo(1.125,12);
    expect(q.velocity.y).toBeCloseTo(3,12);
    expect(checkInvariants(s,init,p)[0]?.passed).toBe(true);
    const tiny={...p,magneticFieldZ:1e-12};
    const v=stepBoundedMagnetic(createInitialState(tiny),tiny,.75).nextState.particles[0]!.state;
    expect(v.position.x).toBeCloseTo(q.position.x,10);
    expect(v.position.y).toBeCloseTo(q.position.y,10);
  });
  it('distinguishes selected velocity from magnetic force cancellation for either charge',()=>{
    for(const charge of [-1,1]){
      const p:BoundedMagneticParams={...baseParams,mode:'crossed-eb',charge,electricFieldY:4};
      const init=createInitialState(p),s=stepBoundedMagnetic(init,p,10).nextState;
      const q=s.particles[0]!.state;
      expect(q.position.x).toBeCloseTo(20,10);
      expect(q.position.y).toBeCloseTo(0,10);
      expect(q.velocity.x).toBeCloseTo(2,10);
      expect(computeObservables(s,p).larmorRadius).toBeCloseTo(0,10);
      expect(checkInvariants(s,init,p)[0]?.passed).toBe(true);
    }
  });
  it('does not confuse an entry-face contact with the later exit through another rectangle face',()=>{
    const p:BoundedMagneticParams={...baseParams,mode:'rectangular',charge:0,fieldScale:1,launchAngleDeg:45};
    const seed=createInitialState(p),tr=seed.particles[0]!;
    const initial={...seed,particles:[{...tr,inField:true,hasEntered:true,entryTime:0,entryPoint:{x:0,y:0},state:{...tr.state,position:{x:0,y:0,z:0}},trail:[{x:0,y:0}]}]};
    const out=stepBoundedMagnetic(initial,p,1);
    expect(out.events).toHaveLength(1);
    expect(out.nextState.particles[0]!.exitTime).toBeCloseTo(.8/Math.sqrt(2),8);
    expect(out.nextState.particles[0]!.state.position.x).toBeCloseTo(Math.sqrt(2),10);
    expect(out.nextState.particles[0]!.state.position.y).toBeCloseTo(Math.sqrt(2),10);
  });
  it('detects a circular same-side traversal at high speed without fixed probe spacing',()=>{
    const p:BoundedMagneticParams={...baseParams,mode:'circular',charge:0,fieldScale:1};
    const seed=createInitialState(p),tr=seed.particles[0]!;
    const initial={...seed,particles:[{...tr,state:{...tr.state,position:{x:-2,y:.9999,z:0}},trail:[{x:-2,y:.9999}]}]};
    const out=stepBoundedMagnetic(initial,p,2),halfChord=Math.sqrt(1-.9999**2);
    expect(out.events).toHaveLength(2);
    expect(out.nextState.particles[0]!.entryTime).toBeCloseTo((2-halfChord)/2,8);
    expect(out.nextState.particles[0]!.exitTime).toBeCloseTo((2+halfChord)/2,8);
    expect(out.nextState.particles[0]!.state.position.x).toBeCloseTo(2,10);
  });

  it('handles zero B, zero q, zero v0, and dt=0 without NaN or Infinity', () => {
    const cases: BoundedMagneticParams[] = [
      { ...baseParams, magneticFieldZ: 0 },
      { ...baseParams, charge: 0 },
      { ...baseParams, initialSpeed: 0 },
      { ...baseParams, mode: 'crossed-eb', magneticFieldZ: 0, electricFieldY: 0 }
    ];

    for (const p of cases) {
      const s0 = createInitialState(p);
      const sZeroDt = stepBoundedMagnetic(s0, p, 0).nextState;
      const sStep = stepBoundedMagnetic(sZeroDt, p, 0.01).nextState;
      const obs = computeObservables(sStep, p);
      for (const val of Object.values(obs)) {
        expect(Number.isFinite(val)).toBe(true);
      }
      computeLarmorCircleForTrack(sStep.particles[0]!, p);
    }
  });
});
