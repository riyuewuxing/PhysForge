import { CLASSROOM_GRAVITY, degToRad, solveUdwadiaKalaba } from '@physforge/physics-core';
import type { InvariantReport, PhysicsEvent, StepResult } from '@physforge/sim-sdk';
import type RAPIER from '@dimforge/rapier2d-compat';
import { getLoadedRapier, getRapierLoadError } from './rapierLoader.js';

export type SandboxScenario =
  | 'elastic-collision'
  | 'incline-slide'
  | 'spring-oscillator'
  | 'newtons-cradle'
  | 'atwood-constrained';

export type SandboxParams = {
  scenario: SandboxScenario;
  gravity: number;
  restitution: number;
  friction: number;
  massRatio: number;
  inclineDeg: number;
  springK: number;
};

export interface SandboxBodySnapshot {
  readonly id: string;
  readonly label: string;
  readonly shape: 'ball' | 'box';
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly angle: number;
  readonly angularVelocity?: number;
  readonly halfW: number;
  readonly halfH: number;
  readonly mass: number;
  readonly dynamic: boolean;
  readonly color: string;
}

export interface SandboxState {
  readonly t: number;
  readonly bodies: readonly SandboxBodySnapshot[];
  readonly rapierActive: boolean;
  readonly initialEnergy: number;
  readonly constraintTensionN?: number;
  readonly terminal?: 'pulley-contact' | 'engine-unavailable';
  readonly events: readonly PhysicsEvent[];
}

interface RapierRuntime {
  world: RAPIER.World;
  bodyHandles: Map<string, RAPIER.RigidBody>;
 }

const runtimeMap = new WeakMap<SandboxState, RapierRuntime>();
/** Only the current state owns the mutable world. Historical snapshots hold value data. */
export function disposeSandbox(state:SandboxState):void {
  const rt=runtimeMap.get(state);
  if(rt){runtimeMap.delete(state);rt.world.free();}
}

export const SPRING_EQUILIBRIUM_X = -.45;
export function usesAnalyticSolver(scenario:SandboxScenario):boolean {
  return scenario==='spring-oscillator'||scenario==='atwood-constrained';
}
function solveAtwood(m1:number,m2:number,g:number){
  return solveUdwadiaKalaba({
    massDiagonal:[m1,m2],unconstrainedAccel:[-g,-g],
    constraintMatrixA:[[1,1]],constraintVectorB:[0]
  });
}

function createInitialBodies(params: SandboxParams): SandboxBodySnapshot[] {
  const m1 = 1.0;
  const m2 = Math.max(0.2, params.massRatio);
  const floorY = -1.2;

  if (params.scenario === 'elastic-collision') {
    return [
      {
        id: 'floor',
        label: '光滑地面',
        shape: 'box',
        x: 0,
        y: floorY - 0.15,
        vx: 0,
        vy: 0,
        angle: 0,
        halfW: 5.0,
        halfH: 0.15,
        mass: 0,
        dynamic: false,
        color: '#475569'
      },
      {
        id: 'left-wall',
        label: '左挡板',
        shape: 'box',
        x: -3.8,
        y: 0,
        vx: 0,
        vy: 0,
        angle: 0,
        halfW: 0.15,
        halfH: 2.0,
        mass: 0,
        dynamic: false,
        color: '#475569'
      },
      {
        id: 'right-wall',
        label: '右挡板',
        shape: 'box',
        x: 3.8,
        y: 0,
        vx: 0,
        vy: 0,
        angle: 0,
        halfW: 0.15,
        halfH: 2.0,
        mass: 0,
        dynamic: false,
        color: '#475569'
      },
      {
        id: 'b1',
        label: `球1 (${m1.toFixed(1)}kg)`,
        shape: 'ball',
        x: -1.8,
        y: floorY + 0.25,
        vx: 2.6,
        vy: 0,
        angle: 0,
        halfW: 0.25,
        halfH: 0.25,
        mass: m1,
        dynamic: true,
        color: '#38bdf8'
      },
      {
        id: 'b2',
        label: `球2 (${m2.toFixed(1)}kg)`,
        shape: 'ball',
        x: 0.6,
        y: floorY + 0.25,
        vx: 0,
        vy: 0,
        angle: 0,
        halfW: 0.25,
        halfH: 0.25,
        mass: m2,
        dynamic: true,
        color: '#f472b6'
      }
    ];
  }

  if (params.scenario === 'incline-slide') {
    const theta = degToRad(params.inclineDeg);
    const c=Math.cos(theta),s=Math.sin(theta);
    const rampX=-1.6,rampY=floorY+1.8*s-.1*c;
    const startAlong=-1.15,normalOffset=.1+.18;
    const sliderX=rampX+startAlong*c+normalOffset*s;
    const sliderY=rampY-startAlong*s+normalOffset*c;
    return [
      {
        id: 'floor',
        label: '水平桌面',
        shape: 'box',
        x: 0,
        y: floorY - 0.15,
        vx: 0,
        vy: 0,
        angle: 0,
        halfW: 5.0,
        halfH: 0.15,
        mass: 0,
        dynamic: false,
        color: '#475569'
      },
      {
        id: 'ramp',
        label: '斜面',
        shape: 'box',
        x: rampX,
        y: rampY,
        vx: 0,
        vy: 0,
        angle: -theta,
        halfW: 1.8,
        halfH: 0.1,
        mass: 0,
        dynamic: false,
        color: '#64748b'
      },
      {
        id: 'slider',
        label: '滑块 1',
        shape: 'box',
        x: sliderX,
        y: sliderY,
        vx: 0,
        vy: 0,
        angle: -theta,
        halfW: 0.22,
        halfH: 0.18,
        mass: m1,
        dynamic: true,
        color: '#38bdf8'
      },
      {
        id: 'target',
        label: '滑块 2',
        shape: 'box',
        x: 1.0,
        y: floorY + 0.2,
        vx: 0,
        vy: 0,
        angle: 0,
        halfW: 0.22,
        halfH: 0.2,
        mass: m2,
        dynamic: true,
        color: '#fbbf24'
      }
    ];
  }

  if (params.scenario === 'spring-oscillator') {
    return [
      {
        id: 'floor',
        label: '气垫导轨',
        shape: 'box',
        x: 0,
        y: floorY - 0.15,
        vx: 0,
        vy: 0,
        angle: 0,
        halfW: 5.0,
        halfH: 0.15,
        mass: 0,
        dynamic: false,
        color: '#475569'
      },
      {
        id: 'anchor',
        label: '固定墙',
        shape: 'box',
        x: -3.2,
        y: floorY + 0.24,
        vx: 0,
        vy: 0,
        angle: 0,
        halfW: 0.15,
        halfH: 0.6,
        mass: 0,
        dynamic: false,
        color: '#64748b'
      },
      {
        id: 'mass-block',
        label: '弹簧振子',
        shape: 'box',
        x: 0.8,
        y: floorY + 0.24,
        vx: 0,
        vy: 0,
        angle: 0,
        halfW: 0.28,
        halfH: 0.24,
        mass: m1,
        dynamic: true,
        color: '#4ade80'
      }
    ];
  }

  if (params.scenario === 'atwood-constrained') {
    return [
      {
        id: 'pulley',
        label: '定滑轮',
        shape: 'ball',
        x: 0,
        y: 1.4,
        vx: 0,
        vy: 0,
        angle: 0,
        halfW: 0.28,
        halfH: 0.28,
        mass: 0,
        dynamic: false,
        color: '#94a3b8'
      },
      {
        id: 'atwood-left',
        label: 'm₁',
        shape: 'box',
        x: -0.28,
        y: 0.1,
        vx: 0,
        vy: 0,
        angle: 0,
        halfW: 0.22,
        halfH: 0.22,
        mass: m1,
        dynamic: true,
        color: '#38bdf8'
      },
      {
        id: 'atwood-right',
        label: 'm₂',
        shape: 'box',
        x: 0.28,
        y: 0.1,
        vx: 0,
        vy: 0,
        angle: 0,
        halfW: 0.24,
        halfH: 0.24,
        mass: m2,
        dynamic: true,
        color: '#f472b6'
      }
    ];
  }

  // newtons-cradle 四球动量传递
  return [
    {
      id: 'floor',
      label: '导轨',
      shape: 'box',
      x: 0,
      y: floorY - 0.15,
      vx: 0,
      vy: 0,
      angle: 0,
      halfW: 5.0,
      halfH: 0.15,
      mass: 0,
      dynamic: false,
      color: '#475569'
    },
    {
      id: 'c0',
      label: '球1',
      shape: 'ball',
      x: -2.0,
      y: floorY + 0.24,
      vx: 3.0,
      vy: 0,
      angle: 0,
      halfW: 0.24,
      halfH: 0.24,
      mass: 1.0,
      dynamic: true,
      color: '#38bdf8'
    },
    {
      id: 'c1',
      label: '球2',
      shape: 'ball',
      x: 0.0,
      y: floorY + 0.24,
      vx: 0,
      vy: 0,
      angle: 0,
      halfW: 0.24,
      halfH: 0.24,
      mass: 1.0,
      dynamic: true,
      color: '#f472b6'
    },
    {
      id: 'c2',
      label: '球3',
      shape: 'ball',
      x: 0.5,
      y: floorY + 0.24,
      vx: 0,
      vy: 0,
      angle: 0,
      halfW: 0.24,
      halfH: 0.24,
      mass: 1.0,
      dynamic: true,
      color: '#fbbf24'
    },
    {
      id: 'c3',
      label: '球4',
      shape: 'ball',
      x: 1.0,
      y: floorY + 0.24,
      vx: 0,
      vy: 0,
      angle: 0,
      halfW: 0.24,
      halfH: 0.24,
      mass: 1.0,
      dynamic: true,
      color: '#4ade80'
    }
  ];
}

function buildRapierRuntime(
  rapier: typeof RAPIER,
  bodies: readonly SandboxBodySnapshot[],
  params: SandboxParams
): RapierRuntime {
  const world = new rapier.World({ x: 0, y: -params.gravity });
  const bodyHandles = new Map<string, RAPIER.RigidBody>();

  for (const b of bodies) {
    const rbDesc = b.dynamic
      ? rapier.RigidBodyDesc.dynamic()
          .setTranslation(b.x, b.y)
          .setRotation(b.angle)
          .setLinvel(b.vx, b.vy)
          .setAngvel(b.angularVelocity??0)
          .setLinearDamping(0)
          .setAngularDamping(0)
      : rapier.RigidBodyDesc.fixed().setTranslation(b.x, b.y).setRotation(b.angle);

    const rb = world.createRigidBody(rbDesc);
    const colDesc =
      b.shape === 'ball'
        ? rapier.ColliderDesc.ball(b.halfW)
        : rapier.ColliderDesc.cuboid(b.halfW, b.halfH);

    colDesc
      .setRestitution(params.restitution)
      .setRestitutionCombineRule(rapier.CoefficientCombineRule.Max)
      .setFriction(b.id === 'floor' && params.scenario !== 'incline-slide' ? 0 : params.friction)
      .setFrictionCombineRule(rapier.CoefficientCombineRule.Min);

    if (b.dynamic) {
      const area =
        b.shape === 'ball' ? Math.PI * b.halfW * b.halfW : 4 * b.halfW * b.halfH;
      colDesc.setDensity(b.mass / Math.max(area, 1e-4));
    }

    world.createCollider(colDesc, rb);
    bodyHandles.set(b.id, rb);
  }

  return { world, bodyHandles };
}

function computeTotalEnergy(
  bodies: readonly SandboxBodySnapshot[],
  params: SandboxParams
): { ke: number; pe: number; springPe: number; momentumX: number } {
  let ke = 0;
  let pe = 0;
  let momentumX = 0;
  let springPe = 0;
  const floorRef = -1.2;

  for (const b of bodies) {
    if (!b.dynamic) continue;
    const inertia=b.shape==='ball'?.5*b.mass*b.halfW**2:b.mass*(b.halfW**2+b.halfH**2)/3;
    ke += 0.5 * b.mass * (b.vx * b.vx + b.vy * b.vy)+.5*inertia*(b.angularVelocity??0)**2;
    pe += b.mass * params.gravity * (b.y - floorRef);
    momentumX += b.mass * b.vx;
    if (params.scenario === 'spring-oscillator' && b.id === 'mass-block') {
      const dx = b.x - SPRING_EQUILIBRIUM_X;
      springPe += 0.5 * params.springK * dx * dx;
    }
  }
  return { ke, pe, springPe, momentumX };
}

export function createInitialState(params: SandboxParams): SandboxState {
  const bodies = createInitialBodies(params);
  const rapier = usesAnalyticSolver(params.scenario)?null:getLoadedRapier();
  const energy = computeTotalEnergy(bodies, params);
  const tension=params.scenario==='atwood-constrained'
    ?solveAtwood(bodies.find(b=>b.id==='atwood-left')!.mass,bodies.find(b=>b.id==='atwood-right')!.mass,params.gravity).constraintForce[0]!
    :undefined;

  const state: SandboxState = {
    t: 0,
    bodies,
    rapierActive: rapier !== null,
    initialEnergy: energy.ke + energy.pe + energy.springPe,
    ...(tension===undefined?{}:{constraintTensionN:tension}),
    events: []
  };

  if (rapier) {
    const rt = buildRapierRuntime(rapier, bodies, params);
     runtimeMap.set(state, rt);
  }
  return state;
}

export function stepSandbox(
  state: SandboxState,
  params: SandboxParams,
  dt: number
): StepResult<SandboxState> {
  if (!Number.isFinite(dt) || dt < 0) {
    throw new Error(`Time step dt must be non-negative finite, got ${dt}.`);
  }
  if (dt === 0) return {nextState:state,events:[]};
  if(state.terminal)return {nextState:state,events:[],advancedTime:0,halt:true};

  // These ideal constrained systems have a fixed solver; WASM readiness
  // must not alter their trajectory or allocate an unused rigid-body world.
  if(params.scenario==='spring-oscillator'){
    const bodies=state.bodies.map(b=>{
      if(b.id!=='mass-block')return b;
      const w=Math.sqrt(Math.max(0,params.springK)/b.mass);
      const q=b.x-SPRING_EQUILIBRIUM_X;
      if(w===0)return {...b,x:b.x+b.vx*dt};
      const c=Math.cos(w*dt),s=Math.sin(w*dt);
      return {...b,x:SPRING_EQUILIBRIUM_X+q*c+b.vx*s/w,vx:b.vx*c-q*w*s};
    });
    return {nextState:{...state,t:state.t+dt,bodies,rapierActive:false},events:[]};
  }

  if (params.scenario === 'atwood-constrained') {
    const left = state.bodies.find((b) => b.id === 'atwood-left');
    const right = state.bodies.find((b) => b.id === 'atwood-right');
    if (left && right) {
      const uk = solveAtwood(left.mass,right.mass,params.gravity);
      const ay1 = uk.acceleration[0]!;
      const ay2 = uk.acceleration[1]!;
      const pulley=state.bodies.find(b=>b.id==='pulley')!;
      // First circle/rectangle contact, not an arbitrary maximum time.
      let elapsed=dt,contact=false;
      for(const [b,a] of [[left,ay1],[right,ay2]] as const){
        const dx=Math.max(0,Math.abs(b.x-pulley.x)-b.halfW);
        if(dx>=pulley.halfW)continue;
        const ceiling=pulley.y-Math.sqrt(pulley.halfW**2-dx**2)-b.halfH;
        const gap=Math.max(0,ceiling-b.y);
        if(a>0||b.vy>0){
          // Stable positive root for the constant-acceleration contact event.
          const discriminant=b.vy*b.vy+2*a*gap;
          if(discriminant<0)continue;
          const denominator=b.vy+Math.sqrt(discriminant);
          const hit=gap===0?0:denominator>0?2*gap/denominator:Infinity;
          if(hit<=elapsed){elapsed=hit;contact=true;}
        }
      }
      const nextVy1 = left.vy + ay1 * elapsed;
      const nextVy2 = right.vy + ay2 * elapsed;
      const nextY1 = left.y + 0.5 * (left.vy + nextVy1) * elapsed;
      const nextY2 = right.y + 0.5 * (right.vy + nextVy2) * elapsed;
      const tensionN = uk.constraintForce[0]!;
      const updated = state.bodies.map((b) =>
        b.id === 'atwood-left'
          ? { ...b, y: nextY1, vy: nextVy1 }
          : b.id === 'atwood-right'
            ? { ...b, y: nextY2, vy: nextVy2 }
            : b
      );
      const time=state.t+elapsed;
      const events:PhysicsEvent[]=contact?[{id:'atwood-pulley-contact',time,label:'首次接触滑轮：模型止于碰撞前一瞬'}]:[];
      return {
        nextState: {
          t:time,bodies:updated,rapierActive:false,initialEnergy:state.initialEnergy,
          constraintTensionN:tensionN,events:[...state.events,...events],
          ...(contact?{terminal:'pulley-contact' as const}:{})
        },
        events,advancedTime:elapsed,halt:contact
      };
    }
  }

  const rapier = getLoadedRapier();
  let rt = runtimeMap.get(state);
  if (!rt && rapier) rt = buildRapierRuntime(rapier,state.bodies,params);

  if (rt && rapier) {
    rt.world.gravity = { x: 0, y: -params.gravity };
    rt.world.timestep = dt;
    rt.world.step();
    runtimeMap.delete(state); // transfer ownership; stepping an old frame reconstructs its own world

    const nextBodies = state.bodies.map((b) => {
      if (!b.dynamic) return b;
      const rb = rt!.bodyHandles.get(b.id);
      if (!rb) return b;
      const tr = rb.translation();
      const vel = rb.linvel();
      return {
        ...b,
        x: tr.x,
        y: tr.y,
        vx: vel.x,
        vy: vel.y,
        angle: rb.rotation(),
        angularVelocity: rb.angvel()
      };
    });

    const nextState: SandboxState = {
      t: state.t + dt,
      bodies: nextBodies,
      rapierActive: true,
      initialEnergy: state.initialEnergy,
      events: state.events
    };
    runtimeMap.set(nextState, rt);
    return { nextState, events: [] };
  }

  // Loading is not physical evolution. Do not advance time or substitute free fall.
  if(getRapierLoadError()){
    const event:PhysicsEvent={id:'rapier-unavailable',time:state.t,label:'刚体引擎加载失败：请复位重试'};
    return {nextState:{...state,terminal:'engine-unavailable',events:[...state.events,event]},events:[event],advancedTime:0,halt:true};
  }
  return {nextState:state,events:[],advancedTime:0};
}

export function computeObservables(
  state: SandboxState,
  params: SandboxParams
): Record<string, number> {
  const { ke, pe, springPe, momentumX } = computeTotalEnergy(state.bodies, params);
  const firstDyn = state.bodies.find((b) => b.dynamic);
  return {
    kineticEnergy: ke,
    potentialEnergy: pe + springPe,
    totalMomentumX: momentumX,
    primaryX: firstDyn?.x ?? 0,
    primaryVx: firstDyn?.vx ?? 0,
    ...(params.scenario==='spring-oscillator'?{springPotentialEnergy:springPe,springMechanicalEnergy:ke+springPe}:{}),
    ...(params.scenario==='atwood-constrained'?{
      primaryY:firstDyn!.y,primaryVy:firstDyn!.vy,
      secondaryY:state.bodies.find(b=>b.id==='atwood-right')!.y,
      secondaryVy:state.bodies.find(b=>b.id==='atwood-right')!.vy
    }:{}),
    constraintTensionN: state.constraintTensionN ?? 0,
    rapierActive: state.rapierActive ? 1 : 0,
    ...(params.scenario==='atwood-constrained'?{atwoodAtLimit:state.terminal==='pulley-contact'?1:0}:{}),
    ...(params.scenario==='incline-slide'?{sliderY:firstDyn!.y,sliderVy:firstDyn!.vy,sliderAngle:firstDyn!.angle}:{}),
    ...(params.scenario==='elastic-collision'?{secondaryVx:state.bodies.find(b=>b.id==='b2')!.vx}:{}),
    ...(params.scenario==='newtons-cradle'?{lastBallVx:state.bodies.find(b=>b.id==='c3')!.vx}:{}),
    engineUnavailable:state.terminal==='engine-unavailable'?1:0
  };
}

export function checkInvariants(
  state: SandboxState,
  initial: SandboxState,
  params: SandboxParams
): InvariantReport[] {
  const residual=(name:string,value:number,tolerance:number,unit?:string):InvariantReport=>({
    name,measuredError:Math.abs(value),tolerance,unit,passed:Number.isFinite(value)&&Math.abs(value)<tolerance
  });
  if(params.scenario==='spring-oscillator'){
    const a=computeTotalEnergy(initial.bodies,params),b=computeTotalEnergy(state.bodies,params);
    const e0=a.ke+a.springPe,e=b.ke+b.springPe;
    return [residual('理想弹簧振子机械能相对误差',(e-e0)/Math.max(e0,1e-9),1e-6)];
  }
  if(params.scenario==='atwood-constrained'){
    const a=initial.bodies.find(b=>b.id==='atwood-left')!,b=initial.bodies.find(b=>b.id==='atwood-right')!;
    const l=state.bodies.find(b=>b.id==='atwood-left')!,r=state.bodies.find(b=>b.id==='atwood-right')!;
    const t=2*l.mass*r.mass*params.gravity/(l.mass+r.mass);
    const e=computeTotalEnergy(state.bodies,params),e0=computeTotalEnergy(initial.bodies,params);
    return [
      residual('不可伸长绳位置约束',l.y+r.y-a.y-b.y,1e-9,'m'),
      residual('不可伸长绳速度约束',l.vy+r.vy,1e-9,'m/s'),
      residual('理想轻绳张力',(state.constraintTensionN??NaN)-t,1e-9,'N'),
      residual('阿特伍德系统机械能相对误差',(e.ke+e.pe-e0.ke-e0.pe)/Math.max(Math.abs(e0.ke+e0.pe),1e-9),1e-6)
    ];
  }
  if (params.scenario === 'elastic-collision') {
    const p0 = computeTotalEnergy(initial.bodies, params).momentumX;
    const p1 = computeTotalEnergy(state.bodies, params).momentumX;
    const err = Math.abs(p1 - p0) / Math.max(Math.abs(p0), 1e-6);
    return [
      {
        name: '一维碰撞总动量守恒 (无墙外撞阶段)',
        measuredError: err,
        tolerance: 1e-2,
        passed: err < 1e-2
      }
    ];
  }
  return [];
}

export const DEFAULT_SANDBOX_GRAVITY = CLASSROOM_GRAVITY;
