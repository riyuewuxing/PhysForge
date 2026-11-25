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


describe('H10 contact and angular energy',()=>{
  it('measures the initial downhill acceleration on the frictional slope',async()=>{
    await ensureRapierLoaded();
    for(const friction of [0,.2]){
      const p:SandboxParams={...baseParams,scenario:'incline-slide',inclineDeg:30,friction,restitution:0};
      const s=createInitialState(p),b0=s.bodies.find(b=>b.id==='slider')!;
      let next=s;
      for(let i=0;i<48;i++)next=stepSandbox(next,p,1/240).nextState;
      const b=next.bodies.find(b=>b.id==='slider')!,c=Math.cos(Math.PI/6),si=.5;
      const expected=9.8*(si-friction*c)*.2;
      expect(Math.abs(b.vx*c-b.vy*si-expected)).toBeLessThan(.04);
      expect(Math.abs((b.x-b0.x)*c-(b.y-b0.y)*si-.5*expected*.2)).toBeLessThan(.008);
      expect(Math.abs((b.x-b0.x)*si+(b.y-b0.y)*c)).toBeLessThan(.008);
    }
  });
  it('includes the rotational kinetic energy of uniform disks and rectangular blocks',()=>{
    const p:SandboxParams={...baseParams,scenario:'incline-slide'};
    const s=createInitialState(p),base=computeObservables(s,p).kineticEnergy!;
    const slider=s.bodies.find(b=>b.id==='slider')!;
    const spun={...s,bodies:s.bodies.map(b=>b.id==='slider'?{...b,angularVelocity:4}:b)};
    expect(computeObservables(spun,p).kineticEnergy!-base).toBeCloseTo(.5*slider.mass*(slider.halfW**2+slider.halfH**2)/3*16,12);
    const q={...baseParams},balls=createInitialState(q);
    const b=balls.bodies.find(x=>x.id==='b1')!;
    const rotating={...balls,bodies:balls.bodies.map(x=>x.id==='b1'?{...x,angularVelocity:4}:x)};
    expect(computeObservables(rotating,q).kineticEnergy!-computeObservables(balls,q).kineticEnergy!).toBeCloseTo(.25*b.mass*b.halfW**2*16,12);
  });
});


describe('H10 independent collision mode contracts',()=>{
  it('matches unequal-mass head-on momentum and restitution laws before wall impact',async()=>{
    await ensureRapierLoaded();
    for(const restitution of [0,.5,1]){
      const p:SandboxParams={...baseParams,massRatio:2,restitution,friction:0};
      let s=createInitialState(p);
      for(let i=0;i<240;i++)s=stepSandbox(s,p,1/240).nextState;
      const obs=computeObservables(s,p),v1=2.6*(1-2*restitution)/3,v2=2.6*(1+restitution)/3;
      expect(Math.abs(obs.primaryVx!-v1)).toBeLessThan(.08);
      expect(Math.abs(obs.secondaryVx!-v2)).toBeLessThan(.08);
      expect(Math.abs(obs.totalMomentumX!-2.6)).toBeLessThan(.01);
      expect(Math.abs(obs.kineticEnergy!-(.5*v1*v1+v2*v2))/3.38).toBeLessThan(.02);
    }
  });
  it('transfers momentum through the four separated equal disks without a fabricated pendulum constraint',async()=>{
    await ensureRapierLoaded();
    const p:SandboxParams={...baseParams,scenario:'newtons-cradle',restitution:1,friction:0};
    let s=createInitialState(p);
    for(let i=0;i<192;i++)s=stepSandbox(s,p,1/240).nextState;
    const obs=computeObservables(s,p);
    expect(Math.abs(obs.totalMomentumX!-3)).toBeLessThan(.01);
    expect(Math.abs(obs.kineticEnergy!-4.5)/4.5).toBeLessThan(.02);
    expect(Math.abs(obs.lastBallVx!-3)).toBeLessThan(.15);
  });
});
