import { describe, expect, it } from 'vitest';
import {
  ELECTRON_MASS,
  ELEMENTARY_CHARGE,
  ampereForceStraightWire,
  assertAllFinite,
  bisectEvent,
  cmToM,
  cross3,
  degToRad,
  dot2,
  dot3,
  eVToJ,
  electricFieldPointCharge3D,
  harmonicOscillatorEnergy,
  integrateAdaptiveRK45,
  jToEV,
  kineticEnergy3D,
  len3,
  lorentzAcceleration3D,
  lorentzForce3D,
  mTToT,
  mToCm,
  norm2,
  norm3,
  radToDeg,
  relativeError,
  rotate2,
  signedDistanceCircle2D,
  signedDistanceHalfSpace2D,
  signedDistanceRect2D,
  signedHeightAboveIncline2D,
  stepBorisPusher,
  stepRK4,
  stepVelocityVerlet,
  tToMT,
  trackInvariantDrift,
  vec2,
  vec3,
  ZERO_VEC3,
  type ChargedParticleState,
  type VerletState
} from './index.js';

describe('units and vectors', () => {
  it('converts SI and classroom units accurately', () => {
    expect(mToCm(cmToM(25))).toBeCloseTo(25, 12);
    expect(tToMT(mTToT(450))).toBeCloseTo(450, 12);
    expect(jToEV(eVToJ(13.6))).toBeCloseTo(13.6, 12);
    expect(radToDeg(degToRad(60))).toBeCloseTo(60, 12);
  });

  it('computes 2D/3D vector operations and Lorentz/Ampere operators accurately', () => {
    const a2 = vec2(3, 4);
    const rot = rotate2(a2, Math.PI / 2);
    expect(rot.x).toBeCloseTo(-4, 12);
    expect(rot.y).toBeCloseTo(3, 12);
    expect(dot2(a2, rot)).toBeCloseTo(0, 12);
    expect(norm2(vec2(0, 0))).toEqual({ x: 0, y: 0 });
    expect(norm3(ZERO_VEC3)).toEqual(ZERO_VEC3);

    const v = vec3(2, 0, 0);
    const B = vec3(0, 0, 0.5);
    const E = vec3(0, 3, 0);
    const q = 2;
    // v x B = (0, -1, 0), so F = 2 * ((0,3,0) + (0,-1,0)) = (0, 4, 0)
    const F = lorentzForce3D(q, E, v, B);
    expect(F.x).toBeCloseTo(0, 12);
    expect(F.y).toBeCloseTo(4, 12);
    expect(F.z).toBeCloseTo(0, 12);

    const acc = lorentzAcceleration3D(q, 4, E, v, B);
    expect(acc.y).toBeCloseTo(1, 12);

    const Fwire = ampereForceStraightWire(5, vec3(0, 0.4, 0), vec3(0, 0, 0.2));
    expect(Fwire.x).toBeCloseTo(0.4, 12);
    expect(dot3(Fwire, vec3(0, 0, 0.2))).toBeCloseTo(0, 12);
    expect(cross3(vec3(1, 0, 0), vec3(0, 1, 0))).toEqual({ x: 0, y: 0, z: 1 });
    expect(electricFieldPointCharge3D(1e-9, ZERO_VEC3, ZERO_VEC3)).toEqual(ZERO_VEC3);
  });
});

describe('VelocityVerlet harmonic oscillator (100 periods conservation)', () => {
  it('conserves mechanical energy within < 1e-4 over 100 full periods while Euler diverges', () => {
    const k = 16; // N/m
    const m = 1; // kg
    const omega = Math.sqrt(k / m); // 4 rad/s
    const period = (2 * Math.PI) / omega;
    const stepsPerPeriod = 400;
    const dt = period / stepsPerPeriod;
    const totalSteps = 100 * stepsPerPeriod;

    const x0 = 1.2;
    const v0 = 0;
    const initialEnergy = harmonicOscillatorEnergy(m, k, x0, v0);

    let verlet: VerletState = { positions: [x0], velocities: [v0], t: 0 };
    const energies: number[] = [initialEnergy];

    let eulerX = x0;
    let eulerV = v0;

    for (let i = 0; i < totalSteps; i++) {
      verlet = stepVelocityVerlet(verlet, dt, (pos) => [-(k / m) * pos[0]!]);
      energies.push(harmonicOscillatorEnergy(m, k, verlet.positions[0]!, verlet.velocities[0]!));

      const eulerA = -(k / m) * eulerX;
      eulerX += eulerV * dt;
      eulerV += eulerA * dt;
    }

    const drift = trackInvariantDrift(energies, initialEnergy);
    expect(drift.maxRelativeDrift).toBeLessThan(1e-4);

    // 对比显式欧拉：100 个周期后机械能必然明显发散，证实辛积分器必要性
    const eulerEnergy = harmonicOscillatorEnergy(m, k, eulerX, eulerV);
    expect(relativeError(eulerEnergy, initialEnergy)).toBeGreaterThan(0.1);
  });
});

describe('BorisPusher pure magnetic field (10 periods conservation and radius)', () => {
  it('conserves kinetic energy (< 1e-6) and matches analytical Larmor radius (< 1e-5)', () => {
    const q = 2;
    const m = 1.5;
    const B0 = 3;
    const v0Mag = 6;
    const analyticalR = (m * v0Mag) / (Math.abs(q) * B0); // 1.5 m
    const cyclotronOmega = (Math.abs(q) * B0) / m;
    const period = (2 * Math.PI) / cyclotronOmega;

    const stepsPerPeriod = 200;
    const dt = period / stepsPerPeriod;
    const totalSteps = 10 * stepsPerPeriod;

    // 初始位置在 (0, -R, 0)，初速度 (+v0, 0, 0)，B = (0, 0, -B0) -> q(v x B) 指向 +y (向心)
    // 理论圆心在 (0, 0, 0)
    let particle: ChargedParticleState = {
      position: vec3(0, -analyticalR, 0),
      velocity: vec3(v0Mag, 0, 0),
      t: 0
    };
    const fields = () => ({ E: ZERO_VEC3, B: vec3(0, 0, -B0) });

    const initialKe = kineticEnergy3D(m, particle.velocity);
    const keSeries: number[] = [initialKe];
    let maxRadiusRelErr = 0;

    for (let i = 0; i < totalSteps; i++) {
      particle = stepBorisPusher(particle, fields, q, m, dt);
      keSeries.push(kineticEnergy3D(m, particle.velocity));
      const radius = len3(particle.position);
      const rErr = relativeError(radius, analyticalR);
      if (rErr > maxRadiusRelErr) maxRadiusRelErr = rErr;
    }

    const keDrift = trackInvariantDrift(keSeries, initialKe);
    expect(keDrift.maxRelativeDrift).toBeLessThan(1e-6);
    expect(maxRadiusRelErr).toBeLessThan(1e-5);
  });
});

describe('RK4 and AdaptiveRK45 analytical benchmarks', () => {
  it('matches underdamped harmonic oscillator analytical solution within < 1e-4', () => {
    const omega0 = 5;
    const gamma = 0.4; // 欠阻尼因子 < omega0
    const omegaD = Math.sqrt(omega0 * omega0 - gamma * gamma);
    const x0 = 1.0;
    const v0 = 0.5;

    const deriv = (_t: number, y: readonly number[]): number[] => {
      const x = y[0]!;
      const v = y[1]!;
      return [v, -2 * gamma * v - omega0 * omega0 * x];
    };

    const tEnd = 4.0;
    const dt = 0.002;
    const steps = Math.round(tEnd / dt);
    let y = [x0, v0];
    let t = 0;
    for (let i = 0; i < steps; i++) {
      y = stepRK4(y, t, dt, deriv);
      t += dt;
    }

    const c1 = x0;
    const c2 = (v0 + gamma * x0) / omegaD;
    const analyticalX = Math.exp(-gamma * t) * (c1 * Math.cos(omegaD * t) + c2 * Math.sin(omegaD * t));

    expect(Math.abs(y[0]! - analyticalX)).toBeLessThan(1e-4);

    // 同步核对自适应 RK45
    const rk45 = integrateAdaptiveRK45([x0, v0], 0, tEnd, deriv, {
      absTol: 1e-10,
      relTol: 1e-8
    });
    expect(Math.abs(rk45.state[0]! - analyticalX)).toBeLessThan(1e-7);
  });

  it('matches crossed E×B cycloid analytical drift with RK4 and BorisPusher (< 1e-4)', () => {
    // q = 1, m = 1, E = (0, E0, 0), B = (0, 0, B0), v(0) = (0, 0, 0), r(0) = (0, 0, 0)
    // 解析解 (配速法): 漂移速度 vx_drift = E0 / B0 (沿 +x，因为 E×B 沿 +x)
    // 等等核对叉乘方向：E=(0, E0, 0), B=(0, 0, B0), v_drift = (E0/B0, 0, 0)
    // v_drift x B = (E0/B0, 0, 0) x (0, 0, B0) = (0, -E0, 0) -> q(E + v_drift x B) = 0！正确！
    // 摆线解析解：omega = qB0/m, x(t) = (E0/B0) * (t - sin(omega*t)/omega), y(t) = (E0/(B0*omega)) * (1 - cos(omega*t))
    const q = 1;
    const m = 1;
    const E0 = 2;
    const B0 = 2;
    const omega = (q * B0) / m;
    const tEnd = 3.5;
    const dt = 0.001;
    const steps = Math.round(tEnd / dt);

    const deriv = (_t: number, s: readonly number[]): number[] => {
      const vx = s[2]!;
      const vy = s[3]!;
      return [vx, vy, (q / m) * (vy * B0), (q / m) * (E0 - vx * B0)];
    };

    let rkState = [0, 0, 0, 0];
    let boris: ChargedParticleState = { position: ZERO_VEC3, velocity: ZERO_VEC3, t: 0 };
    const fields = () => ({ E: vec3(0, E0, 0), B: vec3(0, 0, B0) });

    for (let i = 0; i < steps; i++) {
      rkState = stepRK4(rkState, i * dt, dt, deriv);
      boris = stepBorisPusher(boris, fields, q, m, dt);
    }

    const exactX = (E0 / B0) * (tEnd - Math.sin(omega * tEnd) / omega);
    const exactY = (E0 / (B0 * omega)) * (1 - Math.cos(omega * tEnd));

    expect(relativeError(rkState[0]!, exactX)).toBeLessThan(1e-4);
    expect(relativeError(rkState[1]!, exactY)).toBeLessThan(1e-4);
    expect(relativeError(boris.position.x, exactX)).toBeLessThan(1e-4);
    expect(relativeError(boris.position.y, exactY)).toBeLessThan(1e-4);
  });
});

describe('bisectEvent precision event detection (< 1e-6 s)', () => {
  it('captures inclined-plane projectile landing time within < 1e-6 s', () => {
    // 斜面从原点 (0,0) 出发，倾角 theta = 30°（向右上方倾斜）
    // 抛体从 (0, 2) 以初速度 (6, 4) 抛射，重力加速度 g = 9.8 m/s²
    // 解析着陆条件：y(t) - x(t)*tan(theta) = 0
    // 即 2 + 4t - 0.5*g*t^2 - (6t)*tan(30°) = 0
    const g = 9.8;
    const theta = degToRad(30);
    const y0 = 2.0;
    const vx0 = 6.0;
    const vy0 = 4.0;

    // 求解二次方程 -0.5*g*t^2 + (vy0 - vx0*tan(theta))*t + y0 = 0 的正根
    const a = -0.5 * g;
    const b = vy0 - vx0 * Math.tan(theta);
    const c = y0;
    const exactLandingT = (-b - Math.sqrt(b * b - 4 * a * c)) / (2 * a);

    const advance = (s: VerletState, subDt: number): VerletState =>
      stepVelocityVerlet(s, subDt, () => [0, -g]);

    const eventFn = (s: VerletState): number =>
      signedHeightAboveIncline2D(vec2(s.positions[0]!, s.positions[1]!), vec2(0, 0), theta);

    let state: VerletState = { positions: [0, y0], velocities: [vx0, vy0], t: 0 };
    const dt = 0.02; // 故意用较粗的 20ms 步长，检验 bisectEvent 而非靠极小步长作弊
    let capturedTime: number | null = null;
    let capturedState: VerletState | null = null;

    for (let i = 0; i < 200; i++) {
      const event = bisectEvent(state, state.t, dt, advance, eventFn, {
        timeTolerance: 1e-9
      });
      if (event) {
        capturedTime = event.time;
        capturedState = event.state;
        expect(event.bracketWidth).toBeLessThanOrEqual(1e-7);
        break;
      }
      state = advance(state, dt);
    }

    expect(capturedTime).not.toBeNull();
    expect(Math.abs(capturedTime! - exactLandingT)).toBeLessThan(1e-6);
    expect(Math.abs(eventFn(capturedState!))).toBeLessThan(1e-6);
  });

  it('captures circular magnetic field exit time within < 1e-6 s', () => {
    // 圆形磁场圆心在 (0, R_field) 还是 (0, 0)?
    // 构造经典磁聚焦/边界穿出特例：圆形磁场圆心在 (0, 0)，半径 R_f = 1.0 m
    // 带电粒子从边界内侧起点 (0, -0.5) 以初速度 (v, 0, 0) 向右射出，假设 B = (0, 0, -B0) 使向心加速度朝 +y
    // 粒子做圆心在 (0, -0.5 + R_c) 的圆周运动，当 R_c = 1.0 时圆心在 (0, 0.5)
    // 轨迹方程：x^2 + (y - 0.5)^2 = 1；磁场边界：x^2 + y^2 = 1
    // 联立得交点 y = 0.25, x = sqrt(1 - 0.0625) = sqrt(15)/4
    // 轨迹角 phi：cos(phi) = (0.5 - 0.25)/1 = 0.25 -> phi = acos(0.25) (从最底端 (0,-0.5) 逆时针转角)
    // 精确穿出时刻 t* = phi / omega_c
    const q = 1;
    const m = 1;
    const B0 = 2;
    const v0 = 2; // R_c = mv/(qB) = 1.0 m, omega_c = qB/m = 2 rad/s
    const omegaC = (q * B0) / m;
    const exactExitT = Math.acos(0.25) / omegaC;

    const fieldCenter = vec2(0, 0);
    const fieldRadius = 1.0;
    const fields = () => ({ E: ZERO_VEC3, B: vec3(0, 0, -B0) });

    // 使用 1ms 步长保证 Boris 二阶相位误差远小于 1e-6 s，再由 bisectEvent 精确收敛穿出时刻
    let particle: ChargedParticleState = {
      position: vec3(0, -0.5, 0),
      velocity: vec3(v0, 0, 0),
      t: 0
    };
    const dt = 0.001;
    const advance = (s: ChargedParticleState, subDt: number): ChargedParticleState =>
      stepBorisPusher(s, fields, q, m, subDt);
    const eventFn = (s: ChargedParticleState): number =>
      signedDistanceCircle2D(vec2(s.position.x, s.position.y), fieldCenter, fieldRadius);

    let exitTime: number | null = null;
    for (let i = 0; i < 2000; i++) {
      const event = bisectEvent(particle, particle.t, dt, advance, eventFn, {
        timeTolerance: 1e-9
      });
      if (event) {
        exitTime = event.time;
        expect(event.bracketWidth).toBeLessThanOrEqual(1e-7);
        break;
      }
      particle = advance(particle, dt);
    }

    expect(exitTime).not.toBeNull();
    expect(Math.abs(exitTime! - exactExitT)).toBeLessThan(1e-6);
  });

  it('outperforms endpoint linear interpolation on curved trajectories under large dt', () => {
    // 大步长 dt = 0.2 s 下，抛体竖直上抛 y(t) = 2.5*t - 0.5*9.8*t^2 在 t=0.4s 至 0.6s 间穿过 y = 0.2 m
    // 精确过零时刻：-4.9*t^2 + 2.5*t - 0.2 = 0 -> t = (2.5 + sqrt(6.25 - 3.92)) / 9.8
    const g = 9.8;
    const exactT = (2.5 + Math.sqrt(2.5 * 2.5 - 4 * 4.9 * 0.2)) / (2 * 4.9);
    const t0 = 0.4;
    const dt = 0.2;
    const state0: VerletState = {
      positions: [0, 2.5 * t0 - 0.5 * g * t0 * t0],
      velocities: [0, 2.5 - g * t0],
      t: t0
    };
    const advance = (s: VerletState, subDt: number): VerletState =>
      stepVelocityVerlet(s, subDt, () => [0, -g]);
    const eventFn = (s: VerletState): number => s.positions[1]! - 0.2;

    const g0 = eventFn(state0);
    const g1 = eventFn(advance(state0, dt));
    // 端点线性插值误差极大（远高于 1e-3 s）
    const linearInterpolatedT = t0 + dt * (g0 / (g0 - g1));
    expect(Math.abs(linearInterpolatedT - exactT)).toBeGreaterThan(1e-3);

    // 步进二分事件定位器误差依然远低于 1e-7 s
    const event = bisectEvent(state0, t0, dt, advance, eventFn, { timeTolerance: 1e-9 });
    expect(event).not.toBeNull();
    expect(Math.abs(event!.time - exactT)).toBeLessThan(1e-8);
  });

  it('computes half-space and rectangle signed distances accurately', () => {
    expect(signedDistanceHalfSpace2D(vec2(5, 3), vec2(2, 0), vec2(1, 0))).toBeCloseTo(3, 12);
    expect(signedDistanceRect2D(vec2(0, 0), -1, 1, -2, 2)).toBeCloseTo(-1, 12);
    expect(signedDistanceRect2D(vec2(4, 6), -1, 1, -2, 2)).toBeCloseTo(5, 12);
  });
});

describe('extreme boundary safety and fail-loudly guards', () => {
  it('handles B=0, v=0, q=0, electron mass, and dt=0 without NaN or Infinity', () => {
    const electron: ChargedParticleState = {
      position: vec3(0.01, -0.02, 0),
      velocity: ZERO_VEC3,
      t: 0
    };
    const zeroFields = () => ({ E: ZERO_VEC3, B: ZERO_VEC3 });

    const sZeroDt = stepBorisPusher(electron, zeroFields, -ELEMENTARY_CHARGE, ELECTRON_MASS, 0);
    assertAllFinite([
      sZeroDt.position.x,
      sZeroDt.position.y,
      sZeroDt.position.z,
      sZeroDt.velocity.x,
      sZeroDt.velocity.y,
      sZeroDt.velocity.z,
      sZeroDt.t
    ]);

    const sZeroCharge = stepBorisPusher(
      { position: vec3(1, 2, 3), velocity: vec3(4, 5, 6), t: 0 },
      () => ({ E: vec3(10, 0, 0), B: vec3(0, 0, 5) }),
      0,
      ELECTRON_MASS,
      1e-9
    );
    expect(sZeroCharge.velocity).toEqual(vec3(4, 5, 6));
    assertAllFinite([sZeroCharge.position.x, sZeroCharge.position.y, sZeroCharge.position.z]);

    const rkZeroDt = stepRK4([1, 2, 3], 0, 0, () => [0, 0, 0]);
    expect(rkZeroDt).toEqual([1, 2, 3]);

    const verletZeroDt = stepVelocityVerlet(
      { positions: [1], velocities: [0], t: 0 },
      0,
      () => [0]
    );
    expect(verletZeroDt.positions).toEqual([1]);

    const noEvent = bisectEvent(
      electron,
      0,
      0,
      (s, sub) => stepBorisPusher(s, zeroFields, -ELEMENTARY_CHARGE, ELECTRON_MASS, sub),
      (s) => s.position.x
    );
    expect(noEvent).toBeNull();
  });

  it('throws explicit errors for invalid mass or non-finite dt', () => {
    expect(() =>
      stepBorisPusher(
        { position: ZERO_VEC3, velocity: ZERO_VEC3, t: 0 },
        () => ({ E: ZERO_VEC3, B: ZERO_VEC3 }),
        1,
        0,
        0.01
      )
    ).toThrow(/Mass m must be a positive finite number/);

    expect(() => stepRK4([0], 0, Number.NaN, () => [0])).toThrow(/Time step dt must be finite/);

    expect(() => stepRK4([0, 1], 0, 0.01, () => [0])).toThrow(/length mismatch/);
    expect(() =>
      stepVelocityVerlet({ positions: [0, 1], velocities: [0, 0], t: 0 }, 0.01, () => [0])
    ).toThrow(/length mismatch/);
  });
});
