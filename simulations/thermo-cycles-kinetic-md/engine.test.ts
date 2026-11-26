import { resolvePluginParams } from '@physforge/sim-sdk';
import { describe, expect, it } from 'vitest';
import { thermoCyclesKineticMdPlugin } from './plugin.js';
import { thermoCycleMdPresets } from './presets.js';
import {
  createInitialState,
  evaluateClosedCycle,
  computeObservables,
  evaluateMaxwellKsStat,
  stepThermoCycleMd,
  type ThermoCycleMdParams
} from './engine.js';

function getPreset(idx: number): ThermoCycleMdParams {
  return resolvePluginParams(thermoCyclesKineticMdPlugin.paramSchema, thermoCycleMdPresets[idx]!.params);
}

describe('thermo-cycles-kinetic-md cycles & SpatialHash2D MD invariants (T02)', () => {
  it('conserves energy (sum dU=0, sum Q = sum W) within < 1e-10/1e-8 for Carnot and rectangular cycles', () => {
    for (const idx of [1, 2]) {
      const p = getPreset(idx);
      const c = evaluateClosedCycle(p);
      expect(Math.abs(c.sumDuJ)).toBeLessThan(1e-10);
      expect(Math.abs(c.sumQJ - c.sumWJ)).toBeLessThan(1e-8);
      if (idx === 1) {
        expect(Math.abs(c.efficiency - (1 - p.tColdK / p.tHotK))).toBeLessThan(1e-12);
      } else {
        expect(c.efficiency).toBeLessThan(c.carnotEfficiency);
      }
    }
  });

  it('conserves kinetic energy (< 1e-8) over 1000 adiabatic hard-disk MD steps and matches 2D Maxwell-Boltzmann', () => {
    const p: ThermoCycleMdParams = { ...getPreset(0), particleCountN: 300, brownianPollen: false };
    const s0 = createInitialState(p);
    let st = s0;
    for (let i = 0; i < 1000; i++) {
      st = stepThermoCycleMd(st, p, 0.005).nextState;
    }

    const relEnergyDrift = Math.abs(st.kineticEnergy - s0.kineticEnergy) / s0.kineticEnergy;
    expect(relEnergyDrift).toBeLessThan(1e-8);

    // KS critical value at N=300, alpha=0.05 is ~ 1.36 / sqrt(300) = 0.0785
    const ksStat = evaluateMaxwellKsStat(st.particles);
    expect(ksStat).toBeLessThan(0.0785);
  });

  it('reproduces identically with same seed and handles dt=0 cleanly', () => {
    const p = getPreset(0);
    const a = stepThermoCycleMd(createInitialState(p), p, 0.01).nextState;
    const b = stepThermoCycleMd(createInitialState(p), p, 0.01).nextState;
    expect(a.kineticEnergy).toBe(b.kineticEnergy);
    expect(stepThermoCycleMd(createInitialState(p), p, 0).nextState.t).toBe(0);
  });
});

describe('H45 independent cycle and hard-disk regressions',()=>{
  it('does not allocate an unrelated gas simulation or advance fictitious time for an analytic cycle',()=>{
    for(const p of [getPreset(1),getPreset(2)]){
      const s=createInitialState(p);
      expect(s.particles).toHaveLength(0);
      expect(stepThermoCycleMd(s,p,2).nextState).toEqual(s);
      const o=computeObservables(s,p);
      expect(o).not.toHaveProperty('kineticEnergy');
      expect(o).not.toHaveProperty('wallPressure');
    }
  });
  it('rejects crossed Carnot reservoir temperatures instead of silently changing the requested cold reservoir',()=>{
    const p={...getPreset(1),tHotK:400,tColdK:450};
    const s=createInitialState(p);
    expect(s.cycle.segments).toHaveLength(0);
    expect(computeObservables(s,p)).not.toHaveProperty('efficiencyPct');
  });
  it('does not fabricate a heat engine efficiency for the isolated hard-disk gas',()=>{
    const p=getPreset(0),s=createInitialState(p);
    expect(s.cycle.segments).toHaveLength(0);
    expect(computeObservables(s,p)).not.toHaveProperty('efficiencyPct');
  });
  it('places exactly N gas disks plus the optional pollen, including perfect-square populations',()=>{
    for(const N of [100,225,400]){
      const p={...getPreset(0),particleCountN:N,brownianPollen:true},s=createInitialState(p);
      expect(s.particles.filter(q=>q.mass===1)).toHaveLength(N);
      expect(s.particles.filter(q=>q.mass===20)).toHaveLength(1);
      for(let i=0;i<s.particles.length;i++){
        const a=s.particles[i]!;
        expect(a.x).toBeGreaterThanOrEqual(a.radius);expect(a.x).toBeLessThanOrEqual(s.boxSize-a.radius);
        for(let j=i+1;j<s.particles.length;j++){
          const b=s.particles[j]!;
          expect(Math.hypot(a.x-b.x,a.y-b.y)).toBeGreaterThanOrEqual(a.radius+b.radius-1e-12);
        }
      }
    }
  });
  it('accounts for every wall hit in a long isolated flight and measures impulse per wall length per elapsed time',()=>{
    const p={...getPreset(0),brownianPollen:false},base=createInitialState(p);
    const particle={x:5,y:5,vx:30,vy:0,radius:.14,mass:1};
    const s={...base,particles:[particle],kineticEnergy:450,initialKineticEnergy:450};
    const a=stepThermoCycleMd(s,p,1).nextState,b=stepThermoCycleMd(a,p,1).nextState;
    // Unfold [0.14,9.86] with length 9.72. First interval crosses 3 walls;
    // second crosses 3 more. Each collision transfers 60 reduced momentum units.
    expect(a.particles[0]!.x).toBeCloseTo(4.16,9);
    expect(a.particles[0]!.vx).toBe(-30);
    expect(a.wallPressure).toBeCloseTo(180/40,10);
    expect(b.particles[0]!.x).toBeCloseTo(6.68,9);
    expect(b.particles[0]!.vx).toBe(30);
    expect(b.wallPressure).toBeCloseTo(360/80,10);
  });
  it('does not tunnel through a head-on gas disk collision during a coarse public step',()=>{
    const p={...getPreset(0),brownianPollen:false},base=createInitialState(p);
    const s={...base,particles:[{x:4,y:5,vx:10,vy:0,radius:.14,mass:1},{x:6,y:5,vx:-10,vy:0,radius:.14,mass:1}],kineticEnergy:100,initialKineticEnergy:100};
    const r=stepThermoCycleMd(s,p,.2).nextState;
    expect(r.particles[0]!.vx).toBeCloseTo(-10,10);
    expect(r.particles[1]!.vx).toBeCloseTo(10,10);
    expect(r.particles[0]!.x).toBeLessThan(r.particles[1]!.x);
    expect(r.kineticEnergy).toBeCloseTo(100,10);
  });
  it('detects gas-pollen collisions across two old hash cells, with correct unequal-mass impulse',()=>{
    const p=getPreset(0),base=createInitialState(p);
    const s={...base,particles:[{x:1.06,y:5,vx:0,vy:0,radius:.32,mass:20},{x:.61,y:5,vx:1,vy:0,radius:.14,mass:1}],kineticEnergy:.5,initialKineticEnergy:.5};
    const a=stepThermoCycleMd(s,p,.001).nextState;
    expect(a.particles[0]!.vx).toBeCloseTo(2/21,10);
    expect(a.particles[1]!.vx).toBeCloseTo(-19/21,10);
    expect(a.kineticEnergy).toBeCloseTo(.5,10);
  });
  it('keeps particles inside the reflecting box even when disk overlap correction pushes them toward a wall',()=>{
    const p={...getPreset(0),brownianPollen:false},base=createInitialState(p);
    const s={...base,particles:[{x:.14,y:5,vx:0,vy:0,radius:.14,mass:1},{x:.29,y:5,vx:-1,vy:0,radius:.14,mass:1}],kineticEnergy:.5,initialKineticEnergy:.5};
    const a=stepThermoCycleMd(s,p,.01).nextState;
    expect(a.particles.every(q=>q.x>=q.radius-1e-12&&q.x<=a.boxSize-q.radius+1e-12)).toBe(true);
    expect(a.kineticEnergy).toBeCloseTo(.5,10);
  });
});
