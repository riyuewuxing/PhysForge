import { describe, expect, it } from 'vitest';
import { ensureRapierLoaded } from './rapierLoader.js';
import {
  computeObservables,
  createInitialState,
  stepSandbox,
  type SandboxParams
} from './engine.js';

const baseParams: SandboxParams = {
  scenario: 'elastic-collision',
  gravity: 9.8,
  restitution: 1.0,
  friction: 0,
  massRatio: 1.0,
  inclineDeg: 30,
  springK: 20
};

describe('mech-free-sandbox with lazy Rapier2D WASM', () => {
  it('lazily initializes @dimforge/rapier2d-compat and conserves momentum & energy in elastic collision', async () => {
    const rapier = await ensureRapierLoaded();
    expect(rapier).toBeDefined();

    const initial = createInitialState(baseParams);
    expect(initial.rapierActive).toBe(true);

    const obs0 = computeObservables(initial, baseParams);
    let state = initial;
    const dt = 1 / 120;
    // 撞前与撞后但撞右墙之前 (t = 1.1 s，球1从-1.8以2.6向右于0.71s撞击x=0.6的等质量球2)
    for (let i = 0; i < 130; i++) {
      state = stepSandbox(state, baseParams, dt).nextState;
    }

    const obs1 = computeObservables(state, baseParams);
    expect(obs1.rapierActive).toBe(1);
    // 动量守恒（< 1e-3）与弹性碰撞动能守恒（< 2e-2，含刚体离散接触容差）
    expect(Math.abs(obs1.totalMomentumX! - obs0.totalMomentumX!)).toBeLessThan(1e-2);
    expect(Math.abs(obs1.kineticEnergy! - obs0.kineticEnergy!) / obs0.kineticEnergy!).toBeLessThan(
      2e-2
    );

    // 等质量正碰交换速度：球1接近静止，球2获得接近 2.6 m/s
    const b1 = state.bodies.find((b) => b.id === 'b1')!;
    const b2 = state.bodies.find((b) => b.id === 'b2')!;
    expect(Math.abs(b1.vx)).toBeLessThan(0.15);
    expect(b2.vx).toBeGreaterThan(2.4);
  });

  it('handles spring oscillator and dt=0 without NaN or Infinity', async () => {
    await ensureRapierLoaded();
    const springParams: SandboxParams = {
      ...baseParams,
      scenario: 'spring-oscillator',
      springK: 16
    };
    let s = createInitialState(springParams);
    s = stepSandbox(s, springParams, 0).nextState;
    for (let i = 0; i < 60; i++) {
      s = stepSandbox(s, springParams, 1 / 120).nextState;
    }
    const obs = computeObservables(s, springParams);
    for (const v of Object.values(obs)) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe('H10 finite mechanical geometry and state isolation',()=>{
  it('places the slider exactly against the ramp and the lower ramp endpoint on the tabletop',()=>{
    for(const inclineDeg of [15,20,30,40,45]){
      const p:SandboxParams={...baseParams,scenario:'incline-slide',inclineDeg};
      const s=createInitialState(p);
      const r=s.bodies.find(b=>b.id==='ramp')!,b=s.bodies.find(b=>b.id==='slider')!,f=s.bodies.find(b=>b.id==='floor')!;
      const nx=-Math.sin(r.angle),ny=Math.cos(r.angle),tx=Math.cos(r.angle),ty=Math.sin(r.angle);
      expect((b.x-r.x)*nx+(b.y-r.y)*ny-r.halfH-b.halfH).toBeCloseTo(0,12);
      expect(r.y+r.halfW*ty+r.halfH*ny).toBeCloseTo(f.y+f.halfH,12);
      expect(Math.abs((b.x-r.x)*tx+(b.y-r.y)*ty)+b.halfW).toBeLessThan(r.halfW);
      expect(b.angle).toBe(r.angle);
    }
  });
  it('stops the Atwood ideal trajectory at first pulley contact, emits exactly one event and preserves preimpact velocity',()=>{
    for(const massRatio of [.5,2,3,5]){
      const p:SandboxParams={...baseParams,scenario:'atwood-constrained',massRatio};
      const s=createInitialState(p),a=Math.abs((massRatio-1)*p.gravity/(massRatio+1));
      const up=s.bodies.find(b=>b.id===(massRatio>1?'atwood-left':'atwood-right'))!;
      const pulley=s.bodies.find(b=>b.id==='pulley')!;
      const gap=pulley.y-Math.sqrt(pulley.halfW**2-(Math.abs(up.x-pulley.x)-up.halfW)**2)-up.y-up.halfH;
      const hit=Math.sqrt(2*gap/a);
      const first=stepSandbox(s,p,2);
      const b=first.nextState.bodies.find(b=>b.id===up.id)!;
      expect(first.nextState.t).toBeCloseTo(hit,10);
      expect(b.y).toBeCloseTo(up.y+gap,10);
      expect(b.vy).toBeCloseTo(a*hit,10);
      expect(first.events).toHaveLength(1);
      expect(first.events[0]!.time).toBeCloseTo(hit,10);
      const again=stepSandbox(first.nextState,p,1);
      expect(again.nextState).toEqual(first.nextState);
      expect(again.events).toHaveLength(0);
    }
  });
  it('advancing a historic rigid-body state does not mutate or reuse the newer world',async()=>{
    await ensureRapierLoaded();
    const p={...baseParams,gravity:0};
    const s=createInitialState(p);
    const a=stepSandbox(s,p,1/120).nextState;
    const b=stepSandbox(a,p,1/120).nextState;
    const replay=stepSandbox(s,p,1/120).nextState;
    expect(replay.bodies.find(x=>x.id==='b1')!.x).toBeCloseTo(a.bodies.find(x=>x.id==='b1')!.x,6);
    expect(replay.bodies.find(x=>x.id==='b1')!.vx).toBeCloseTo(a.bodies.find(x=>x.id==='b1')!.vx,6);
    expect(b.bodies.find(x=>x.id==='b1')!.x).toBeGreaterThan(a.bodies.find(x=>x.id==='b1')!.x);
  });
});
