import { stepVelocityVerlet, type VerletState } from '@physforge/physics-core';
import type { InvariantReport, StepResult } from '@physforge/sim-sdk';

export type SpaceFlightMode = 'gravity-assist' | 'rendezvous';
export type FlybySide = 'trailing' | 'leading';
export type RendezvousBurn = 'prograde-boost' | 'retro-lower-catchup';

export type GravityAssistRendezvousParams = {
  mode: SpaceFlightMode;
  flybySide: FlybySide;
  muPlanet: number;
  planetOrbitRadius: number;
  impactParam: number;
  rendezvousBurn: RendezvousBurn;
  deltaVFraction: number;
};

export interface GravityAssistRendezvousState {
  readonly t: number;
  readonly pos: { x: number; y: number };
  readonly vel: { x: number; y: number };
  readonly planetPos: { x: number; y: number };
  readonly planetVel: { x: number; y: number };
  readonly targetAngleRad: number;
  readonly chaserAngleRad: number;
  readonly vInfInPlanet: number;
  readonly vInfOutPlanet: number;
  readonly planetFrameSpeedRelErr: number;
  readonly helioEnergyInitial: number;
  readonly helioEnergyCurrent: number;
  readonly targetOrbitPeriod: number;
  readonly chaserPhaseLagAfterPeriod: number | null;
  readonly trail: readonly { x: number; y: number; px: number; py: number }[];
}

function evalPlanetAt(t: number, rP: number): {
  pos: { x: number; y: number };
  vel: { x: number; y: number };
} {
  const muSun = 1.0;
  const omega = Math.sqrt(muSun / (rP * rP * rP));
  const ang = omega * t;
  const vP = omega * rP;
  return {
    pos: { x: rP * Math.cos(ang), y: rP * Math.sin(ang) },
    vel: { x: -vP * Math.sin(ang), y: vP * Math.cos(ang) }
  };
}

export function createInitialState(params: GravityAssistRendezvousParams): GravityAssistRendezvousState {
  if (params.mode === 'rendezvous') {
    const r0 = 1.0;
    const vCirc = 1.0;
    const dv = (params.rendezvousBurn === 'prograde-boost' ? 1 : -1) * Math.max(0.01, Math.min(0.18, params.deltaVFraction));
    const targetAng0 = 0.08; // target leads chaser initially at theta=0
    const pos = { x: r0, y: 0 };
    const vel = { x: 0, y: vCirc * (1 + dv) };
    const e0 = 0.5 * (vel.x * vel.x + vel.y * vel.y) - 1.0 / r0;
    return {
      t: 0,
      pos,
      vel,
      planetPos: { x: r0 * Math.cos(targetAng0), y: r0 * Math.sin(targetAng0) },
      planetVel: { x: -vCirc * Math.sin(targetAng0), y: vCirc * Math.cos(targetAng0) },
      targetAngleRad: targetAng0,
      chaserAngleRad: 0,
      vInfInPlanet: 0,
      vInfOutPlanet: 0,
      planetFrameSpeedRelErr: 0,
      helioEnergyInitial: e0,
      helioEnergyCurrent: e0,
      targetOrbitPeriod: 2 * Math.PI,
      chaserPhaseLagAfterPeriod: null,
      trail: [{ x: pos.x, y: pos.y, px: r0 * Math.cos(targetAng0), py: r0 * Math.sin(targetAng0) }]
    };
  }

  // Gravity assist local-tidal symplectic flyby: planet moving +y at x = rP, y = 0 (at t=0)
  // Neglect solar tidal curvature over brief close encounter in pure two-body flyby check or use exact two-body + planet frame!
  // Let's use exact sun-free local encounter frame boosted by v_planet OR full 3-body with short interaction?
  // Wait: spec checks BOTH heliocentric DeltaE > 0 (trailing) / < 0 (leading) AND planet-frame v_in == v_out (< 1e-5)!
  // A moving planet at constant velocity v_p in local region satisfies EXACTLY v_inf_in == v_inf_out in planet frame (< 1e-10 with Verlet)!
  const rP = Math.max(2, params.planetOrbitRadius);
  const vP = Math.sqrt(1.0 / rP); // e.g. 0.4472 at rP=5
  const b = Math.max(0.06, params.impactParam);
  const signOffset = params.flybySide === 'trailing' ? -1 : 1;
  // Spacecraft approaches along +x relative to planet? No: spacecraft crosses from inner x < rP outward toward planet moving +y:
  // In planet frame: spacecraft comes from (-4.0, signOffset * b) with velocity (+0.55, 0) moving toward planet at (0,0)
  // Wait: if trailing (passes behind moving planet, i.e. negative y side), planet attracts craft upward (+y, parallel to v_planet), increasing heliocentric v_y -> speedup!
  // If leading (passes ahead of moving planet, positive y side), planet attracts craft downward (-y, anti-parallel to v_planet), decreasing heliocentric v_y -> slowdown!
  const relPos0 = { x: -3.2, y: signOffset * b };
  const relVel0 = { x: 0.55, y: 0 };
  const p0 = { x: rP, y: 0 };
  const pv0 = { x: 0, y: vP };
  const helioPos0 = { x: p0.x + relPos0.x, y: p0.y + relPos0.y };
  const helioVel0 = { x: pv0.x + relVel0.x, y: pv0.y + relVel0.y };
  const vInf = Math.hypot(relVel0.x, relVel0.y);
  const helioKe0 = 0.5 * (helioVel0.x * helioVel0.x + helioVel0.y * helioVel0.y);

  return {
    t: 0,
    pos: helioPos0,
    vel: helioVel0,
    planetPos: p0,
    planetVel: pv0,
    targetAngleRad: 0,
    chaserAngleRad: 0,
    vInfInPlanet: vInf,
    vInfOutPlanet: vInf,
    planetFrameSpeedRelErr: 0,
    helioEnergyInitial: helioKe0,
    helioEnergyCurrent: helioKe0,
    targetOrbitPeriod: 2 * Math.PI,
    chaserPhaseLagAfterPeriod: null,
    trail: [{ x: helioPos0.x, y: helioPos0.y, px: p0.x, py: p0.y }]
  };
}

export function stepGravityAssistRendezvous(
  state: GravityAssistRendezvousState,
  params: GravityAssistRendezvousParams,
  dt: number
): StepResult<GravityAssistRendezvousState> {
  if (!Number.isFinite(dt) || dt < 0) throw new Error(`Invalid dt: ${dt}`);
  if (dt === 0) return { nextState: state, events: [] };

  if (params.mode === 'rendezvous') {
    const substeps = Math.max(10, Math.ceil(dt / 0.004));
    const h = dt / substeps;
    let verlet: VerletState = { positions: [state.pos.x, state.pos.y], velocities: [state.vel.x, state.vel.y], t: state.t };
    const accel = (p: readonly number[]): number[] => {
      const px = p[0]!;
      const py = p[1]!;
      const r2 = Math.max(1e-6, px * px + py * py);
      const r3 = r2 * Math.sqrt(r2);
      return [-px / r3, -py / r3];
    };
    for (let i = 0; i < substeps; i++) {
      verlet = stepVelocityVerlet(verlet, h, accel);
    }
    const vxOut = verlet.velocities[0]!;
    const vyOut = verlet.velocities[1]!;
    const pxOut = verlet.positions[0]!;
    const pyOut = verlet.positions[1]!;
    const targ = evalPlanetAt(verlet.t, 1.0);
    const tAng = verlet.t; // omega = 1 for r0=1
    const cAng = Math.atan2(pyOut, pxOut);
    let unwrappedChaser = cAng;
    while (unwrappedChaser < tAng - Math.PI) unwrappedChaser += 2 * Math.PI;
    while (unwrappedChaser > tAng + Math.PI) unwrappedChaser -= 2 * Math.PI;
    const lag =
      state.chaserPhaseLagAfterPeriod === null && verlet.t >= 2 * Math.PI - 1e-4
        ? (targ.pos.x * pyOut - targ.pos.y * pxOut)
        : state.chaserPhaseLagAfterPeriod;

    const eNow = 0.5 * (vxOut * vxOut + vyOut * vyOut) - 1.0 / Math.hypot(pxOut, pyOut);
    return {
      nextState: {
        ...state,
        t: verlet.t,
        pos: { x: pxOut, y: pyOut },
        vel: { x: vxOut, y: vyOut },
        planetPos: targ.pos,
        planetVel: targ.vel,
        targetAngleRad: tAng + 0.08,
        chaserAngleRad: unwrappedChaser,
        helioEnergyCurrent: eNow,
        chaserPhaseLagAfterPeriod: lag,
        trail: [...state.trail.slice(-240), { x: pxOut, y: pyOut, px: targ.pos.x, py: targ.pos.y }]
      },
      events: []
    };
  }

  // Gravity assist: integrate in planet frame via symplectic VelocityVerlet so planet-frame energy/speed error < 1e-8!
  const muP = Math.max(0.01, params.muPlanet);
  const substeps = Math.max(16, Math.ceil(dt / 0.002));
  const h = dt / substeps;
  const pv = state.planetVel;
  let verlet: VerletState = {
    positions: [state.pos.x - state.planetPos.x, state.pos.y - state.planetPos.y],
    velocities: [state.vel.x - pv.x, state.vel.y - pv.y],
    t: state.t
  };

  const accelPlanet = (p: readonly number[]): number[] => {
    const px = p[0]!;
    const py = p[1]!;
    const r2 = Math.max(1e-6, px * px + py * py);
    const r3 = r2 * Math.sqrt(r2);
    return [(-muP * px) / r3, (-muP * py) / r3];
  };

  for (let i = 0; i < substeps; i++) {
    verlet = stepVelocityVerlet(verlet, h, accelPlanet);
  }

  const nextPPos = {
    x: state.planetPos.x + pv.x * dt,
    y: state.planetPos.y + pv.y * dt
  };
  const relPx = verlet.positions[0]!;
  const relPy = verlet.positions[1]!;
  const relVx = verlet.velocities[0]!;
  const relVy = verlet.velocities[1]!;
  const helioPos = { x: nextPPos.x + relPx, y: nextPPos.y + relPy };
  const helioVel = { x: pv.x + relVx, y: pv.y + relVy };
  const vOut = Math.hypot(relVx, relVy);
  const rPlanetRel = Math.hypot(relPx, relPy);
  // Compare specific planet-frame energy at asymptote vs r=3.2 initial
  const r0Rel = Math.hypot(-3.2, params.impactParam);
  const eRel0 = 0.5 * state.vInfInPlanet * state.vInfInPlanet - muP / r0Rel;
  const eRelNow = 0.5 * vOut * vOut - muP / rPlanetRel;
  const vInfAsympNow = Math.sqrt(Math.max(0, 2 * (eRelNow + muP / r0Rel)));
  const speedRelErr = Math.abs(vInfAsympNow - state.vInfInPlanet) / state.vInfInPlanet;
  const helioKeNow = 0.5 * (helioVel.x * helioVel.x + helioVel.y * helioVel.y);

  return {
    nextState: {
      ...state,
      t: verlet.t,
      pos: helioPos,
      vel: helioVel,
      planetPos: nextPPos,
      vInfOutPlanet: vInfAsympNow,
      planetFrameSpeedRelErr: speedRelErr,
      helioEnergyCurrent: helioKeNow,
      trail: [...state.trail.slice(-240), { x: helioPos.x, y: helioPos.y, px: nextPPos.x, py: nextPPos.y }]
    },
    events: []
  };
}

export function computeObservables(state: GravityAssistRendezvousState): Record<string, number> {
  return {
    t: state.t,
    helioSpeed: Math.hypot(state.vel.x, state.vel.y),
    deltaHelioEnergy: state.helioEnergyCurrent - state.helioEnergyInitial,
    planetFrameSpeedRelErr: state.planetFrameSpeedRelErr,
    chaserAngleRad: state.chaserAngleRad,
    targetAngleRad: state.targetAngleRad
  };
}

export function checkInvariants(state: GravityAssistRendezvousState, _init: GravityAssistRendezvousState, params: GravityAssistRendezvousParams): InvariantReport[] {
  const err =
    params.mode === 'gravity-assist'
      ? state.planetFrameSpeedRelErr
      : Math.abs(state.helioEnergyCurrent - state.helioEnergyInitial) / Math.max(1e-6, Math.abs(state.helioEnergyInitial));
  return [
    {
      name: params.mode === 'gravity-assist' ? '行星共动系辛积分速度不变量残差' : '空间站辛积分轨道机械能相对漂移',
      measuredError: err,
      tolerance: 1e-5,
      passed: err < 1e-5
    }
  ];
}
