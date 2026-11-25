import { describe, expect, it } from 'vitest';
import { createWorldMapper, resolvePluginParams } from '@physforge/sim-sdk';
import { emBoundedMagneticFieldPlugin,b1FrameBounds,b1SafeRect,b1FitViewport,b1BoundsInViewport,b1VelocityDisplay,b1FieldSampleWindow } from './plugin.js';
import {
  createInitialState,
  solveCriticalSpeedForRadius,
  stepBoundedMagnetic,
  type BoundedMagneticParams
} from './engine.js';

describe('B1 builder-composite-em-field V2 verification', () => {
  it('keeps the illustrative magnetic lattice and electric arrow centers in physical world coordinates under pan and zoom',()=>{
    const plugin=emBoundedMagneticFieldPlugin;
    for(const mode of ['half-space','circular','rectangular','crossed-eb'] as const){
      const p=resolvePluginParams<BoundedMagneticParams>(plugin.paramSchema,{mode,family:'single',fieldScale:1.2,magneticFieldZ:2,electricFieldY:3});
      const state=createInitialState(p);
      const sample=b1FieldSampleWindow(state,p);
      expect(sample.points.length).toBeGreaterThan(0);
      const viewport={width:1440,height:900,dpr:1,scale:1,offsetX:0,offsetY:0};
      const base=createWorldMapper(viewport),pan=createWorldMapper({...viewport,offsetX:140,offsetY:-85}),zoom=createWorldMapper({...viewport,scale:2});
      for(const pt of [...sample.points,...sample.electricCenters]){
        const a=base.toScreen(pt.x,pt.y),b=pan.toScreen(pt.x,pt.y),c=zoom.toScreen(pt.x,pt.y);
        expect(b.x-a.x).toBeCloseTo(140,10);expect(b.y-a.y).toBeCloseTo(-85,10);
        expect(c.x-.45*viewport.width).toBeCloseTo(2*(a.x-.45*viewport.width),10);
        expect(c.y-.5*viewport.height).toBeCloseTo(2*(a.y-.5*viewport.height),10);
      }
      if(mode==='half-space')expect(sample.points.every(pt=>pt.x>0)).toBe(true);
      if(mode==='circular')expect(sample.points.every(pt=>Math.hypot(pt.x,pt.y)<p.fieldScale)).toBe(true);
      if(mode==='rectangular')expect(sample.points.every(pt=>pt.x>0&&pt.x<p.fieldScale&&Math.abs(pt.y)<.8*p.fieldScale)).toBe(true);
      if(mode==='crossed-eb'){
        const later=stepBoundedMagnetic(state,p,10).nextState;
        const next=b1FieldSampleWindow(later,p);
        const center=next.points.reduce((sum,pt)=>sum+pt.x,0)/next.points.length;
        expect(Math.abs(center-later.particles[0]!.state.position.x)).toBeLessThanOrEqual(.55/2+1e-9);
      }
    }
  });
  it('fits actual long crossed-field flight and all displayed vector endpoints in both safe workbench and fullscreen views',()=>{
    const p=resolvePluginParams<BoundedMagneticParams>(emBoundedMagneticFieldPlugin.paramSchema,{mode:'crossed-eb',family:'single',initialSpeed:0,magneticFieldZ:2,electricFieldY:3});
    const initial=createInitialState(p),state=stepBoundedMagnetic(initial,p,4).nextState;
    const layers=new Set(['trajectory','fieldRegion','velocityVector','speedDecomposition']);
    const bounds=b1FrameBounds(state,p,layers);
    for(const [width,height] of [[1440,900],[1024,768]] as const)for(const presentation of [false,true]){
      const safe=b1SafeRect(width,height,presentation);
      const fitted=b1FitViewport(bounds,{width,height,dpr:1,scale:1,offsetX:0,offsetY:0},safe);
      expect(b1BoundsInViewport(bounds,fitted,safe)).toBe(true);
      const m=createWorldMapper(fitted),tr=state.particles[0]!,v=b1VelocityDisplay(tr,p,layers);
      const points=[...tr.trail,tr.state.position,{x:tr.state.position.x+v.vx*v.scale,y:tr.state.position.y+v.vy*v.scale},{x:tr.state.position.x+v.vd*v.scale,y:tr.state.position.y}];
      for(const pt of points){
        const screen=m.toScreen(pt.x,pt.y);
        expect(screen.x).toBeGreaterThan(safe.left);expect(screen.x).toBeLessThan(safe.right);
        expect(screen.y).toBeGreaterThan(safe.top);expect(screen.y).toBeLessThan(safe.bottom);
      }
    }
    expect(emBoundedMagneticFieldPlugin.getControlHandles?.(initial,p).some(h=>h.id==='launch-velocity')).toBe(true);
    expect(emBoundedMagneticFieldPlugin.getControlHandles?.(state,p).some(h=>h.id==='launch-velocity')).toBe(false);
  });
  it('preserves kinetic energy < 1e-10 and radius < 1e-6 over 50 cyclotron periods', () => {
    const params = resolvePluginParams<BoundedMagneticParams>(
      emBoundedMagneticFieldPlugin.paramSchema,
      {
        mode: 'half-space',
        family: 'single',
        mass: 1,
        charge: 1,
        magneticFieldZ: 2,
        initialSpeed: 2.0,
        fieldScale: 1.5,
        beamCount: 1
      }
    );
    let state = createInitialState(params);
    // Start strictly inside half-space x >= 0
    state = {
      ...state,
      particles: state.particles.map((t) => ({
        ...t,
        inField: true,
        state: { ...t.state, position: { x: 2.0, y: 0, z: 0 } }
      }))
    };

    const ke0 = 0.5 * params.mass * params.initialSpeed * params.initialSpeed;
    const T = (2 * Math.PI * params.mass) / Math.abs(params.charge * params.magneticFieldZ);
    const dt = T / 240;

    for (let i = 0; i < 50 * 240; i++) {
      state = stepBoundedMagnetic(state, params, dt).nextState;
    }

    const obs = emBoundedMagneticFieldPlugin.engine.computeObservables(state, params);
    const relEnergyDrift = Math.abs(obs.kineticEnergy! - ke0) / ke0;
    const expectedRadius = (params.mass * params.initialSpeed) / Math.abs(params.charge * params.magneticFieldZ);
    const relRadiusErr = Math.abs(obs.larmorRadius! - expectedRadius) / expectedRadius;

    expect(relEnergyDrift).toBeLessThan(1e-10);
    expect(relRadiusErr).toBeLessThan(1e-6);
  });

  it('converges 9 parallel particles to (0, -R) in circular magnetic focusing with spread < 1e-5 R', () => {
    const R = 1.2;
    const params = resolvePluginParams<BoundedMagneticParams>(
      emBoundedMagneticFieldPlugin.paramSchema,
      {
        mode: 'circular',
        family: 'focusing',
        mass: 1,
        charge: 1,
        magneticFieldZ: 2,
        initialSpeed: 2.4, // R_c = 1 * 2.4 / (1 * 2) = 1.2 = R
        fieldScale: R,
        launchAngleDeg: 0,
        beamCount: 9
      }
    );
    let state = createInitialState(params);
    expect(state.particles).toHaveLength(9);

    const dt = 0.002;
    for (let step = 0; step < 900; step++) {
      state = stepBoundedMagnetic(state, params, dt).nextState;
    }

    const exitPoints = state.particles.map((p) => p.exitPoint).filter((pt) => pt !== undefined);
    expect(exitPoints).toHaveLength(9);
    for (const pt of exitPoints) {
      const distToFocus = Math.hypot(pt!.x - 0, pt!.y + R);
      expect(distToFocus / R).toBeLessThan(1e-5);
    }
  });

  it('exports physical B sign, actual current velocity and all nine focusing beams',()=>{
    const plugin=emBoundedMagneticFieldPlugin;
    const p=resolvePluginParams<BoundedMagneticParams>(plugin.paramSchema,{mode:'circular',family:'focusing',beamCount:9});
    const initial=createInitialState(p),s=stepBoundedMagnetic(initial,p,1.4).nextState;
    const positive=plugin.exportDiagramIR!(s,p);
    const marks=positive.primitives.filter(v=>v.kind==='fieldMarker');
    expect(marks.length).toBeGreaterThan(0);expect(marks.every(v=>v.symbol==='dot')).toBe(true);
    expect(positive.primitives.filter(v=>v.kind==='trajectory')).toHaveLength(9);
    expect(positive.primitives.some(v=>v.kind==='arrow'&&v.label==='v')).toBe(true);
    const negative=plugin.exportDiagramIR!(s,{...p,magneticFieldZ:-2});
    expect(negative.primitives.filter(v=>v.kind==='fieldMarker').every(v=>v.symbol==='cross')).toBe(true);
    const zero=plugin.exportDiagramIR!(s,{...p,magneticFieldZ:0});
    expect(zero.primitives.filter(v=>v.kind==='fieldMarker')).toHaveLength(0);
    const crossed={...p,mode:'crossed-eb' as const,electricFieldY:-3};
    const ir=plugin.exportDiagramIR!(createInitialState(crossed),crossed);
    expect(ir.primitives.some(v=>v.kind==='rect')).toBe(false);
    const e=ir.primitives.find(v=>v.kind==='arrow'&&v.label==='E');
    expect(e?.kind==='arrow'&&e.y2<e.y1).toBe(true);
    expect(plugin.getForceVectors?.(createInitialState(crossed),crossed).some(v=>v.id==='electric'&&v.category==='electric')).toBe(true);
  });

  it('achieves exact cycloid peak speed 2E/B and solves inverse critical speed via Brent', () => {
    const params = resolvePluginParams<BoundedMagneticParams>(
      emBoundedMagneticFieldPlugin.paramSchema,
      {
        mode: 'crossed-eb',
        family: 'single',
        mass: 1,
        charge: 1,
        magneticFieldZ: 2,
        electricFieldY: 3,
        initialSpeed: 0,
        beamCount: 1
      }
    );

    let state = createInitialState(params);
    let maxSpeed = 0;
    const dt = 0.002;
    for (let i = 0; i < 1600; i++) {
      state = stepBoundedMagnetic(state, params, dt).nextState;
      const obs = emBoundedMagneticFieldPlugin.engine.computeObservables(state, params);
      if (obs.speed! > maxSpeed) maxSpeed = obs.speed!;
    }
    const analyticalMax = (2 * Math.abs(params.electricFieldY)) / Math.abs(params.magneticFieldZ);
    expect(Math.abs(maxSpeed - analyticalMax) / analyticalMax).toBeLessThan(1e-5);

    const solvedV = solveCriticalSpeedForRadius(params, 1.8);
    expect(solvedV).not.toBeNull();
    expect(solvedV!).toBeCloseTo(3.6, 8);

    const ir = emBoundedMagneticFieldPlugin.exportDiagramIR?.(state, params);
    expect(ir?.primitives.length).toBeGreaterThan(2);
  });
});
