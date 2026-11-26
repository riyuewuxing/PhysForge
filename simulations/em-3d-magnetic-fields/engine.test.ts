import { resolvePluginParams } from '@physforge/sim-sdk';
import { describe, expect, it } from 'vitest';
import { em3dMagneticFieldsPlugin, magneticProjectionScene, magneticProjectionBounds } from './plugin.js';
import { magnetic3dPresets } from './presets.js';
import {
  MU_0,
  checkInvariants,
  createInitialState,
  evalBiotSavartB,
  isMagneticFieldDefinedAt,
  computeObservables,
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

describe('E10 independent signed gyro and finite-wire physics',()=>{
  it('resolves transverse phase and radius even at maximum uniform cyclotron frequency',()=>{
    for(const sign of [-1,1]){
      const p={...getPreset(3),qOverM:4*sign,uniformBz:4,vPerp:2.4,vParallel:-.7},initial=createInitialState(p),w=p.qOverM*p.uniformBz,t=1.173;
      let s=initial;
      for(let j=0;j<73;j++)s=stepMagnetic3d(s,p,t/73).nextState;
      expect(s.velocity.x).toBeCloseTo(p.vPerp*Math.cos(w*t),4);
      expect(s.velocity.y).toBeCloseTo(-p.vPerp*Math.sin(w*t),4);
      expect(s.position.x).toBeCloseTo(initial.position.x+p.vPerp/w*Math.sin(w*t),5);
      expect(s.position.y).toBeCloseTo(initial.position.y+p.vPerp/w*(Math.cos(w*t)-1),5);
      expect(s.position.z).toBeCloseTo(initial.position.z+p.vParallel*t,9);
      const radius=Math.hypot(s.position.x-initial.position.x,s.position.y-initial.position.y+p.vPerp/w);
      expect(radius).toBeCloseTo(Math.abs(p.vPerp/w),9);
    }
  });
  it('supports both signs and true zero of Bz, current and charge at the public parameter boundary',()=>{
    const base=getPreset(3),schema=em3dMagneticFieldsPlugin.paramSchema;
    const signed=resolvePluginParams(schema,{...base,uniformBz:-4,qOverM:-3,currentI:-2});
    expect(signed.uniformBz).toBe(-4);expect(signed.qOverM).toBe(-3);expect(signed.currentI).toBe(-2);
    const zero=resolvePluginParams(schema,{...base,uniformBz:0,qOverM:0,currentI:0});
    expect(zero.uniformBz).toBe(0);
  });
  it('matches the analytic finite straight segment away from the filament including near field',()=>{
    for(const rho of [.02,.12,.6,1.8])for(const z of [0,1.5,4.5]){
      const p={...getPreset(2),geometryType:'straight-wire' as const,currentI:-2.5};
      const B=evalBiotSavartB({x:rho,y:0,z},p);
      const expected=MU_0*p.currentI/(4*Math.PI*rho)*((4-z)/Math.hypot(rho,4-z)+(4+z)/Math.hypot(rho,4+z));
      expect(Math.abs((B.y-expected)/expected)).toBeLessThan(1e-8);
      expect(B.x).toBe(0);expect(B.z).toBe(0);
    }
  });
  it('rejects corrupted Lorentz acceleration that does spurious magnetic work',()=>{
    const p=getPreset(3),s=createInitialState(p);
    const bad={...s,lorentzForce:{x:10,y:0,z:2}};
    expect(checkInvariants(bad).some(r=>!r.passed)).toBe(true);
  });
  it('zero field and parallel-only motion are not described as real helical orbits',()=>{
    for(const p of [{...getPreset(3),uniformBz:0},{...getPreset(3),vPerp:0}]){
      const s=createInitialState(p);
      const f=em3dMagneticFieldsPlugin.formatFormulas!(s,p)[0]!;
      expect(f.substitutedLatex).not.toContain('R&=');
      expect(f.substitutedLatex).toContain('直线');
    }
  });
  it('uniform export never labels irrelevant source current or conductor radius',()=>{
    const p=getPreset(3),s=createInitialState(p),ir=em3dMagneticFieldsPlugin.exportDiagramIR!(s,p);
    expect(ir.primitives.some(q=>(q.kind==='text'||q.kind==='mathLabel')&&q.text.includes('I='))).toBe(false);
    expect(ir.primitives.some(q=>(q.kind==='text'||q.kind==='mathLabel')&&q.text.includes('B'))).toBe(true);
  });
});

describe('E10 reversed fields and degeneracy',()=>{
  it('analytic finite parallel wires superpose with exact central cancellation and reversed sign',()=>{
    const p={...getPreset(2),geometryType:'parallel-wires' as const,currentI:2.3};
    const x=.27,y=.41,z=1.1,R=p.radiusR;
    let bx=0,by=0;
    for(const x0 of [-.8*R,.8*R]){const dx=x-x0,r=Math.hypot(dx,y),c=MU_0*p.currentI/(4*Math.PI*r)*((4-z)/Math.hypot(r,4-z)+(4+z)/Math.hypot(r,4+z));bx-=c*y/r;by+=c*dx/r;}
    const B=evalBiotSavartB({x,y,z},p),rev=evalBiotSavartB({x,y,z},{...p,currentI:-p.currentI});
    expect(B.x).toBeCloseTo(bx,15);expect(B.y).toBeCloseTo(by,15);
    expect(rev.x).toBeCloseTo(-bx,15);expect(rev.y).toBeCloseTo(-by,15);
    expect(Math.hypot(...Object.values(evalBiotSavartB({x:0,y:0,z:0},p)))).toBeLessThan(1e-14);
  });
  it('checks real magnetic vector and analytic uniform trajectory, not merely speed',()=>{
    const p={...getPreset(3),uniformBz:-4,qOverM:-4},i=createInitialState(p),s=stepMagnetic3d(i,p,.8).nextState;
    expect(checkInvariants(s,i,p).every(r=>r.passed)).toBe(true);
    expect(checkInvariants({...s,position:{...s.position,x:s.position.x+.2}},i,p).some(r=>!r.passed)).toBe(true);
  });
  it('zero charge, zero B and parallel-only yield exact straight motion',()=>{
    for(const p of [{...getPreset(3),qOverM:0},{...getPreset(3),uniformBz:0},{...getPreset(3),vPerp:0}]){
      const i=createInitialState(p),s=stepMagnetic3d(i,p,.7).nextState;
      expect(s.position.x).toBeCloseTo(i.position.x+i.velocity.x*.7,10);
      expect(s.position.y).toBeCloseTo(i.position.y+i.velocity.y*.7,10);
      expect(s.position.z).toBeCloseTo(i.position.z+i.velocity.z*.7,10);
      expect(s.lorentzForce).toEqual({x:0,y:0,z:0});
    }
  });
});

it('explicitly rejects ideal filament measurements without leaking the finite compatibility sentinel',()=>{
  const p={...getPreset(2),geometryType:'straight-wire' as const,currentI:2},initial=createInitialState(p);
  expect(isMagneticFieldDefinedAt({x:0,y:0,z:0},p)).toBe(false);
  expect(isMagneticFieldDefinedAt({x:0,y:0,z:5},p)).toBe(true);
  expect(isMagneticFieldDefinedAt({x:0,y:0,z:0},{...p,currentI:0})).toBe(true);
  const invalid={...initial,position:{x:0,y:0,z:0}};
  const r=stepMagnetic3d(invalid,p,.01);
  expect(r.halt).toBe(true);expect(r.advancedTime).toBe(0);
  const o=computeObservables(r.nextState);
  expect(o.fieldDefined).toBe(0);expect(o.bMagT).toBeUndefined();expect(o.ax).toBeUndefined();
  expect(checkInvariants(r.nextState,initial,p).some(x=>!x.passed)).toBe(true);
});

it('exports actual conductors, field lines, signed vector projections and a separate wire transverse section',()=>{
  const p={...getPreset(2),geometryType:'parallel-wires' as const,currentI:-2},s=createInitialState(p),layers=new Set(['conductors','fieldLines3d','handednessTriad']);
  const marks=magneticProjectionScene(s,p,layers),ir=em3dMagneticFieldsPlugin.exportDiagramIR!(s,p);
  expect(ir.primitives.slice(0,-1)).toEqual(marks.map(m=>m.primitive));
  expect(marks.some(m=>m.primitive.kind==='text'&&m.primitive.text.includes('截面分离'))).toBe(true);
  expect(marks.filter(m=>m.tone==='field'&&m.primitive.kind==='polyline').length).toBeGreaterThan(15);
  expect(magneticProjectionBounds(s,p).maxX).toBeGreaterThan(4);
  expect(em3dMagneticFieldsPlugin.getParamFields!(getPreset(3)).some(f=>f.key==='currentI')).toBe(false);
  expect(em3dMagneticFieldsPlugin.getTelemetryChannels!(getPreset(3))[0]!.key).toBe('vx');
  expect(em3dMagneticFieldsPlugin.getTelemetryChannels!(p)[1]!.key).toBe('bMagMicroT');
});
