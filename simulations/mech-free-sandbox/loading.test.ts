import { describe, expect, it, vi } from 'vitest';
import { createInitialState, stepSandbox, type SandboxParams } from './engine.js';
import { getRapierLoadError } from './rapierLoader.js';
vi.mock('./rapierLoader.js',()=>({getLoadedRapier:vi.fn(()=>null),getRapierLoadError:vi.fn(()=>null)}));
const p:SandboxParams={scenario:'incline-slide',gravity:9.8,restitution:.9,friction:.05,massRatio:1.5,inclineDeg:30,springK:20};
describe('H10 async engine readiness is not physics time',()=>{
  it('does not substitute falling or collision while the rigid-body engine is loading',()=>{
    const s=createInitialState(p);
    for(let i=0;i<4;i++){
      const step=stepSandbox(s,p,.05);
      expect(step.nextState).toBe(s);
      expect(step.advancedTime).toBe(0);
      expect(step.halt).not.toBe(true);
    }
  });
  it('reports a load failure once and does not pretend to integrate',()=>{
    vi.mocked(getRapierLoadError).mockReturnValueOnce(new Error('offline'));
    const s=createInitialState(p),r=stepSandbox(s,p,.05);
    expect(r.halt).toBe(true);
    expect(r.advancedTime).toBe(0);
    expect(r.events).toHaveLength(1);
    expect(r.nextState.t).toBe(0);
    expect(r.nextState.bodies).toEqual(s.bodies);
    expect(stepSandbox(r.nextState,p,.05).events).toEqual([]);
  });
});
