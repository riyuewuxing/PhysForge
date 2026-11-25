import { describe, expect, it, vi } from 'vitest';
import { runParameterSweep } from '@physforge/analysis-lab/sweep';
import { resolvePluginParams } from '@physforge/sim-sdk';
import { compileSafeFormula, preloadMathjsCompiler } from './safeAstCompiler.js';
import {
  checkInvariants,
  computeObservables,
  createInitialState,
  stepCustomOde,
  type CustomOdeParams
} from './engine.js';
import { builderCustomOdeLabPlugin } from './plugin.js';

describe('B5 builder-custom-ode-lab verification', () => {
  it('rejects 100% of malicious or prototype-pollution expressions cleanly after lazy mathjs@15.2+ load', async () => {
    await preloadMathjsCompiler();

    const maliciousPayloads = [
      'constructor.constructor("return process")()',
      'x.__proto__.polluted = 1',
      'import("node:fs")',
      'process.exit(1)',
      'eval("1+1")',
      'createUnit("hack", "1 m")',
      'unknownVar * 2',
      'x[0] + 1',
      Array.from({ length: 90 }, () => 'x').join(' + ')
    ];

    for (const payload of maliciousPayloads) {
      expect(() => compileSafeFormula(payload)).toThrow();
    }

    const safe = compileSafeFormula('-(k * x + 2 * x^3) / m');
    expect(safe.evaluate({ x: 1, k: 4, m: 2 })).toBeCloseTo(-3, 12);
  }, 20000);

  it('conserves Kepler energy and angular momentum < 1e-5 and executes 50-step headless ParameterSweep', () => {
    const kepParams = resolvePluginParams<CustomOdeParams>(builderCustomOdeLabPlugin.paramSchema, {
      template: 'kepler-2d',
      stiffness: 6.0,
      initialPos: 1.4,
      initialVel: 1.7
    });

    let state = createInitialState(kepParams);
    const e0 = state.initialEnergy;
    const l0 = state.initialAngularMom;
    const dt = 0.005;
    for (let i = 0; i < 1200; i++) {
      state = stepCustomOde(state, kepParams, dt).nextState;
    }
    const obs = computeObservables(state, kepParams);
    expect(Math.abs(obs.energy! - e0) / Math.abs(e0)).toBeLessThan(1e-5);
    expect(Math.abs(obs.angularMomentum! - l0) / Math.abs(l0)).toBeLessThan(1e-6);

    // 50-step parameter sweep over stiffness k in harmonic-custom
    const sweepValues = Array.from({ length: 50 }, (_, i) => 2 + i * 0.5);
    const sweep = runParameterSweep(builderCustomOdeLabPlugin, {
      paramKey: 'stiffness',
      values: sweepValues,
      baseParams: { template: 'harmonic-custom', damping: 0, driveAmp: 0, initialPos: 1, initialVel: 0 },
      steps: 40,
      dt: 0.01
    });
    expect(sweep.points).toHaveLength(50);
  });
});

describe('H11 expression semantics and physical mode boundaries',()=>{
  const p=(overrides:Partial<CustomOdeParams>)=>resolvePluginParams<CustomOdeParams>(builderCustomOdeLabPlugin.paramSchema,overrides);
  it('uses standard power precedence, right associativity and scientific notation',async()=>{
    vi.resetModules();
    const cold=await import('./safeAstCompiler.js');
    for(const [expr,expected] of [['-x^2',-4],['2^-2',.25],['2^3^2',512],['1e-3*x',.002]] as const){
      expect(cold.compileSafeFormula(expr).evaluate({x:2})).toBeCloseTo(expected,12);
    }
    await cold.preloadMathjsCompiler();
    expect(cold.compileSafeFormula('-x^2').evaluate({x:2})).toBe(-4);
  });
  it('rejects undefined variables and nonfinite intermediate results, never silently returns zero',()=>{
    for(const expr of ['1/0','sqrt(-1)','0*exp(1000)','1/exp(1000)','x+v']){
      expect(()=>compileSafeFormula(expr).evaluate({x:1})).toThrow();
    }
    expect(compileSafeFormula('1/x').evaluate({x:1e-13})).toBeCloseTo(1e13,1);
    expect(()=>compileSafeFormula('toString(x)')).toThrow();
    expect(()=>compileSafeFormula('y')).toThrow();
  });
  it('halts a singular acceleration without advancing physical time or emitting nonfinite state',()=>{
    const params={...p({template:'custom-expr'}),exprText:'1/x',initialPos:0};
    const s=createInitialState(params),r=stepCustomOde(s,params,.01);
    expect(r.advancedTime).toBe(0);expect(r.halt).toBe(true);
    expect(r.nextState.t).toBe(0);expect(r.nextState.formulaError).toBeTruthy();
    expect(r.events).toHaveLength(1);expect(stepCustomOde(r.nextState,params,.01).events).toHaveLength(0);
  });
  it('includes the actual pendulum length and inertia in the SI mechanical energy',()=>{
    const params=p({template:'lagrangian-pendulum',mass:2,stiffness:20,initialPos:.8,initialVel:1.5,damping:0,driveAmp:0});
    const s=createInitialState(params),L=2,E=.5*2*L*L*1.5**2+2*9.8*L*(1-Math.cos(.8));
    expect(computeObservables(s,params).energy).toBeCloseTo(E,12);
    expect(s.initialEnergy).toBeCloseTo(E,12);
    expect(checkInvariants(s,s,params)).not.toHaveLength(0);
  });
  it('does not invent harmonic potential energy or angular momentum for an arbitrary acceleration',()=>{
    const params=p({template:'custom-expr',initialPos:1,initialVel:2});
    const o=computeObservables(createInitialState(params),params);
    expect(o).not.toHaveProperty('energy');expect(o).not.toHaveProperty('angularMomentum');
    expect(o.kineticEnergy).toBeCloseTo(.5*params.mass*4,12);
  });
  it('preserves requested zero tangential velocity and reports total SI orbital energy and angular momentum',()=>{
    const params=p({template:'kepler-2d',mass:3,stiffness:6,initialPos:1.5,initialVel:0});
    const s=createInitialState(params);expect(s.vy).toBe(0);
    expect(computeObservables(s,params).energy).toBeCloseTo(-12,12);
    expect(computeObservables(s,params).angularMomentum).toBe(0);
  });
  it('keeps the Kepler force and potential energy consistent inside the displayed core',()=>{
    const params=p({template:'kepler-2d',mass:2,stiffness:6});
    const s={...createInitialState(params),x:.1,y:0,vx:0,vy:0};
    const eps=1e-6,energy=(x:number)=>computeObservables({...s,x},params).energy!;
    const grad=(energy(s.x+eps)-energy(s.x-eps))/(2*eps);
    const force=builderCustomOdeLabPlugin.getForceVectors!(s,params)[0]!.force.x;
    expect(force).toBeCloseTo(-grad,3);
  });
});


describe('H11 mode presentation and editable expression contract',()=>{
  const plugin=builderCustomOdeLabPlugin;
  it('preserves custom input and exposes only quantities defined by the selected model',()=>{
    const p=resolvePluginParams<CustomOdeParams>(plugin.paramSchema,{template:'custom-expr',exprText:'-2*x + 1e-3'});
    expect(p.exprText).toBe('-2*x + 1e-3');
    const s=createInitialState(p);
    expect(s.formulaError).toBeNull();
    expect(plugin.getTelemetryChannels!(p).map(c=>c.key)).toEqual(['x','v','kineticEnergy']);
    const pend=resolvePluginParams<CustomOdeParams>(plugin.paramSchema,{template:'lagrangian-pendulum'});
    expect(plugin.getTelemetryChannels!(pend).map(c=>c.unit)).toEqual(['rad','rad/s','J']);
    expect(plugin.getParamFields!(pend).find(f=>f.key==='initialVel')).toMatchObject({unit:'rad/s'});
    const orbit=resolvePluginParams<CustomOdeParams>(plugin.paramSchema,{template:'kepler-2d'});
    expect(plugin.getParamFields!(orbit).some(f=>f.key==='damping')).toBe(false);
    expect(plugin.getForceVectors!(s,p)).toEqual([]);
  });
  it('uses the visible phase point as the initial-condition handle and does not edit history',()=>{
    const p=resolvePluginParams<CustomOdeParams>(plugin.paramSchema,{template:'harmonic-custom',initialPos:1,initialVel:2});
    const s=createInitialState(p),h=plugin.getControlHandles!(s,p)[0]!;
    expect(h.position).toEqual({x:1,y:2});
    expect(h.onDrag({x:-.7,y:1.4})).toMatchObject({initialPos:-.7,initialVel:1.4});
    expect(plugin.getControlHandles!(stepCustomOde(s,p,.02).nextState,p)).toEqual([]);
  });
});
