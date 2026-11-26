import { describe, expect, it } from 'vitest';
import { loadSimulationById } from '@physforge/simulations/catalog';
import {
  auditSceneHeadless,
  normalizeToSceneDsl,
  routePhysicsProblemPrompt,
  runGenerateThenRefine,
  synthesizeSceneFromPrompt
} from './index.js';

describe('@physforge/ai-copilot 3-tier routing, Zod SceneDSL & 3-round refine', () => {
  it('routes physics word problems across specialized, builder B1-B4, and B5 custom-ODE tiers', () => {
    const rSpec = routePhysicsProblemPrompt('一束光子照射钠阴极光电管发生光电效应求遏止电压');
    expect(rSpec.tier).toBe('specialized');
    expect(rSpec.modelId).toBe('modern-photoelectric-compton');

    const rQuant = routePhysicsProblemPrompt('512格一维高斯波包量子隧穿矩形势垒');
    expect(rQuant.tier).toBe('specialized');
    expect(rQuant.modelId).toBe('comp-relativity-quantum-tunneling');

    const rBuilder = routePhysicsProblemPrompt('带电粒子进入多个区域复合场磁聚焦');
    expect(rBuilder.tier).toBe('builder');
    expect(rBuilder.modelId).toBe('builder-composite-em-field');

    const rOde = routePhysicsProblemPrompt('求解自定义微分方程 d^2x/dt^2 = -x - 0.1*x^3 相轨迹');
    expect(rOde.tier).toBe('custom-ode-fallback');
    expect(rOde.modelId).toBe('builder-custom-ode-lab');
  });

  it('rejects malformed SceneDSL payloads cleanly via Zod and accepts legacy preset wrapper', () => {
    expect(() => normalizeToSceneDsl({ schemaVersion: '1.0', modelId: '', params: {} })).toThrow();

    const norm = normalizeToSceneDsl({
      modelId: 'em-bounded-magnetic-field',
      preset: { id: 'p1', name: 'Test', params: { magneticFieldZ: 2.0 } }
    });
    expect(norm.schemaVersion).toBe('2.0');
    expect(norm.modelId).toBe('builder-composite-em-field');
  });

  it('runs Generate-then-Refine headless self-correction loop (max 3 rounds) and succeeds after fixing bad params', async () => {
    const out = await runGenerateThenRefine(
      async (round) => {
        if (round === 1) {
          return {
            schemaVersion: '2.0',
            modelId: 'modern-photoelectric-compton',
            params: { wavelengthNm: 999999 } // violates paramSchema max bound (750)
          };
        }
        return {
          schemaVersion: '2.0',
          modelId: 'modern-photoelectric-compton',
          params: { mode: 'photoelectric', cathodeMetal: 'Na', wavelengthNm: 405, intensityRel: 1.4 }
        };
      },
      { maxRounds: 3, steps: 20, dt: 0.02 }
    );

    expect(out.accepted).toBe(true);
    expect(out.attempts).toBe(2);
    expect(out.history[0]!.errors.length).toBeGreaterThan(0);
    expect(out.lastAudit.passed).toBe(true);
  });

  it('rejects unknown keys, supplies the actual schema and accepts a corrected second round', async () => {
    const candidate = {
      schemaVersion: '2.0',
      modelId: 'modern-photoelectric-compton',
      params: { mode: 'photoelectric', wavelengthNm: 405 }
    };
    const invalid = { ...candidate, params: { ...candidate.params, wavelengthFake: 405 } };
    const firstAudit = await auditSceneHeadless(invalid);
    expect(firstAudit.passed).toBe(false);
    expect(firstAudit.errors).toContain('Unknown param "wavelengthFake" for model "modern-photoelectric-compton".');
    expect(firstAudit.finalObservables).toEqual({});
    expect(firstAudit.errors.join(' ')).toContain('wavelengthNm: number[200..750] nm');
    const result = await runGenerateThenRefine((round, feedback) => {
      if (round === 1) return invalid;
      expect(feedback).toContain('Unknown param "wavelengthFake"');
      expect(feedback).toContain('mode: select(photoelectric|compton)');
      expect(feedback).toContain('freezeRefEnabled: boolean');
      return candidate;
    }, { maxRounds: 3, steps: 20 });
    expect(result.accepted).toBe(true);
    expect(result.attempts).toBe(2);
    expect(result.finalScene?.params).not.toHaveProperty('wavelengthFake');
  });

  it('synthesizes valid runnable SceneDSL offline from prompt and passes headless audit', async () => {
    const synth = await synthesizeSceneFromPrompt('水平实心球滑滚转换与保龄球回滚');
    expect(synth.route.modelId).toBe('comp-rigid-rolling-slip');
    const audit = await auditSceneHeadless(synth.scene, { steps: 30, dt: 0.02 });
    expect(audit.passed).toBe(true);
  });
});

describe('Explicit static analytic headless contract',()=>{
  const scene={schemaVersion:'2.0',modelId:'modern-photoelectric-compton',params:{mode:'photoelectric',wavelengthNm:405}};
  it('certifies an explicitly static, finite, zero-time solver and keeps its real invariants',async()=>{
    const source=(await loadSimulationById(scene.modelId))!;
    const plugin={...source,timeSemantics:'static-analytic' as const,engine:{...source.engine,step:(state:unknown)=>({nextState:state,events:[],advancedTime:0,halt:true})}};
    const r=await auditSceneHeadless(scene,{pluginResolver:async()=>plugin});
    expect(r.passed).toBe(true);expect(r.finalObservables.t).toBe(0);
    expect(r.invariants.length).toBeGreaterThan(0);expect(r.invariants.every(i=>i.passed)).toBe(true);
  });
  it('still rejects a stalled evolving solver even if it claims a terminal halt',async()=>{
    const source=(await loadSimulationById(scene.modelId))!;
    const plugin={...source,timeSemantics:undefined,engine:{...source.engine,step:(state:unknown)=>({nextState:state,events:[],advancedTime:0,halt:true})}};
    const r=await auditSceneHeadless(scene,{pluginResolver:async()=>plugin});
    expect(r.passed).toBe(false);expect(r.errors.join(' ')).toContain('Engine did not advance');
  });
  it('rejects static declarations with actual advancement, missing halt, fake time or missing invariants',async()=>{
    const source=(await loadSimulationById(scene.modelId))!;
    const stop=(state:unknown)=>({nextState:state,events:[],advancedTime:0,halt:true});
    const engine={...source.engine,step:stop};
    const plugin={...source,timeSemantics:'static-analytic' as const,engine};
    const run=async(e:typeof engine)=>auditSceneHeadless(scene,{pluginResolver:async()=>({...plugin,engine:e})});
    expect((await run({...engine,step:state=>({...stop(state),advancedTime:.01})})).passed).toBe(false);
    expect((await run({...engine,step:state=>({...stop(state),halt:false})})).passed).toBe(false);
    expect((await run({...engine,computeObservables:()=>({t:1})})).passed).toBe(false);
    expect((await run({...engine,checkInvariants:()=>[]})).passed).toBe(false);
    expect((await run({...engine,checkInvariants:()=>[{name:'bad',measuredError:1,tolerance:0,passed:false}]})).passed).toBe(false);
  });
});
