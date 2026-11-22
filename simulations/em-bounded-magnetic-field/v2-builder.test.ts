import { describe, expect, it } from 'vitest';
import { resolvePluginParams } from '@physforge/sim-sdk';
import { emBoundedMagneticFieldPlugin } from './plugin.js';
import {
  createInitialState,
  solveCriticalSpeedForRadius,
  stepBoundedMagnetic,
  type BoundedMagneticParams
} from './engine.js';

describe('B1 builder-composite-em-field V2 verification', () => {
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
