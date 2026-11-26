import { resolvePluginParams } from '@physforge/sim-sdk';
import { describe, expect, it } from 'vitest';
import { emWireframeRotationPlugin } from './plugin.js';
import { wireframePresets } from './presets.js';
import {
  checkInvariants,
  computeObservables,
  computeFluxAndCuttingFactor,
  createInitialState,
  stepWireframeRotation,
  type WireframeParams
} from './engine.js';

function getPreset(idx: number): WireframeParams {
  return resolvePluginParams(emWireframeRotationPlugin.paramSchema, wireframePresets[idx]!.params);
}

describe('em-wireframe-rotation cutting & energy conservation (E05)', () => {
  it('verifies exact 2.000x EMF ratio when crossing boundary between +B and -B vs entering +B', () => {
    const params = getPreset(0); // dual-opposite L=0.8, H=1.0
    const enterSingleFactor = Math.abs(computeFluxAndCuttingFactor(-0.2, params).dPhiDy); // bottom entered +B
    const crossDualFactor = Math.abs(computeFluxAndCuttingFactor(-1.0, params).dPhiDy); // center at boundary -H
    expect(Math.abs(crossDualFactor / enterSingleFactor - 2.0)).toBeLessThan(1e-10);
  });

  it('conserves mechanical + Joule energy (mg*dh = dEk + Q < 1e-6) during free-fall crossing', () => {
    const params = getPreset(0);
    const initial = createInitialState(params);
    let st = initial;
    for (let i = 0; i < 150; i++) {
      st = stepWireframeRotation(st, params, 0.01).nextState;
    }
    expect(st.jouleHeatJ).toBeGreaterThan(0.1);
    const reports = checkInvariants(st, initial, params);
    expect(reports[0]!.passed).toBe(true);
    expect(reports[0]!.measuredError).toBeLessThan(1e-6);
  });

  it('matches rotating rod & Faraday disk EMF = 0.5*B*omega*R^2 within < 1e-10 and stays finite at B=0', () => {
    const disk = getPreset(3);
    const st = stepWireframeRotation(createInitialState(disk), disk, 0.1).nextState;
    const expected = 0.5 * disk.magneticB * disk.omegaRadS * disk.loopSizeL * disk.loopSizeL;
    expect(Math.abs(st.emfV - expected)).toBeLessThan(1e-10);

    const zeroB: WireframeParams = { ...getPreset(0), magneticB: 0 };
    const s0 = createInitialState(zeroB);
    expect(stepWireframeRotation(s0, zeroB, 0).nextState).toEqual(s0);
  });
});

describe('E05 independent flux, derivative and driven rotation references',()=>{
  const base:WireframeParams={...getPreset(0),magneticB:2,loopSizeL:1,zoneHeightH:2,fieldProfile:'single-zone',loopShape:'square'};
  it('matches fractional rectangular overlap rather than a midpoint staircase',()=>{
    for(const yc of [.1234,.23456,-.12345]){
      const q=computeFluxAndCuttingFactor(yc,base);
      expect(q.fluxWb).toBeCloseTo(2*(.5-yc),12);
      expect(q.dPhiDy).toBeCloseTo(-2,12);
      const h=1e-5;
      expect((computeFluxAndCuttingFactor(yc+h,base).fluxWb-computeFluxAndCuttingFactor(yc-h,base).fluxWb)/(2*h)).toBeCloseTo(-2,8);
    }
  });
  it('uses the correct triangular base-down geometry and its exact partial area',()=>{
    const p={...base,loopShape:'triangle' as const};
    for(const yc of [.1234,-.2134]){
      const u=-yc,area=.5*u-.5*u*u+.375;
      const q=computeFluxAndCuttingFactor(yc,p);
      expect(q.fluxWb).toBeCloseTo(2*area,12);
      expect(q.dPhiDy).toBeCloseTo(-2*(.5-u),12);
    }
  });
  it('uses the exact circular segment area and chord derivative',()=>{
    const p={...base,loopShape:'circle' as const},r=.5;
    for(const yc of [.1234,-.2134]){
      const u=-yc,root=Math.sqrt(r*r-u*u);
      const area=u*root+r*r*(Math.asin(u/r)+Math.PI/2);
      const q=computeFluxAndCuttingFactor(yc,p);
      expect(q.fluxWb).toBeCloseTo(2*area,12);
      expect(q.dPhiDy).toBeCloseTo(-4*root,12);
    }
  });
  it('includes the first area moment in a fully immersed gradient field',()=>{
    const p={...base,loopShape:'triangle' as const,fieldProfile:'linear-gradient' as const},yc=-1.3;
    const q=computeFluxAndCuttingFactor(yc,p);
    expect(q.fluxWb).toBeCloseTo(2*.5*(1-(yc-1/6)/4),12);
    expect(q.dPhiDy).toBeCloseTo(-.25,12);
  });
  it('distinguishes stationary disk flux, signed electromagnetic torque and drive work',()=>{
    const p={...getPreset(3),magneticB:2,loopSizeL:1,omegaRadS:3,resistanceR:2};
    const a=createInitialState(p),b=stepWireframeRotation(a,p,2).nextState;
    const o=computeObservables(b,p);
    expect(o.fluxWb).toBeCloseTo(2*Math.PI,12);
    expect(o.emfV).toBeCloseTo(3,12);
    expect(o.currentA).toBeCloseTo(1.5,12);
    expect(o.emTorqueNm).toBeCloseTo(-1.5,12);
    expect(o.drivePowerW).toBeCloseTo(4.5,12);
    expect(o.driveWorkJ).toBeCloseTo(9,12);
    expect(o.jouleHeatJ).toBeCloseTo(9,12);
    expect(computeObservables(a,p).emTorqueNm).toBeCloseTo(-1.5,12);
    const reverse={...p,omegaRadS:-3};
    const r=computeObservables(stepWireframeRotation(createInitialState(reverse),reverse,2).nextState,reverse);
    expect(r.emfV).toBeCloseTo(-3,12);
    expect(r.emTorqueNm).toBeCloseTo(1.5,12);
    expect(r.driveWorkJ).toBeCloseTo(9,12);
  });
});
