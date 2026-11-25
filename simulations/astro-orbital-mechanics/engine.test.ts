import { resolvePluginParams } from '@physforge/sim-sdk';
import { describe, expect, it } from 'vitest';
import { astroOrbitalMechanicsPlugin } from './plugin.js';
import { astroOrbitalPresets } from './presets.js';
import {
  buildAstroScaleContext,
  binaryGravityAt,checkInvariants,
  computeLagrangePoints,
  computeObservables,
  createInitialState,
  stepAstroOrbital,
  type AstroOrbitalParams
} from './engine.js';

function getPreset(idx: number): AstroOrbitalParams {
  return resolvePluginParams(astroOrbitalMechanicsPlugin.paramSchema, astroOrbitalPresets[idx]!.params);
}

describe('astro-orbital-mechanics ScaleContext & symplectic invariants (M10)', () => {
  it('conserves energy, semi-major axis (<1e-6), and angular momentum (<1e-7) over 50 full orbital periods', () => {
    const params = getPreset(0);
    let state = createInitialState(params);
    const obs0 = computeObservables(state, params);
    const a0 = obs0.semiMajorAxisNorm!;
    const periodNorm = 2 * Math.PI * Math.pow(a0, 1.5);
    const totalSimTime = 50 * periodNorm;

    const dt = 0.25;
    const steps = Math.ceil(totalSimTime / dt);
    for (let i = 0; i < steps; i++) {
      state = stepAstroOrbital(state, params, dt).nextState;
    }

    const obsEnd = computeObservables(state, params);
    const relEnergyDrift = Math.abs(obsEnd.energyNorm! - state.energyNorm0) / Math.abs(state.energyNorm0);
    const relAxisDrift = Math.abs(obsEnd.semiMajorAxisNorm! - a0) / a0;
    const relLzDrift = Math.abs(obsEnd.angularMomNorm! - state.angularMomNorm0) / Math.abs(state.angularMomNorm0);

    expect(relEnergyDrift).toBeLessThan(1e-6);
    expect(relAxisDrift).toBeLessThan(1e-6);
    expect(relLzDrift).toBeLessThan(1e-7);
  });

  it('executes Hohmann dual-burn transfer matching analytical deltaV (<1e-5) and circularizes at r2', () => {
    const params = getPreset(1);
    const { muSI, r1SI } = buildAstroScaleContext(params);
    const rho = params.r2OverR1;
    const r2SI = rho * r1SI;
    const expectedDv1 = Math.sqrt(muSI / r1SI) * (Math.sqrt((2 * rho) / (1 + rho)) - 1);
    const expectedDv2 = Math.sqrt(muSI / r2SI) * (1 - Math.sqrt(2 / (1 + rho)));

    let state = createInitialState(params);
    const tHalf = Math.PI * Math.pow((1 + rho) / 2, 1.5);
    const steps = Math.ceil((tHalf + 0.5) / 0.05);
    for (let i = 0; i < steps; i++) {
      state = stepAstroOrbital(state, params, 0.05).nextState;
    }

    expect(state.hohmannPhase).toBe('circularized');
    expect(Math.abs(state.deltaV1SI - expectedDv1) / expectedDv1).toBeLessThan(1e-5);
    expect(Math.abs(state.deltaV2SI - expectedDv2) / expectedDv2).toBeLessThan(1e-5);

    const obs = computeObservables(state, params);
    expect(obs.eccentricity!).toBeLessThan(1e-4);
    expect(Math.abs(obs.rNorm! - rho)).toBeLessThan(1e-4);
  });

  it('finds restricted 3-body Lagrange points L1-L5 with zero effective-potential gradient and finite boundaries', () => {
    const q = 0.05;
    const pts = computeLagrangePoints(q);
    expect(pts).toHaveLength(5);
    const mu1 = 1 - q;
    const mu2 = q;
    for (const lp of pts) {
      const r1 = Math.hypot(lp.x + q, lp.y);
      const r2 = Math.hypot(lp.x - (1 - q), lp.y);
      const gx = lp.x - (mu1 * (lp.x + q)) / r1 ** 3 - (mu2 * (lp.x - (1 - q))) / r2 ** 3;
      const gy = lp.y - (mu1 * lp.y) / r1 ** 3 - (mu2 * lp.y) / r2 ** 3;
      expect(Math.hypot(gx, gy)).toBeLessThan(1e-9);
    }

    const p0 = getPreset(3);
    const s0 = createInitialState(p0);
    expect(stepAstroOrbital(s0, p0, 0).nextState).toEqual(s0);
  });
});

describe('M10 physically independent regression gates',()=>{
  it('emits every complete .55-time sector, at the actual time boundary, even across one large step',()=>{
    const p={...getPreset(0),v0Ratio:1,simSpeed:1};
    const s=stepAstroOrbital(createInitialState(p),p,1.4).nextState;
    expect(s.sectors).toHaveLength(2);
    expect(s.sectorStartTNorm).toBeCloseTo(1.1,10);
    for(let i=0;i<2;i++){
      const sec=s.sectors[i]!,end=sec.vertices.at(-1)!;
      expect(Math.hypot(end.x-Math.cos(.55*(i+1)),end.y-Math.sin(.55*(i+1)))).toBeLessThan(1e-6);
      expect(Math.abs(sec.areaDimless-.275)/.275).toBeLessThan(1e-4);
    }
    expect(s.currentSectorVerts[0]).toEqual(s.sectors[1]!.vertices.at(-1));
  });
  it('has real historical time for each trail sample and preserves the exact initial point',()=>{
    const p=getPreset(3);
    const s=stepAstroOrbital(createInitialState(p),p,2).nextState;
    expect(s.trailNorm.length).toBeGreaterThan(20);
    let previous=-1;
    for(const point of s.trailNorm){
      const t=Number('tNorm' in point?point.tNorm:NaN);
      expect(Number.isFinite(t)).toBe(true);
      expect(t).toBeGreaterThan(previous);
      expect(t).toBeLessThanOrEqual(s.tNorm+1e-10);
      previous=t;
    }
    expect(Number('tNorm' in s.trailNorm[0]!?s.trailNorm[0]!.tNorm:NaN)).toBe(0);
  });
  it('propagates the exact Newtonian L4 solution for a full period, not an inconsistent softened force',()=>{
    const p={...getPreset(3),massRatioQ:.03,simSpeed:1};
    const x=.5-p.massRatioQ,y=Math.sqrt(3)/2;
    let s={...createInitialState(p),xNorm:x,yNorm:y,vxNorm:-y,vyNorm:x};
    for(let i=0;i<480;i++)s=stepAstroOrbital(s,p,2*Math.PI/480).nextState;
    expect(Math.hypot(s.xNorm-x,s.yNorm-y,s.vxNorm+y,s.vyNorm-x)).toBeLessThan(1e-6);
  });
  it('matches independent inertial three-body reference and conserves the physical Jacobi integral',()=>{
    const p=getPreset(3);let s=createInitialState(p);
    const jacobi=(v:typeof s)=>{
      const c=Math.cos(v.tNorm),sin=Math.sin(v.tNorm),q=p.massRatioQ;
      const d1=Math.hypot(v.xNorm+q*c,v.yNorm+q*sin),d2=Math.hypot(v.xNorm-(1-q)*c,v.yNorm-(1-q)*sin);
      return 2*((1-q)/d1+q/d2)+v.xNorm**2+v.yNorm**2-(v.vxNorm+v.yNorm)**2-(v.vyNorm-v.xNorm)**2;
    };
    const c0=jacobi(s);expect(c0).toBeCloseTo(2.9710356841820307,10);
    for(let i=0;i<200;i++)s=stepAstroOrbital(s,p,.01).nextState;
    expect(Math.hypot(s.xNorm+.95455016,s.yNorm-.06437589,s.vxNorm+.05094896,s.vyNorm+1.00075066)).toBeLessThan(2e-7);
    expect(computeObservables(s,p).jacobiConstant).toBeCloseTo(jacobi(s),9);
    for(let i=0;i<1000;i++)s=stepAstroOrbital(s,p,.01).nextState;
    expect(Math.abs(jacobi(s)-c0)).toBeLessThan(1e-7);
  });
  it('uses the exact parabolic threshold in the escape preset, not a bound ellipse mislabeled as escape',()=>{
    const p=getPreset(2);
    expect(p.v0Ratio).toBe(Math.SQRT2);
    expect(Math.abs(computeObservables(createInitialState(p),p).energyNorm!)).toBeLessThan(1e-12);
  });
});

describe('M10 physical boundary and mode contracts',()=>{
  it('keeps polygon area equal across irregular caller steps with simSpeed=2.5',()=>{
    const p={...getPreset(0),simSpeed:2.5};
    let s=createInitialState(p);
    for(const dt of [.07,.19,.26,.43,.59])s=stepAstroOrbital(s,p,dt).nextState;
    expect(s.sectors).toHaveLength(6);
    for(const sec of s.sectors){
      expect(sec.endTNorm-sec.startTNorm).toBeCloseTo(.55,12);
      expect(Math.abs(sec.areaDimless-.5*p.v0Ratio*.55)/(.5*p.v0Ratio*.55)).toBeLessThan(1e-4);
    }
    expect(s.trailNorm.length).toBeLessThanOrEqual(421);
  });
  it('uses true binary energy and Jacobi, finite core potential, no two-body orbital elements',()=>{
    const p={...getPreset(3),massRatioQ:.4},s=createInitialState(p);
    const obs=computeObservables(s,p);
    expect(obs.semiMajorAxisNorm).toBeUndefined();
    expect(obs.eccentricity).toBeUndefined();
    const g=binaryGravityAt(s.xNorm,s.yNorm,s.tNorm,p.massRatioQ);
    expect(obs.energyNorm).toBeCloseTo(.5*(s.vxNorm**2+s.vyNorm**2)-g[0]!.potential-g[1]!.potential,12);
    expect(checkInvariants(s,s,p)[0]!.passed).toBe(true);
    for(const q of [.01,.4,.49]){
      const lps=computeLagrangePoints(q);
      for(const l of lps){
        const a=binaryGravityAt(l.x,l.y,0,q);
        expect(Math.hypot(l.x+a[0]!.ax+a[1]!.ax,l.y+a[0]!.ay+a[1]!.ay)).toBeLessThan(1e-9);
      }
      for(const r of [0,.0009,.001,.0011]){
        const a=binaryGravityAt(-q+r,0,0,q);
        expect(a.every(x=>[x.ax,x.ay,x.potential].every(Number.isFinite))).toBe(true);
      }
    }
  });
  it('returns finite observables and an absolute invariant for an exact escape threshold',()=>{
    const p=getPreset(2),initial=createInitialState(p);
    const s=stepAstroOrbital(initial,p,5).nextState;
    expect(Object.values(computeObservables(s,p)).every(Number.isFinite)).toBe(true);
    expect(checkInvariants(s,initial,p).every(x=>x.passed)).toBe(true);
  });
});
