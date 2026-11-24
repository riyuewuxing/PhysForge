import { resolvePluginParams } from '@physforge/sim-sdk';
import { describe, expect, it } from 'vitest';
import { em3dMagneticFieldsPlugin } from './plugin.js';
import { magnetic3dPresets } from './presets.js';
import {
  MU_0,
  checkInvariants,
  createInitialState,
  evalBiotSavartB,
  stepMagnetic3d,
  trace3dFieldLines,
  getMagneticDisplayFieldLines,
  buildMagneticConductorPaths,
  type Magnetic3dParams
} from './engine.js';

function getPreset(idx: number): Magnetic3dParams {
  return resolvePluginParams(em3dMagneticFieldsPlugin.paramSchema, magnetic3dPresets[idx]!.params);
}

describe('em-3d-magnetic-fields Biot-Savart & 3D Boris invariants (E10)', () => {
  it('seeds both positive and negative side-view halves for loop and Helmholtz fields', () => {
    for (const presetIndex of [0, 1]) {
      const params = getPreset(presetIndex);
      const lines = trace3dFieldLines(params);
      const starts = lines.map(line => line[0]!);
      const R = params.radiusR;

      expect(starts).toHaveLength(7);
      for (const y of [0.35 * R, -0.35 * R, 0.65 * R, -0.65 * R]) {
        expect(starts.some(point => point.x === 0 && point.y === y && point.z === -1.3)).toBe(true);
      }
    }
  });

  it('uses no degenerate field lines at zero and follows the signed uniform field', () => {
    expect(getMagneticDisplayFieldLines({ ...getPreset(2), currentI: 0 })).toEqual([]);
    const uniform = { ...getPreset(3), uniformBz: 0 };
    expect(getMagneticDisplayFieldLines(uniform)).toEqual([]);
    for (const sign of [-1, 1]) {
      const lines = getMagneticDisplayFieldLines({ ...uniform, uniformBz: sign });
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) expect(Math.sign(line.at(-1)!.z - line[0]!.z)).toBe(sign);
    }
  });

  it('samples the bore and outer solenoid field with real tangent directions and caches independently of particle parameters', () => {
    const params = getPreset(2);
    const lines = getMagneticDisplayFieldLines(params);
    expect(lines).toHaveLength(33);
    expect(getMagneticDisplayFieldLines({ ...params, qOverM: params.qOverM + 0.5, vPerp: 0 })).toBe(lines);
    for (const line of lines) {
      expect(line.length).toBeGreaterThan(1);
      expect(line.every(q => [q.x, q.y, q.z].every(Number.isFinite))).toBe(true);
      const i = Math.floor(line.length / 2);
      const a = line[i - 1]!, b = line[i]!;
      const field = evalBiotSavartB({ x: (a.x+b.x)/2, y: (a.y+b.y)/2, z: (a.z+b.z)/2 }, params);
      const dx = b.x-a.x, dy = b.y-a.y, dz = b.z-a.z;
      const cosine = (dx*field.x+dy*field.y+dz*field.z)/(Math.hypot(dx,dy,dz)*Math.hypot(field.x,field.y,field.z));
      expect(cosine).toBeGreaterThan(0.97);
    }
    expect(getMagneticDisplayFieldLines({ ...params, currentI: 0 })).not.toBe(lines);
  }, 15000);

  it('traces closed planar field lines around straight and paired finite wires with real tangents', () => {
    for (const geometryType of ['straight-wire','parallel-wires'] as const) {
      const params={...getPreset(2),geometryType};
      const lines=getMagneticDisplayFieldLines(params);
      expect(lines).toHaveLength(geometryType==='straight-wire'?9:15);
      for (const line of lines) {
        const seed=line[0]!, end=line.at(-1)!;
        expect(Math.hypot(end.x-seed.x,end.y-seed.y)).toBeLessThan(0.03*params.radiusR);
        expect(line.length).toBeGreaterThan(30);
        for (let i=1;i<line.length;i+=7) {
          const a=line[i-1]!,b=line[i]!;
          expect(b.z).toBeCloseTo(seed.z,10);
          const B=evalBiotSavartB({x:(a.x+b.x)/2,y:(a.y+b.y)/2,z:seed.z},params);
          const dx=b.x-a.x,dy=b.y-a.y;
          expect((dx*B.x+dy*B.y)/(Math.hypot(dx,dy)*Math.hypot(B.x,B.y))).toBeGreaterThan(.995);
        }
      }
      if(geometryType==='parallel-wires'){
        const nullField=evalBiotSavartB({x:0,y:0,z:0},params);
        expect(Math.hypot(nullField.x,nullField.y,nullField.z)).toBeLessThan(1e-12);
      }
    }
  });

  it('keeps the two parallel conductors continuous and physically separate', () => {
    const paths = buildMagneticConductorPaths({ ...getPreset(2), geometryType: 'parallel-wires' });
    expect(paths).toHaveLength(2);
    for (const path of paths) {
      expect(path).toHaveLength(20);
      expect(path.every(segment => segment.a.x === segment.b.x && segment.a.x === path[0]!.a.x)).toBe(true);
      for (let i = 1; i < path.length; i++) expect(path[i]!.a).toEqual(path[i-1]!.b);
    }
    expect(paths[0]![0]!.a.x).toBeLessThan(0);
    expect(paths[1]![0]!.a.x).toBeGreaterThan(0);
  });

  it('matches single circular loop on-axis Biot-Savart formula within < 1e-4 relative error', () => {
    const params = getPreset(1); // single-loop
    const R = params.radiusR;
    const I = params.currentI;
    for (const z of [0, 0.5, 1.2]) {
      const b = evalBiotSavartB({ x: 0, y: 0, z }, params);
      const expectedBz = (MU_0 * I * R * R) / (2 * Math.pow(R * R + z * z, 1.5));
      expect(Math.hypot(b.x, b.y)).toBeLessThan(1e-12);
      expect(Math.abs(b.z - expectedBz) / expectedBz).toBeLessThan(1e-4);
    }
  });

  it('matches 3D uniform helical pitch p = v_parallel * (2*pi*m)/(q*B) within < 1e-5 and conserves energy', () => {
    const helix = getPreset(3);
    const period = (2 * Math.PI) / (helix.qOverM * helix.uniformBz);
    const expectedPitch = helix.vParallel * period;
    let st = createInitialState(helix);
    const z0 = st.position.z;
    const nSteps = 200;
    const dt = period / nSteps;
    for (let i = 0; i < nSteps; i++) {
      st = stepMagnetic3d(st, helix, dt).nextState;
    }
    const dz = st.position.z - z0;
    expect(Math.abs(dz - expectedPitch) / expectedPitch).toBeLessThan(1e-5);
    expect(checkInvariants(st)[0]!.passed).toBe(true);
    expect(checkInvariants(st)[0]!.measuredError).toBeLessThan(1e-10);
  });

  it('handles I=0, qOverM=0, dt=0 boundaries cleanly without NaN', () => {
    const p0: Magnetic3dParams = { ...getPreset(0), currentI: 0, qOverM: 0 };
    const s0 = createInitialState(p0);
    expect(stepMagnetic3d(s0, p0, 0).nextState).toEqual(s0);
    const s1 = stepMagnetic3d(s0, p0, 0.1).nextState;
    expect(Number.isFinite(s1.position.x)).toBe(true);
  });

  it('qualifies the helical orbit formula as a local uniform-field approximation', () => {
    const params = getPreset(2);
    const formulas = em3dMagneticFieldsPlugin.formatFormulas?.(createInitialState(params), params);

    expect(formulas?.[0]?.latex).toContain('局部匀强');
    expect(formulas?.[0]?.latex).toContain('T');
    expect(formulas?.[0]?.latex).toContain('R');
  });

  it('starts the finite-solenoid particle inside the bore for a visible spatial vector triad', () => {
    const params = getPreset(2);
    const state = createInitialState(params);

    expect(state.position.x).toBeCloseTo(0.35 * params.radiusR, 8);
    expect(state.position.y).toBeCloseTo(0.25 * params.radiusR, 8);
    expect(state.position.z).toBeCloseTo(-0.65 * params.radiusR, 8);
    expect(Math.hypot(state.position.x, state.position.y)).toBeLessThan(params.radiusR);
  });

  it('draws a changing finite-solenoid particle trail by 0.8 s', () => {
    const params = getPreset(2);
    const initial = createInitialState(params);
    let state = initial;
    let phase = Math.atan2(initial.velocity.y, initial.velocity.x);
    let angularTravel = 0;
    for (let step = 0; step < 48; step += 1) {
      state = stepMagnetic3d(state, params, 1 / 60).nextState;
      const nextPhase = Math.atan2(state.velocity.y, state.velocity.x);
      angularTravel += Math.atan2(Math.sin(nextPhase - phase), Math.cos(nextPhase - phase));
      phase = nextPhase;
    }

    expect(state.t).toBeCloseTo(0.8, 10);
    expect(state.trail.length).toBeGreaterThan(10);
    expect(Math.abs(angularTravel)).toBeGreaterThan(4 * Math.PI);
    expect(state.trail.at(-1)).not.toEqual(initial.position);
  });

  it('traces finite-solenoid field lines bidirectionally and closes them back at each seed', () => {
    const params = getPreset(2);
    const lines = trace3dFieldLines(params);
    const expectedSeeds = [0.82, 0.86, 0.88].flatMap((radiusRatio) =>
      [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].map((angle) => ({
        x: radiusRatio * params.radiusR * Math.cos(angle),
        y: radiusRatio * params.radiusR * Math.sin(angle),
        z: 0
      }))
    );

    expect(lines).toHaveLength(expectedSeeds.length);
    const maximumExtent = Math.max(...lines.flatMap((line) => line.map((point) => Math.hypot(point.x, point.y, point.z))));
    expect(maximumExtent).toBeGreaterThan(2 * params.radiusR);
    lines.forEach((line, index) => {
      const seed = expectedSeeds[index]!;
      expect(line.length).toBeGreaterThan(80);
      expect(line.every((point) => [point.x, point.y, point.z].every(Number.isFinite))).toBe(true);
      expect(Math.max(...line.map((point) => Math.hypot(point.x, point.y, point.z))))
        .toBeLessThan(3.5 * params.radiusR);
      const seedIndex = line.reduce((bestIndex, point, pointIndex) => {
        const distance = Math.hypot(point.x - seed.x, point.y - seed.y, point.z - seed.z);
        const best = line[bestIndex]!;
        const bestDistance = Math.hypot(best.x - seed.x, best.y - seed.y, best.z - seed.z);
        return distance < bestDistance ? pointIndex : bestIndex;
      }, 0);
      expect(seedIndex).toBeGreaterThan(0);
      expect(seedIndex).toBeLessThan(line.length - 1);
      const first = line[0]!;
      const last = line[line.length - 1]!;
      expect(
        Math.hypot(first.x - seed.x, first.y - seed.y, first.z - seed.z),
        `line ${index} backward endpoint did not return to seed: ${JSON.stringify({ first, seed, points: line.length })}`
      ).toBeLessThan(0.07 * params.radiusR);
      expect(
        Math.hypot(last.x - seed.x, last.y - seed.y, last.z - seed.z),
        `line ${index} forward endpoint did not return to seed: ${JSON.stringify({ last, seed, points: line.length })}`
      ).toBeLessThan(0.07 * params.radiusR);
      const zValues = line.map((point) => point.z);
      expect(Math.abs(Math.max(...zValues) + Math.min(...zValues))).toBeLessThan(0.1 * params.radiusR);
    });

    for (const firstIndex of [0, 4, 8]) {
      const positiveXLine = lines[firstIndex]!;
      const negativeXLine = lines[firstIndex + 2]!;
      expect(negativeXLine).toHaveLength(positiveXLine.length);
      positiveXLine.forEach((point, pointIndex) => {
        const mirror = negativeXLine[pointIndex]!;
        expect(Math.abs(point.x + mirror.x)).toBeLessThan(1e-7);
        expect(Math.abs(point.y - mirror.y)).toBeLessThan(1e-7);
        expect(Math.abs(point.z - mirror.z)).toBeLessThan(1e-7);
      });
    }
  });
});
