import { resolvePluginParams } from '@physforge/sim-sdk';
import { describe, expect, it } from 'vitest';
import { emTransformerGridPlugin, transformerScene } from './plugin.js';
import { transformerGridPresets } from './presets.js';
import {
  createInitialState,
  checkInvariants,
  computeObservables,
  solveTransformerMetrics,
  stepTransformerGrid,
  type TransformerGridParams
} from './engine.js';

function getPreset(idx: number): TransformerGridParams {
  return resolvePluginParams(emTransformerGridPlugin.paramSchema, transformerGridPresets[idx]!.params);
}

describe('em-transformer-grid conservation & 1/4 power-loss scaling (E08)', () => {
  it('satisfies multi-tap ideal transformer power conservation sum(Uk*Ik) = U1*I1 within < 1e-10', () => {
    const p = getPreset(0);
    const m = solveTransformerMetrics(p);
    const pSec = m.u2 * m.i2 + m.u3 * m.i3;
    expect(Math.abs(pSec - m.u1 * m.i1) / (m.u1 * m.i1)).toBeLessThan(1e-10);
  });

  it('reduces transmission line loss strictly to 1/4 when doubling step-up turns ratio at constant power', () => {
    const grid10 = { ...getPreset(1), stepUpRatioK1: 10 };
    const grid20 = { ...getPreset(1), stepUpRatioK1: 20 };
    const m10 = solveTransformerMetrics(grid10);
    const m20 = solveTransformerMetrics(grid20);
    expect(Math.abs(m20.pLineLossW / m10.pLineLossW - 0.25)).toBeLessThan(1e-10);
  });

  it('handles zero power and zero dt cleanly without NaN', () => {
    const p0: TransformerGridParams = { ...getPreset(1), genPowerKw: 0 };
    const s0 = createInitialState(p0);
    expect(stepTransformerGrid(s0, p0, 0).nextState.current.pLineLossW).toBe(0);
    const s1 = stepTransformerGrid(s0, p0, 0.05).nextState;
    expect(Number.isFinite(s1.current.efficiency)).toBe(true);
  });
});

describe('E08 independent power boundaries and actual-state audit',()=>{
  it('accounts for supply, primary copper loss, transformer input and both secondary outputs',()=>{
    const p={...getPreset(0),sourceU0:220,primaryR0:10,n1Ratio:2,n2Ratio:1,n3Ratio:1,loadR2:50,loadR3:40,parallelUsersCount:2,branch3Closed:true};
    const s=createInitialState(p),m=s.current;
    const G=.25*(2/50+1/40),u1=220/(1+10*G),i1=u1*G;
    expect(m.u1).toBeCloseTo(u1,10);expect(m.i1).toBeCloseTo(i1,10);
    expect(m.pInW).toBeCloseTo(220*i1,10);
    expect(m.pUserW+m.pLineLossW).toBeCloseTo(m.pInW,10);
    expect(m.efficiency).toBeCloseTo(u1/220,10);
  });
  it('flags an infeasible fixed-power request rather than fabricating an operating point',()=>{
    const p={...getPreset(1),sourceU0:100,stepUpRatioK1:5,genPowerKw:200,lineResistanceR:50};
    const s=createInitialState(p);
    expect(computeStatus(s)).toBe(0);
    expect(s.current.pInW).toBe(0);
    expect(s.current.lineCurrentA).toBe(0);
    expect(s.current.pUserW).toBe(0);
    expect(s.current.pLineLossW).toBe(0);
  });
  it('does not certify an impossible operating point as a successful conservation audit',()=>{
    const p={...getPreset(1),sourceU0:100,stepUpRatioK1:5,genPowerKw:200,lineResistanceR:50};
    const s=createInitialState(p);
    expect(checkInvariants(s,s,p).some(x=>!x.passed)).toBe(true);
  });
  it('rejects a corrupted displayed secondary power instead of re-solving the ideal state',()=>{
    const p=getPreset(0),s=createInitialState(p),bad={...s,current:{...s.current,pUserW:s.current.pUserW+100}};
    expect(checkInvariants(bad,s,p).some(x=>!x.passed)).toBe(true);
  });
  it('zero power does not imply 100 percent actual transfer efficiency',()=>{
    const p={...getPreset(1),genPowerKw:0},s=createInitialState(p);
    expect(s.current.efficiency).toBe(0);
  });
});
function computeStatus(s: ReturnType<typeof createInitialState>){
  return computeObservables(s).operatingPointValid;
}

describe('E08 grid operating domain',()=>{
  it('uses actual I²R, receiving voltage, and power ledger without clipping in the valid region',()=>{
    const p={...getPreset(1),sourceU0:250,stepUpRatioK1:20,lineResistanceR:20,genPowerKw:100};
    const s=createInitialState(p),m=s.current;
    expect(m.lineVoltageV).toBe(5000);expect(m.lineCurrentA).toBe(20);
    expect(m.u2).toBe(4600);expect(m.pLineLossW).toBe(8000);expect(m.pUserW).toBe(92000);
    expect(m.u3*m.i3).toBeCloseTo(92000,8);expect(m.efficiency).toBeCloseTo(.92,10);
    expect(checkInvariants(s,s,p).every(r=>r.passed)).toBe(true);
  });
  it('distinguishes the short-circuit boundary and zero resistance from a normal regulated bus',()=>{
    const p={...getPreset(1),sourceU0:100,stepUpRatioK1:5,lineResistanceR:50,genPowerKw:5};
    const s=createInitialState(p),m=s.current;
    expect(m.operatingPointValid).toBe(1);expect(m.u2).toBe(0);expect(m.u3).toBe(0);
    expect(m.pLineLossW).toBe(5000);expect(m.pUserW).toBe(0);
    const z=createInitialState({...p,lineResistanceR:0}).current;
    expect(z.powerLimitDefined).toBe(0);expect(z.pLineLossW).toBe(0);expect(z.efficiency).toBe(1);
  });
  it('disconnected secondary retains induced voltage but carries no current',()=>{
    const p={...getPreset(0),branch3Closed:false,parallelUsersCount:0};
    const s=createInitialState(p),m=s.current;
    expect(m.u3).toBeGreaterThan(0);expect(m.i3).toBe(0);expect(m.i2).toBe(0);
    expect(m.pInW).toBe(0);expect(m.efficiencyDefined).toBe(0);
    expect(checkInvariants(s,s,p).every(r=>r.passed)).toBe(true);
  });
});

describe('E08 truthful topology export and mode controls',()=>{
  const layers=new Set(['topology','powerWaterfall']);
  it('shares the full visible geometry with print output and separates both topologies',()=>{
    const p=getPreset(0),s=createInitialState(p),g=getPreset(1),gs=createInitialState(g);
    const a=emTransformerGridPlugin.exportDiagramIR!(s,p),b=emTransformerGridPlugin.exportDiagramIR!(gs,g);
    expect(a.primitives).toEqual(transformerScene(s,p,layers).map(m=>m.primitive));
    expect(b.primitives).toEqual(transformerScene(gs,g,layers).map(m=>m.primitive));
    expect(a.title).not.toBe(b.title);
    expect(a.primitives.some(q=>q.kind==='text'&&q.text.includes('副路2'))).toBe(true);
    expect(b.primitives.some(q=>q.kind==='text'&&q.text.includes('U送='))).toBe(true);
    expect(emTransformerGridPlugin.getParamFields!(p).some(f=>f.key==='genPowerKw')).toBe(false);
    expect(emTransformerGridPlugin.getParamFields!(g).some(f=>f.key==='primaryR0')).toBe(false);
  });
  it('renders an actual open switch gap and never a fake power ledger for an invalid request',()=>{
    const p={...getPreset(0),branch3Closed:false},s=createInitialState(p);
    const a=transformerScene(s,p,layers).map(m=>m.primitive);
    expect(a.some(q=>q.kind==='line'&&q.x1===1.16&&q.x2===1.66&&q.y1!==q.y2)).toBe(true);
    const g={...getPreset(1),sourceU0:100,stepUpRatioK1:5,genPowerKw:200,lineResistanceR:50},gs=createInitialState(g);
    const b=transformerScene(gs,g,layers).map(m=>m.primitive);
    expect(b.some(q=>q.kind==='text'&&q.text.includes('无无源受端工作点'))).toBe(true);
    expect(b.some(q=>q.kind==='text'&&q.text.includes('效率 '))).toBe(false);
  });
});
