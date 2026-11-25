import { describe, expect, it } from 'vitest';
import { ensureRapierLoaded } from './rapierLoader.js';
import { resolvePluginParams } from '@physforge/sim-sdk';
import { mechFreeSandboxPlugin } from './plugin.js';
import {
  checkInvariants,
  computeObservables,
  createInitialState,
  stepSandbox,
  type SandboxParams
} from './engine.js';

describe('B4 builder-mechanics-lab V2 verification', () => {
  it('matches Udwadia-Kalaba Atwood acceleration and rope tension to < 1e-10', () => {
    const params = resolvePluginParams<SandboxParams>(mechFreeSandboxPlugin.paramSchema, {
      scenario: 'atwood-constrained',
      massRatio: 3.0, // m1 = 1 kg, m2 = 3 kg => a = (3-1)/(3+1) * g = 0.5g, T = 2*1*3/(1+3) g = 1.5g
      gravity: 9.8
    });
    let state = createInitialState(params);
    const dt = 0.01;
    state = stepSandbox(state, params, dt).nextState;

    const obs = computeObservables(state, params);
    const expectedT = ((2 * 1 * 3) / (1 + 3)) * 9.8;
    expect(Math.abs(obs.constraintTensionN! - expectedT)).toBeLessThan(1e-10);

    const bLeft = state.bodies.find((b) => b.id === 'atwood-left')!;
    const bRight = state.bodies.find((b) => b.id === 'atwood-right')!;
    // After 10ms, ay1 = +0.5*g => vy1 = 0.5*9.8*0.01
    expect(bLeft.vy).toBeCloseTo(0.5 * 9.8 * dt, 10);
    expect(bRight.vy).toBeCloseTo(-0.5 * 9.8 * dt, 10);
  });

  it('conserves mechanical energy < 1e-4 over 20s in ideal spring-oscillator', () => {
    const params = resolvePluginParams<SandboxParams>(mechFreeSandboxPlugin.paramSchema, {
      scenario: 'spring-oscillator',
      springK: 25
    });
    let state = createInitialState(params);
    const e0 = computeObservables(state, params);
    const total0 = e0.kineticEnergy! + e0.potentialEnergy!;

    const dt = 1 / 240;
    for (let i = 0; i < 20 * 240; i++) {
      state = stepSandbox(state, params, dt).nextState;
    }

    const e1 = computeObservables(state, params);
    const total1 = e1.kineticEnergy! + e1.potentialEnergy!;
    expect(Math.abs(total1 - total0) / Math.max(total0, 1e-9)).toBeLessThan(1e-4);

    const fbd = mechFreeSandboxPlugin.getForceVectors?.(state, params) ?? [];
    expect(fbd.length).toBeGreaterThan(0);
    const ir = mechFreeSandboxPlugin.exportDiagramIR?.(state, params);
    expect(ir?.primitives.some((p) => p.kind === 'spring')).toBe(true);
  });
});

describe('H10 analytic sandbox contracts independent of WASM readiness',()=>{
  it('initializes the Atwood tension and preserves the exact rope and force balance',async()=>{
    await ensureRapierLoaded();
    const p=resolvePluginParams<SandboxParams>(mechFreeSandboxPlugin.paramSchema,{scenario:'atwood-constrained',massRatio:3,gravity:9.8});
    const s=createInitialState(p);
    expect(s.rapierActive).toBe(false);
    expect(s.constraintTensionN).toBeCloseTo(14.7,12);
    const f=mechFreeSandboxPlugin.getForceVectors!(s,p);
    expect(f.find(x=>x.id==='tension-atwood-left')?.force.y).toBeCloseTo(14.7,12);
    const next=stepSandbox(s,p,.2).nextState;
    const left=next.bodies.find(b=>b.id==='atwood-left')!,right=next.bodies.find(b=>b.id==='atwood-right')!;
    expect(left.y+right.y).toBeCloseTo(.2,12);
    expect(left.vy+right.vy).toBeCloseTo(0,12);
    expect(left.y).toBeCloseTo(.1+.5*4.9*.2**2,12);
    expect(checkInvariants(next,s,p).length).toBeGreaterThanOrEqual(2);
    expect(checkInvariants(next,s,p).every(i=>i.passed)).toBe(true);
  });
  it('uses the same ideal spring solution before and after WASM loads, including normal reaction',async()=>{
    const p=resolvePluginParams<SandboxParams>(mechFreeSandboxPlugin.paramSchema,{scenario:'spring-oscillator',springK:50,gravity:9.8,friction:.6});
    await ensureRapierLoaded();
    const initial=createInitialState(p);
    expect(initial.rapierActive).toBe(false);
    let s=initial;
    const energy=(x:typeof s)=>{const o=computeObservables(x,p);return o.kineticEnergy!+o.potentialEnergy!;};
    const e0=energy(s),w=Math.sqrt(50),dt=1/240;
    let maxErr=0;
    for(let i=0;i<4800;i++){
      s=stepSandbox(s,p,dt).nextState;
      maxErr=Math.max(maxErr,Math.abs(energy(s)-e0)/e0);
    }
    const b=s.bodies.find(b=>b.id==='mass-block')!;
    expect(s.rapierActive).toBe(false);
    expect(b.x).toBeCloseTo(-.45+1.25*Math.cos(w*20),8);
    expect(b.vx).toBeCloseTo(-1.25*w*Math.sin(w*20),8);
    expect(b.y).toBe(initial.bodies.find(b=>b.id==='mass-block')!.y);
    expect(maxErr).toBeLessThan(1e-6);
    const f=mechFreeSandboxPlugin.getForceVectors!(s,p);
    expect(f.find(x=>x.category==='normal')?.force.y).toBeCloseTo(9.8,12);
    expect(checkInvariants(s,initial,p).length).toBeGreaterThan(0);
    expect(checkInvariants(s,initial,p).every(i=>i.passed)).toBe(true);
  });
  it('attaches mass manipulation to the actual target and never offers an inoperative mass handle',()=>{
    for(const scenario of ['elastic-collision','incline-slide','atwood-constrained','newtons-cradle','spring-oscillator'] as const){
      const p=resolvePluginParams<SandboxParams>(mechFreeSandboxPlugin.paramSchema,{scenario,massRatio:3});
      const s=createInitialState(p);
      const h=mechFreeSandboxPlugin.getControlHandles!(s,p);
      const target=scenario==='elastic-collision'?'b2':scenario==='incline-slide'?'target':scenario==='atwood-constrained'?'atwood-right':undefined;
      if(target){
        const b=s.bodies.find(b=>b.id===target)!;
        expect(h).toHaveLength(1);
        expect(h[0]!.position.x).toBe(b.x);
        expect(h[0]!.onDrag(h[0]!.position).massRatio).toBe(3);
      }else expect(h).toHaveLength(0);
    }
  });
});
