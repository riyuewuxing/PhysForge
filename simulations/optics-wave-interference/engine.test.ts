import { resolvePluginParams } from '@physforge/sim-sdk';
import { describe, expect, it } from 'vitest';
import { opticsWaveInterferencePlugin } from './plugin.js';
import { waveOpticsPresets } from './presets.js';
import { makeOpticsProfile, averageNewtonPixel, makeOpticsApparatus, binOpticsProfile, newtonDisplayGain, averageNewtonDisplayPixel, filterNewtonDisplayMean, newtonDisplayNeedsFilter } from './sceneGeometry.js';
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

describe('O01 display sampling and export consistency',()=>{
  it('resolves dense outer Newton fringes at the legal wavelength/index/radius extrema',()=>{
    const p={...getPreset(2),wavelengthNm:400,refractiveIndexN2:1.8,lensRadiusR:.5};
    const profile=makeOpticsProfile(p),R=p.lensRadiusR;
    const phase=(u:number)=>{const r=Math.abs(profile.min+u*(profile.max-profile.min))*1e-3;return 4*Math.PI*p.refractiveIndexN2*r*r/((R+Math.sqrt(R*R-r*r))*p.wavelengthNm*1e-9);};
    let max=0;
    for(let i=1;i<profile.points.length;i++)max=Math.max(max,Math.abs(phase(profile.points[i]!.u)-phase(profile.points[i-1]!.u)));
    expect(max).toBeLessThan(Math.PI/4);
  });
  it('approximates independently integrated dense-fringe screen pixels without replacing point physics',()=>{
    const p={...getPreset(2),wavelengthNm:400,refractiveIndexN2:1.8,lensRadiusR:.5},x=4.4,y=.8,dx=.04,dy=.04;
    let sum=0;const count=100;
    for(let i=0;i<count;i++)for(let j=0;j<count;j++)sum+=evalNewtonRingIntensity(Math.hypot(x+dx*((i+.5)/count-.5),y+dy*((j+.5)/count-.5)),p)!;
    expect(averageNewtonPixel(p,x,y,dx,dy)).toBeCloseTo(sum/(count*count),2);
    expect(averageNewtonPixel(p,x,y,0,0)).toBeCloseTo(evalNewtonRingIntensity(Math.hypot(x,y),p)!,14);
  });
  it('exports the actual mode-specific profile, including the Newton radial diameter and invalid geometry',()=>{
    for(const p of [getPreset(0),getPreset(2),getPreset(3),{...getPreset(3),slitWidthMicron:8,gratingPitchMicron:4}]){
      const profile=makeOpticsProfile(p),ir=opticsWaveInterferencePlugin.exportDiagramIR!(createInitialState(p),p);
      const curve=ir.primitives.find(v=>v.kind==='polyline');
      if(!profile.points.length)expect(curve).toBeUndefined();
      else if(curve?.kind==='polyline'){
        expect(curve.points.length).toBe(profile.points.length);
        for(const i of [0,Math.floor(profile.points.length/2),profile.points.length-1]){
          expect(curve.points[i]!.x).toBeCloseTo(-2+4*profile.points[i]!.u,12);
          expect(curve.points[i]!.y).toBeCloseTo(profile.points[i]!.intensity,12);
        }
      }else throw Error('missing mode profile');
    }
  });
});

describe('H43 shared teaching geometry and display conservation',()=>{
  it('uses actual wedge gap at every section sample including contact and defects',()=>{
    for(const defectMode of ['flat','bump','pit'] as const)for(const wedgeAngleDeg of [0,.012,.03]){
      const p={...getPreset(0),defectMode,wedgeAngleDeg},a=makeOpticsApparatus(p);
      expect(a.valid).toBe(true);
      for(const s of a.gapSamples!){
        const h=Math.max(0,s.xMm*1e-3*Math.tan(wedgeAngleDeg*Math.PI/180)+(defectMode==='flat'?0:(defectMode==='bump'?-1:1)*.4e-6*Math.exp(-((s.xMm-10)**2)/4)));
        expect(s.gapM).toBeCloseTo(h,14);
        expect(s.upperY-s.lowerY).toBeCloseTo(45000*h,12);
      }
    }
  });
  it('keeps the spherical interface in contact at the center and uses exact sag elsewhere',()=>{
    const p={...getPreset(2),lensRadiusR:.5},a=makeOpticsApparatus(p);
    expect(a.gapSamples![50]!.gapM).toBe(0);
    for(const s of a.gapSamples!){const r=s.xMm*1e-3,R=p.lensRadiusR;expect(s.gapM).toBeCloseTo(R-Math.sqrt(R*R-r*r),13);expect(s.upperY-s.lowerY).toBeCloseTo(22000*s.gapM,12);}
  });
  it('preserves slit count and width/pitch ratio without inventing overlapping openings',()=>{
    const p={...getPreset(3),slitWidthMicron:2,gratingPitchMicron:5,slitCountN:6};
    const a=makeOpticsApparatus(p),slits=a.slits!;
    expect(slits).toHaveLength(6);
    const width=slits[0]!.right-slits[0]!.left,pitch=slits[1]!.left-slits[0]!.left;
    expect(width/pitch).toBeCloseTo(.4,12);
    expect(makeOpticsApparatus({...p,slitCountN:1,gratingPitchMicron:1}).slits).toHaveLength(1);
    expect(makeOpticsApparatus({...p,slitWidthMicron:8}).slits).toEqual([]);
  });
  it('conserves piecewise-linear profile integral and reports bounded separate extrema',()=>{
    const points=[{u:0,intensity:0},{u:.25,intensity:1},{u:.5,intensity:0},{u:.75,intensity:1},{u:1,intensity:0}];
    for(const count of [1,3,7,40]){const b=binOpticsProfile(points,count);expect(b).toHaveLength(count);expect(b.reduce((sum,v)=>sum+v.mean,0)/count).toBeCloseTo(.5,12);for(const v of b){expect(v.mean).toBeGreaterThanOrEqual(v.min-1e-12);expect(v.mean).toBeLessThanOrEqual(v.max+1e-12);}}
    expect(binOpticsProfile([{u:0,intensity:.3},{u:1,intensity:.3}],7).every(b=>Math.abs(b.mean-.3)<1e-12)).toBe(true);
  });
});

describe('H88 finite-resolution Newton display low-pass is not point physics',()=>{
  const dense=()=>({...getPreset(2),wavelengthNm:400,refractiveIndexN2:1.8,lensRadiusR:.5});
  it('retains all resolved pixel intensities, phase and exact center',()=>{
    const p=dense();
    for(const loss of [true,false]){
      const q={...p,halfWaveLoss:loss};
      for(const [x,y,dx,dy] of [[0,0,.04,.04],[.1,0,.04,.04],[4,2,.0001,.0001],[4,2,0,0]] as const){
        expect(newtonDisplayGain(q,x,y,dx,dy)).toBe(1);
        expect(averageNewtonDisplayPixel(q,x,y,dx,dy)).toBe(averageNewtonPixel(q,x,y,dx,dy));
      }
      expect(evalNewtonRingIntensity(0,q)).toBe(loss?0:1);
    }
    expect(averageNewtonDisplayPixel({...p,lensRadiusR:.001},2,0,.04,.04)).toBeUndefined();
  });
  it('suppresses beyond-Nyquist contrast by independently derived local phase response',()=>{
    const p=dense(),x=4,y=0,R=p.lensRadiusR,r=x/1000;
    // d(4*pi*n*h/lambda)/dx in rad/mm, independently from spherical sag.
    const k=4*Math.PI*p.refractiveIndexN2*r/(p.wavelengthNm*1e-9*Math.sqrt(R*R-r*r))*1e-3;
    const at=(f:number)=>2*Math.PI*f/k;
    expect(newtonDisplayGain(p,x,y,at(.25),0)).toBeCloseTo(1,13);
    let previous=1;
    for(const f of [.26,.35,.49,.5,.7,1,1.3,2,3]){
      const dx=at(f),g=newtonDisplayGain(p,x,y,dx,0);
      expect(g).toBeGreaterThanOrEqual(0);expect(g).toBeLessThanOrEqual(previous+1e-14);
      previous=g;
      if(f>=.5)expect(g).toBeCloseTo(Math.exp(-2*Math.PI**2*.65**2*f*f),13);
      expect(newtonDisplayGain(p,-x,y,dx,0)).toBeCloseTo(g,14);
      expect(newtonDisplayGain(p,y,x,0,dx)).toBeCloseTo(g,14);
    }
    expect(newtonDisplayGain(p,x,0,at(.5),0)).toBeLessThan(.13);
    expect(newtonDisplayGain(p,x,0,at(1.3),0)).toBeLessThan(1e-5);
    expect(newtonDisplayNeedsFilter(p,5,.04,.04)).toBe(true);
    expect(newtonDisplayNeedsFilter(p,5,.0001,.0001)).toBe(false);
  });
  it('preserves complementary phases, bounds and the physical radial export',()=>{
    const p=dense(),profile=makeOpticsProfile(p),span=profile.max-profile.min,columns=695;
    const bins=binOpticsProfile(profile.points,columns),snapshot=JSON.stringify(profile);
    const metrics=computeKeyOpticsMetrics(p);
    const ir=opticsWaveInterferencePlugin.exportDiagramIR!(createInitialState(p),p);
    let oldEnergy=0,newEnergy=0,count=0;
    for(const bin of bins){
      const x=profile.min+span*bin.u,mean=filterNewtonDisplayMean(p,bin.mean,x,0,span/columns,0);
      expect(mean).toBeGreaterThanOrEqual(0);expect(mean).toBeLessThanOrEqual(1);
      if(Math.abs(x)>4){oldEnergy+=(bin.mean-.5)**2;newEnergy+=(mean-.5)**2;count++;}
    }
    expect(count).toBeGreaterThan(100);expect(newEnergy).toBeLessThan(oldEnergy*.0001);
    for(const [x,y] of [[.3,0],[1.5,2],[4,.5],[0,-4]] as const){
      const a=averageNewtonDisplayPixel(p,x,y,.04,.04)!;
      const b=averageNewtonDisplayPixel({...p,halfWaveLoss:false},x,y,.04,.04)!;
      expect(a+b).toBeCloseTo(1,13);
    }
    expect(JSON.stringify(makeOpticsProfile(p))).toBe(snapshot);
    expect(computeKeyOpticsMetrics(p)).toEqual(metrics);
    expect(opticsWaveInterferencePlugin.exportDiagramIR!(createInitialState(p),p)).toEqual(ir);
    expect(evalNewtonRingIntensity(metrics.newtonR1Mm!,p)).toBeLessThan(1e-12);
  });
});
