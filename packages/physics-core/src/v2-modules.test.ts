import { describe, expect, it } from 'vitest';
import {
  ATOMIC_BOHR_SCALE,
  PLANETARY_ORBIT_SCALE,
  SI_IDENTITY_SCALE,
  SpatialHash2D,
  WaveFDTD2D,
  applyZeroVelocityHysteresis,
  auditEnergyBudget,
  auditMomentumBudget,
  createScaleContext,
  createSeededPrng,
  extractIsolines,
  findRootBrent,
  solveBoundaryParameter,
  solveNonlinearMna,
  solveUdwadiaKalaba,
  stepHybridAutomaton,
  wavelengthToRgb,
  type DiskParticle2D
} from './index.js';

describe('physics-core V2 modules', () => {
  it('ScaleContext preserves roundtrip accuracy for Bohr & Planetary scales', () => {
    const eMass = 9.1093837015e-31;
    const eCharge = 1.602176634e-19;
    expect(ATOMIC_BOHR_SCALE.toDimless(ATOMIC_BOHR_SCALE.lengthUnit, 'length')).toBeCloseTo(1, 12);
    expect(ATOMIC_BOHR_SCALE.toSI(ATOMIC_BOHR_SCALE.toDimless(eMass, 'mass'), 'mass')).toBeCloseTo(
      eMass,
      40
    );
    expect(
      ATOMIC_BOHR_SCALE.toSI(ATOMIC_BOHR_SCALE.toDimless(eCharge, 'charge'), 'charge')
    ).toBeCloseTo(eCharge, 30);

    const earthSpeed = 29780;
    const vDimless = PLANETARY_ORBIT_SCALE.toDimless(earthSpeed, 'velocity');
    expect(PLANETARY_ORBIT_SCALE.toSI(vDimless, 'velocity')).toBeCloseTo(earthSpeed, 8);

    expect(SI_IDENTITY_SCALE.energyUnit).toBe(1);
    expect(() =>
      createScaleContext({ lengthUnit: -1, timeUnit: 1, massUnit: 1, chargeUnit: 1 })
    ).toThrow();
  });

  it('HybridAutomaton locks static friction with hysteresis and guards against Zeno thrashing', () => {
    const locked = applyZeroVelocityHysteresis(5e-5, 1.2, 2.0, 1e-4);
    expect(locked.locked).toBe(true);
    expect(locked.velocity).toBe(0);

    const broken = applyZeroVelocityHysteresis(5e-5, 2.5, 2.0, 1e-4);
    expect(broken.locked).toBe(false);

    // Exact transition timing via bisectEvent: particle moves x(t) = v * t crosses wall at x = 1.0
    type Mode = 'moving' | 'stopped';
    interface State {
      t: number;
      x: number;
      v: number;
      mode: Mode;
    }

    const out = stepHybridAutomaton<Mode, State>(
      {
        advanceContinuous: (s, dt) => ({
          ...s,
          t: s.t + dt,
          x: s.mode === 'moving' ? s.x + s.v * dt : s.x
        }),
        guards: [
          {
            id: 'hit-wall',
            label: 'Hit wall',
            fromModes: ['moving'],
            eventFn: (s) => s.x - 1.0,
            reset: (boundary, time) => ({
              nextState: { ...boundary, t: time, x: 1.0, v: 0, mode: 'stopped' }
            })
          }
        ]
      },
      { t: 0, x: 0.75, v: 2.0, mode: 'moving' },
      0.5
    );

    expect(out.events).toHaveLength(1);
    expect(out.events[0]!.time).toBeCloseTo(0.125, 8);
    expect(out.nextState.mode).toBe('stopped');
    expect(out.nextState.t).toBeCloseTo(0.5, 9);

    // Zeno guard clamps excessive bouncing in a single step
    let bounces = 0;
    const zeno = stepHybridAutomaton<Mode, State>(
      {
        maxTransitionsPerStep: 5,
        advanceContinuous: (s, dt) => ({ ...s, t: s.t + dt, x: s.x + 100 * dt }),
        guards: [
          {
            id: 'thrash',
            label: 'Thrash',
            fromModes: ['moving'],
            eventFn: (s) => s.x - 0.01,
            reset: (b, t) => {
              bounces += 1;
              return { nextState: { ...b, t, x: 0 } };
            }
          }
        ]
      },
      { t: 0, x: 0, v: 100, mode: 'moving' },
      0.1
    );
    expect(zeno.zenoClamped).toBe(true);
    expect(bounces).toBe(5);
  });

  it('UdwadiaKalaba matches analytical circular-track bottom tension Fn = 6mg with < 1e-10 residual', () => {
    // Bead on vertical circle x^2 + y^2 = R^2 at bottom (0, -R) with speed v = sqrt(5gR):
    // Constraint: phi = 0.5*(x^2 + y^2 - R^2) = 0 -> A = [x, y], b = -(vx^2 + vy^2)
    const m = 2.0;
    const g = 9.8;
    const R = 1.5;
    const vBottom = Math.sqrt(5 * g * R);
    const out = solveUdwadiaKalaba({
      massDiagonal: [m, m],
      unconstrainedAccel: [0, -g],
      constraintMatrixA: [[0, -R]],
      constraintVectorB: [-(vBottom * vBottom)]
    });

    // At bottom, radial inward (+y) centripetal accel is v^2/R = 5g, so total ay = +5g, Fc_y = m*(5g - (-g)) = 6mg
    expect(out.constraintResidual).toBeLessThan(1e-12);
    expect(out.acceleration[0]).toBeCloseTo(0, 12);
    expect(out.acceleration[1]).toBeCloseTo(5 * g, 10);
    expect(out.constraintForce[1]).toBeCloseTo(6 * m * g, 10);
  });

  it('RootFinder solves two-angle projectile shooting problem to < 1e-9 accuracy', () => {
    // Hit target (x = 40 m, y = 0) with v0 = 25 m/s, g = 9.8 m/s^2:
    // Range R(theta) = v0^2 * sin(2*theta) / g = 40 => sin(2*theta) = 40*9.8/625 = 0.6272
    const v0 = 25;
    const g = 9.8;
    const targetX = 40;
    const residualFn = (theta: number) => ((v0 * v0) / g) * Math.sin(2 * theta) - targetX;

    const roots = solveBoundaryParameter(residualFn, [0.05, Math.PI / 2 - 0.05], {
      gridSamples: 64,
      tolerance: 1e-11
    });

    expect(roots.length).toBe(2);
    const expectedLow = 0.5 * Math.asin((targetX * g) / (v0 * v0));
    const expectedHigh = Math.PI / 2 - expectedLow;
    expect(roots[0]!.root).toBeCloseTo(expectedLow, 8);
    expect(roots[1]!.root).toBeCloseTo(expectedHigh, 8);
    expect(Math.abs(roots[0]!.residual)).toBeLessThan(1e-9);

    const single = findRootBrent((x) => x * x - 2, 1, 2);
    expect(single.root).toBeCloseTo(Math.SQRT2, 10);
  });

  it('WaveFDTD2D remains stable for 2000 steps, enforces CFL guard, and MarchingSquares extracts circular contour', () => {
    expect(
      () => new WaveFDTD2D({ nx: 32, ny: 32, dx: 0.1, dt: 0.1, maxWaveSpeed: 1.0 })
    ).toThrow(/CFL/);

    const fdtd = new WaveFDTD2D({ nx: 64, ny: 64, dx: 0.1, dt: 0.05, maxWaveSpeed: 1.0 });
    for (let step = 0; step < 2000; step++) {
      if (step < 80) {
        fdtd.injectSource(32, 32, Math.sin(0.25 * step));
      }
      fdtd.step();
    }
    const maxAmp = fdtd.sampleMaxAmplitude();
    expect(Number.isFinite(maxAmp)).toBe(true);
    expect(maxAmp).toBeLessThan(5);

    // Marching Squares on scalar field f(x,y) = x^2 + y^2, level = 4 -> circle radius 2
    const nx = 41;
    const ny = 41;
    const grid = new Float64Array(nx * ny);
    for (let j = 0; j < ny; j++) {
      const y = -4 + (8 * j) / (ny - 1);
      for (let i = 0; i < nx; i++) {
        const x = -4 + (8 * i) / (nx - 1);
        grid[j * nx + i] = x * x + y * y;
      }
    }
    const [contour] = extractIsolines(
      grid,
      nx,
      ny,
      { xMin: -4, xMax: 4, yMin: -4, yMax: 4 },
      [4]
    );
    expect(contour!.segments.length).toBeGreaterThan(20);
    for (const seg of contour!.segments) {
      const ra = Math.hypot(seg.a.x, seg.a.y);
      expect(ra).toBeCloseTo(2, 1);
    }
  });

  it('SpatialHash2D preserves 200-particle elastic kinetic energy and linear momentum', () => {
    const prng = createSeededPrng(42);
    const particles: DiskParticle2D[] = [];
    for (let i = 0; i < 200; i++) {
      const row = Math.floor(i / 20);
      const col = i % 20;
      particles.push({
        x: col * 0.48 + prng.range(-0.02, 0.02),
        y: row * 0.48 + prng.range(-0.02, 0.02),
        vx: prng.gaussian(0, 2.0),
        vy: prng.gaussian(0, 2.0),
        radius: 0.2,
        mass: prng.range(0.5, 2.0)
      });
    }

    const totalEnergy = () =>
      particles.reduce((acc, p) => acc + 0.5 * p.mass * (p.vx * p.vx + p.vy * p.vy), 0);
    const totalMomentum = () =>
      particles.reduce(
        (acc, p) => ({ x: acc.x + p.mass * p.vx, y: acc.y + p.mass * p.vy }),
        { x: 0, y: 0 }
      );

    const e0 = totalEnergy();
    const p0 = totalMomentum();

    const hash = new SpatialHash2D(0.5);
    const dt = 0.01;
    let collisions = 0;
    for (let step = 0; step < 40; step++) {
      for (const p of particles) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
      collisions += hash.resolveDiskCollisions(particles, 1.0);
    }

    expect(collisions).toBeGreaterThan(0);
    const p1 = totalMomentum();
    const report = auditEnergyBudget({ kinetic: totalEnergy() }, e0, 1e-9);
    expect(report.status).toBe('pass');
    expect(report.relativeResidual).toBeLessThan(1e-9);

    const momReport = auditMomentumBudget(
      { linear: { x: p1.x, y: p1.y, z: 0 } },
      { linear: { x: p0.x, y: p0.y, z: 0 } },
      1e-9
    );
    expect(momReport.status).toBe('pass');

    // Seeded PRNG determinism & wavelength RGB sanity
    const pA = createSeededPrng(99);
    const pB = createSeededPrng(99);
    expect(pA.next()).toBe(pB.next());
    expect(wavelengthToRgb(532).g).toBe(255);
    expect(wavelengthToRgb(650).r).toBe(255);
  });

  it('NonlinearMna solves floating islands, diode circuit, and 20-period lossless LC oscillation', () => {
    // 1) Floating circuit anchored automatically via 1e12 ohm bleed resistor
    const floating = solveNonlinearMna(3, [
      { kind: 'voltageSource', id: 'V1', pos: 1, neg: 0, voltage: 10 },
      { kind: 'resistor', id: 'R1', a: 1, b: 0, resistance: 10 },
      // Isolated resistor between node 2 and 3 (unconnected to ground 0)
      { kind: 'resistor', id: 'R_iso', a: 2, b: 3, resistance: 5 }
    ]);
    expect(floating.nodeVoltages[1]).toBeCloseTo(10, 8);
    expect(floating.injectedBleedNodes.length).toBeGreaterThanOrEqual(1);

    // 2) Nonlinear Shockley diode + series 100 ohm resistor with 5V source
    const diodeOut = solveNonlinearMna(2, [
      { kind: 'voltageSource', id: 'V1', pos: 1, neg: 0, voltage: 5 },
      { kind: 'resistor', id: 'R1', a: 1, b: 2, resistance: 100 },
      {
        kind: 'diode',
        id: 'D1',
        anode: 2,
        cathode: 0,
        saturationCurrent: 1e-12,
        thermalVoltage: 0.026
      }
    ]);
    const vd = diodeOut.nodeVoltages[2]!;
    const iR = diodeOut.elementCurrents['R1']!;
    const iD = diodeOut.elementCurrents['D1']!;
    expect(vd).toBeGreaterThan(0.55);
    expect(vd).toBeLessThan(0.8);
    expect(Math.abs(iR - iD)).toBeLessThan(1e-8);

    // 3) Nonlinear lamp circuit KCL consistency
    const lampOut = solveNonlinearMna(2, [
      { kind: 'voltageSource', id: 'V1', pos: 1, neg: 0, voltage: 6 },
      { kind: 'resistor', id: 'R1', a: 1, b: 2, resistance: 4 },
      { kind: 'lamp', id: 'L1', a: 2, b: 0, k: 0.25, alpha: 0.65 }
    ]);
    expect(Math.abs(lampOut.elementCurrents['R1']! - lampOut.elementCurrents['L1']!)).toBeLessThan(
      1e-9
    );

    // 4) Lossless LC tank oscillation via trapezoidal companion: 20 periods energy conservation < 1e-6
    const C = 1e-3;
    const L = 1e-3;
    const T = 2 * Math.PI * Math.sqrt(L * C);
    const dt = T / 200;
    let vCap = 5.0;
    let iCap = 0;
    let vInd = 5.0;
    let iInd = 0;
    const E0 = 0.5 * C * vCap * vCap;

    for (let step = 0; step < 20 * 200; step++) {
      // Node 1 top of parallel LC, ground 0 bottom: C current from 1->0 is iCap, L current from 1->0 is iInd
      const res = solveNonlinearMna(
        1,
        [
          {
            kind: 'capacitor',
            id: 'C1',
            a: 1,
            b: 0,
            capacitance: C,
            prevVoltage: vCap,
            prevCurrent: iCap
          },
          {
            kind: 'inductor',
            id: 'L1',
            a: 1,
            b: 0,
            inductance: L,
            prevVoltage: vInd,
            prevCurrent: iInd
          }
        ],
        dt
      );
      vCap = res.elementVoltages['C1']!;
      iCap = res.elementCurrents['C1']!;
      vInd = res.elementVoltages['L1']!;
      iInd = res.elementCurrents['L1']!;
    }
    const EFinal = 0.5 * C * vCap * vCap + 0.5 * L * iInd * iInd;
    expect(Math.abs(EFinal - E0) / E0).toBeLessThan(1e-6);
  });
});
