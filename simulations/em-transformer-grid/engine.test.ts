import { resolvePluginParams } from '@physforge/sim-sdk';
import { describe, expect, it } from 'vitest';
import { emTransformerGridPlugin } from './plugin.js';
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
