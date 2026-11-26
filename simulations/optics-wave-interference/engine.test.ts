import { resolvePluginParams } from '@physforge/sim-sdk';
import { describe, expect, it } from 'vitest';
import { opticsWaveInterferencePlugin } from './plugin.js';
import { waveOpticsPresets } from './presets.js';
import {
  computeKeyOpticsMetrics,
  createInitialState,
  evalFraunhoferGratingIntensity,
  evalNewtonRingIntensity,
  evalThinFilmIntensity,
  evalWedgeThicknessMeters,
  stepWaveOptics,
  type WaveOpticsParams
} from './engine.js';

function getPreset(idx: number): WaveOpticsParams {
  return resolvePluginParams(opticsWaveInterferencePlugin.paramSchema, waveOpticsPresets[idx]!.params);
}

describe('optics-wave-interference wedge, Newton rings & missing order (O01)', () => {
  it('verifies air wedge fringe spacing delta_x = lambda/(2 n tan alpha) within < 1e-6', () => {
    const p = getPreset(0);
    const { wedgeSpacingMm } = computeKeyOpticsMetrics(p);
    // Exact dark fringe positions occur when 2*d = m*lambda (due to half-wave shift at bottom)
    expect(evalThinFilmIntensity(0, p)).toBeLessThan(1e-12);
    expect(evalThinFilmIntensity(wedgeSpacingMm!, p)).toBeLessThan(1e-12);
    expect(evalThinFilmIntensity(0.5 * wedgeSpacingMm!, p)).toBeGreaterThan(1 - 1e-12);
  });

  it('matches Newton rings dark fringe radii r_k = sqrt(k * R * lambda) within < 1e-4', () => {
    const p = getPreset(2);
    const { newtonR1Mm } = computeKeyOpticsMetrics(p);
    for (const k of [1, 2, 3]) {
      const rk = newtonR1Mm! * Math.sqrt(k);
      expect(evalNewtonRingIntensity(rk, p)).toBeLessThan(1e-4);
    }
  });

  it('suppresses missing order 3 (I < 1e-10) when d/a = 3 in Fraunhofer grating diffraction', () => {
    const p = getPreset(3); // slitWidth=4 um, gratingPitch=12 um -> d/a = 3
    const lambdaUm = p.wavelengthNm * 1e-3;
    const sinThetaOrder3 = (3 * lambdaUm) / p.gratingPitchMicron; // = lambda / a
    const missingIntensity = evalFraunhoferGratingIntensity(sinThetaOrder3, p);
    expect(missingIntensity).toBeLessThan(1e-10);

    // Order 1 remains strong
    const order1 = evalFraunhoferGratingIntensity((1 * lambdaUm) / p.gratingPitchMicron, p);
    expect(order1).toBeGreaterThan(0.4);
  });

  it('handles dt=0 and N=1 boundaries cleanly without NaN', () => {
    const p0: WaveOpticsParams = { ...getPreset(3), slitCountN: 1 };
    const s0 = createInitialState(p0);
    expect(stepWaveOptics(s0, p0, 0).nextState.t).toBe(0);
    expect(Number.isFinite(evalFraunhoferGratingIntensity(0, p0))).toBe(true);
  });
});

describe('H42 independent optical domain and phase regressions', () => {
  it('zero-angle flat film is a constant dark or bright field, not a fictitious wedge', () => {
    const p={...getPreset(0),wedgeAngleDeg:0};
    expect(evalThinFilmIntensity(10,p)).toBeLessThan(1e-14);
    expect(evalThinFilmIntensity(17,{...p,halfWaveLoss:false})).toBeCloseTo(1,14);
    expect(computeKeyOpticsMetrics(p).wedgeSpacingMm).toBeUndefined();
  });
  it('first positive Newton dark ring changes with reflected phase and uses exact spherical geometry', () => {
    const p={...getPreset(2),refractiveIndexN2:1.4,halfWaveLoss:false};
    const h=p.wavelengthNm*1e-9/(4*p.refractiveIndexN2);
    const exact=1000*Math.sqrt(h*(2*p.lensRadiusR-h));
    const r=computeKeyOpticsMetrics(p).newtonR1Mm;
    expect(r).toBeCloseTo(exact,10);
    expect(evalNewtonRingIntensity(r!,p)).toBeLessThan(1e-14);
    expect(evalNewtonRingIntensity(0,p)).toBeCloseTo(1,14);
  });
  it('spherical sag and dark-center intensity are stable at submicrometric radial distance', () => {
    const p=getPreset(2);
    const r=1e-6,R=p.lensRadiusR;
    const h=r*r/(R+Math.sqrt(R*R-r*r));
    const expected=Math.sin(2*Math.PI*p.refractiveIndexN2*h/(p.wavelengthNm*1e-9))**2;
    expect(Math.abs(evalNewtonRingIntensity(r*1000,p)!/expected-1)).toBeLessThan(1e-6);
  });
  it('does not extend the spherical lens beyond its defined radius', () => {
    expect(evalNewtonRingIntensity(501,{...getPreset(2),lensRadiusR:.5})).toBeUndefined();
  });
  it('rejects overlapping multi-slits and out-of-domain sine rather than silently editing geometry', () => {
    const p={...getPreset(3),slitWidthMicron:8,gratingPitchMicron:4};
    expect(evalFraunhoferGratingIntensity(.15,p)).toBeUndefined();
    expect(evalFraunhoferGratingIntensity(1.01,getPreset(3))).toBeUndefined();
    expect(computeKeyOpticsMetrics(p)).toMatchObject({gratingValid:false,missingOrders:[]});
  });
  it('lists actual missing orders for noninteger pitch/width and removes nonexistent single-slit orders', () => {
    const p={...getPreset(3),wavelengthNm:500,slitWidthMicron:2,gratingPitchMicron:5};
    expect(computeKeyOpticsMetrics(p)).toMatchObject({gratingValid:true,gratingMaxOrder:10,missingOrders:[5,10]});
    expect(evalFraunhoferGratingIntensity(.5,p)).toBeLessThan(1e-14);
    expect(evalFraunhoferGratingIntensity(.1,p)).toBeGreaterThan(.4);
    const s={...p,slitCountN:1,gratingPitchMicron:1};
    expect(evalFraunhoferGratingIntensity(0,s)).toBeCloseTo(1,14);
    expect(computeKeyOpticsMetrics(s)).toMatchObject({gratingValid:true,missingOrders:[]});
    expect(computeKeyOpticsMetrics(s).missingOrder).toBeUndefined();
  });
  it('static monochromatic intensity has no fabricated evolution time', () => {
    const p=getPreset(0);
    expect(stepWaveOptics(createInitialState(p),p,2).nextState.t).toBe(0);
  });
});

describe('shared physical field invariants',()=>{
  it('local lower-surface defects have opposite gap perturbations and vanish transversely',()=>{
    const p=getPreset(0),h=evalWedgeThicknessMeters(10,p)!;
    expect(evalWedgeThicknessMeters(10,{...p,defectMode:'bump'})!).toBeCloseTo(h-.4e-6,14);
    expect(evalWedgeThicknessMeters(10,{...p,defectMode:'pit'})!).toBeCloseTo(h+.4e-6,14);
    expect(evalWedgeThicknessMeters(10,{...p,defectMode:'pit'},20)).toBeCloseTo(h,14);
  });
  it('reflection phases are complementary across the two-beam field',()=>{
    const p=getPreset(1);
    for(let x=0;x<=20;x+=.125)expect(evalThinFilmIntensity(x,p)!+evalThinFilmIntensity(x,{...p,halfWaveLoss:!p.halfWaveLoss})!).toBeCloseTo(1,13);
  });
  it('multi-slit removable limit agrees with explicit coherent phasor sum',()=>{
    const p=getPreset(3),lambda=p.wavelengthNm*1e-3;
    for(const q of [0,.001,.04,.12,lambda/p.gratingPitchMicron,lambda/p.gratingPitchMicron+1e-10,-.2,1]){
      let re=0,im=0;
      for(let j=0;j<p.slitCountN;j++){const phase=2*Math.PI*j*p.gratingPitchMicron*q/lambda;re+=Math.cos(phase);im+=Math.sin(phase);}
      const beta=Math.PI*p.slitWidthMicron*q/lambda;
      const env=beta===0?1:(Math.sin(beta)/beta)**2;
      expect(evalFraunhoferGratingIntensity(q,p)).toBeCloseTo(env*(re*re+im*im)/p.slitCountN**2,12);
    }
  });
});
