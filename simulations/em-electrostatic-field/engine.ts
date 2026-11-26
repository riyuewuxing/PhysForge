import {
  bisectEvent,
  createScaleContext,
  extractIsolines,
  integrateAdaptiveRK45,
  stepRK4,
  type IsolineContour
} from '@physforge/physics-core';
import type { InvariantReport, PhysicsEvent, StepResult } from '@physforge/sim-sdk';

export type ElectrostaticMode =
  | 'dipole-point-charges'
  | 'uniform-three-point'
  | 'deflection-tube';

export type ElectrostaticParams = {
  mode: ElectrostaticMode;
  q1MicroC: number;
  q2MicroC: number;
  x1: number;
  x2: number;
  testChargeRatio: number;
  v0x: number;
  v0y: number;
  startY: number;
  uAccelV: number;
  uDeflectV: number;
  phiA: number;
  phiB: number;
  phiC: number;
};

export interface ElectrostaticState {
  readonly t: number;
  readonly px: number;
  readonly py: number;
  readonly vx: number;
  readonly vy: number;
  readonly trail: readonly { x: number; y: number }[];
  readonly initialEnergy: number;
  readonly tubePhase: 'approach'|'inside'|'exit'|'hit'|null;
  readonly tubeWork: number;
  readonly events: readonly PhysicsEvent[];
}

export const ELECTROSTATIC_SCALE = createScaleContext({
  lengthUnit: 1.0,
  timeUnit: 1.0,
  massUnit: 1.0,
  chargeUnit: 1e-6
});

const SOFTENING_SQ = 1e-4;

export function evalPointChargePotentialAndField(
  x: number,
  y: number,
  params: ElectrostaticParams
): { phi: number; Ex: number; Ey: number } {
  const charges = [
    { q: params.q1MicroC, cx: params.x1, cy: 0 },
    { q: params.q2MicroC, cx: params.x2, cy: 0 }
  ];
  let phi = 0;
  let Ex = 0;
  let Ey = 0;
  for (const c of charges) {
    const dx = x - c.cx;
    const dy = y - c.cy;
    const r2 = dx * dx + dy * dy + SOFTENING_SQ;
    const r = Math.sqrt(r2);
    phi += c.q / r;
    const invR3 = c.q / (r2 * r);
    Ex += invR3 * dx;
    Ey += invR3 * dy;
  }
  return { phi, Ex, Ey };
}

export function solveThreePointUniformField(params: ElectrostaticParams): {
  Ex: number;
  Ey: number;
  A: { x: number; y: number; phi: number };
  B: { x: number; y: number; phi: number };
  C: { x: number; y: number; phi: number };
  equalPointOnAC: { x: number; y: number } | null;
  construction: {start:{x:number;y:number;phi:number;id:string};end:{x:number;y:number};lowId:string;highId:string;fraction:number}|null;
} {
  const A = { x: -1.4, y: -0.9, phi: params.phiA };
  const B = { x: 0.2, y: 1.1, phi: params.phiB };
  const C = { x: 1.5, y: -0.7, phi: params.phiC };

  // Solve grad(phi) . (B - A) = phiB - phiA and grad(phi) . (C - A) = phiC - phiA
  const ax = B.x - A.x;
  const ay = B.y - A.y;
  const bx = C.x - A.x;
  const by = C.y - A.y;
  const det = ax * by - ay * bx;
  const dPhiB = B.phi - A.phi;
  const dPhiC = C.phi - A.phi;

  const gx = (dPhiB * by - ay * dPhiC) / det;
  const gy = (ax * dPhiC - dPhiB * bx) / det;

  // Legacy A-C intersection is defined only when that line can contain B's potential.
  const tAC=C.phi!==A.phi?(B.phi-A.phi)/(C.phi-A.phi):null;
  const equalPointOnAC=tAC===null?(B.phi===A.phi?{x:A.x,y:A.y}:null):
    {x:A.x+tAC*(C.x-A.x),y:A.y+tAC*(C.y-A.y)};
  const [low,mid,high]=[{...A,id:'A'},{...B,id:'B'},{...C,id:'C'}].sort((a,b)=>a.phi-b.phi);
  const span=high!.phi-low!.phi;
  const fraction=span===0?0:(mid!.phi-low!.phi)/span;
  const construction=span===0?null:{
    start:mid!,
    end:{x:low!.x+fraction*(high!.x-low!.x),y:low!.y+fraction*(high!.y-low!.y)},
    lowId:low!.id,highId:high!.id,fraction
  };
  return { Ex: gx===0?0:-gx, Ey: gy===0?0:-gy, A, B, C, equalPointOnAC,construction };
}

export function extractElectrostaticIsolines(params: ElectrostaticParams): IsolineContour[] {
  if(params.mode==='deflection-tube')return [];
  if(params.mode==='dipole-point-charges'&&params.q1MicroC===0&&params.q2MicroC===0)return [];
  const uniform=params.mode==='uniform-three-point'?solveThreePointUniformField(params):null;
  if(uniform&&uniform.Ex===0&&uniform.Ey===0)return [];
  const nx = 121;
  const ny = 89;
  const bounds = { xMin: -3.2, xMax: 3.2, yMin: -2.2, yMax: 2.2 };
  const grid = new Float64Array(nx * ny);

  for (let j = 0; j < ny; j++) {
    const y = bounds.yMin + (j / (ny - 1)) * (bounds.yMax - bounds.yMin);
    for (let i = 0; i < nx; i++) {
      const x = bounds.xMin + (i / (nx - 1)) * (bounds.xMax - bounds.xMin);
      const val =
        uniform ? uniform.A.phi-uniform.Ex*(x-uniform.A.x)-uniform.Ey*(y-uniform.A.y)
          : evalPointChargePotentialAndField(x,y,params).phi;
      grid[j * nx + i] = val;
    }
  }

  const levels =
    params.mode === 'uniform-three-point'
      ? Array.from({length:9},(_,i)=>Math.min(params.phiA,params.phiB,params.phiC)+i*(Math.max(params.phiA,params.phiB,params.phiC)-Math.min(params.phiA,params.phiB,params.phiC))/8)
      : [-4, -2.5, -1.2, -0.5, 0, 0.5, 1.2, 2.5, 4];
  return extractIsolines(grid, nx, ny, bounds, levels);
}

export function traceFieldLines(params: ElectrostaticParams): { x: number; y: number }[][] {
  if (params.mode !== 'dipole-point-charges') return [];
  const seeds: { x: number; y: number; dir: number }[] = [];
  const list = [
    { q: params.q1MicroC, cx: params.x1 },
    { q: params.q2MicroC, cx: params.x2 }
  ];
  for (const ch of list) {
    if (Math.abs(ch.q) < 0.05) continue;
    const count = Math.max(3,Math.round(4*Math.abs(ch.q)));
    const dir = ch.q > 0 ? 1 : -1;
    for (let k = 0; k < count; k++) {
      const ang = (k / count) * Math.PI * 2 + 0.12;
      seeds.push({
        x: ch.cx + 0.18 * Math.cos(ang),
        y: 0.18 * Math.sin(ang),
        dir
      });
    }
  }

  const lines: { x: number; y: number }[][] = [];
  for (const s of seeds) {
    const pts: { x: number; y: number }[] = [{ x: s.x, y: s.y }];
    let cx = s.x;
    let cy = s.y;
    for (let step = 0; step < 160; step++) {
      const field=evalPointChargePotentialAndField(cx,cy,params);
      if(Math.hypot(field.Ex,field.Ey)<1e-8)break;
      const next = stepRK4([cx, cy], 0, 0.06, (_t, xy) => {
        const { Ex, Ey } = evalPointChargePotentialAndField(xy[0]!, xy[1]!, params);
        const mag = Math.hypot(Ex, Ey);
        return mag > 1e-8 ? [(s.dir * Ex) / mag, (s.dir * Ey) / mag] : [0, 0];
      });
      cx = next[0]!;
      cy = next[1]!;
      pts.push({ x: cx, y: cy });
      if (Math.abs(cx) > 3.3 || Math.abs(cy) > 2.3) break;
      const nearCharge=list.some(ch=>ch.q!==0&&Math.hypot(cx-ch.cx,cy)<0.12);
      if (nearCharge) break;
    }
    // Reverse negative-source integration to make every polyline follow the physical E direction.
    // Connections already seeded from a positive source need not be drawn twice.
    if(s.dir<0&&list.some(ch=>ch.q>0&&Math.hypot(cx-ch.cx,cy)<0.12))continue;
    if(pts.length>1)lines.push(s.dir<0?pts.reverse():pts);
  }
  return lines;
}

function getFieldAt(x: number, y: number, params: ElectrostaticParams): { phi: number; Ex: number; Ey: number } {
  if (params.mode === 'uniform-three-point') {
    const sol = solveThreePointUniformField(params);
    return {
      phi: sol.A.phi - sol.Ex * (x - sol.A.x) - sol.Ey * (y - sol.A.y),
      Ex: sol.Ex,
      Ey: sol.Ey
    };
  }
  if (params.mode === 'deflection-tube') {
    // Deflection plates occupy x in [-1.0, 1.0], plate separation d = 2.0, U2 = uDeflectV
    const d = 2.0;
    const inPlates = x >= -1.0 && x <= 1.0 && Math.abs(y) <= 1.0;
    const Ey = inPlates ? params.uDeflectV / d : 0;
    return { phi: -Ey * y, Ex: 0, Ey };
  }
  return evalPointChargePotentialAndField(x, y, params);
}

export function createInitialState(params: ElectrostaticParams): ElectrostaticState {
  const px0 =
    params.mode === 'deflection-tube' ? -1.4 : params.mode === 'uniform-three-point' ? -1.2 : -2.2;
  const py0 = params.mode === 'deflection-tube' ? 0 : params.startY;
  const vx0 =
    params.mode === 'deflection-tube'
      ? Math.sqrt(2 * Math.abs(params.testChargeRatio) * params.uAccelV)
      : params.v0x;
  const vy0 = params.mode === 'deflection-tube' ? 0 : params.v0y;

  const pxDim = ELECTROSTATIC_SCALE.toDimless(px0, 'length');
  const pyDim = ELECTROSTATIC_SCALE.toDimless(py0, 'length');
  const { phi } = getFieldAt(pxDim, pyDim, params);
  const ek = 0.5 * (vx0 * vx0 + vy0 * vy0);
  const e0 = ek + params.testChargeRatio * phi;

  return {
    t: 0,
    px: pxDim,
    py: pyDim,
    vx: vx0,
    vy: vy0,
    trail: [{ x: pxDim, y: pyDim }],
    initialEnergy: e0,
    tubePhase:params.mode==='deflection-tube'?'approach':null,
    tubeWork:0,
    events: []
  };
}

/** Exact piecewise constant acceleration. Plate crossings are bracketed in time,
 * with a separate phase preventing repeated events at a shared endpoint. */
function stepTube(state:ElectrostaticState,p:ElectrostaticParams,dt:number):StepResult<ElectrostaticState>{
  if(state.tubePhase==='hit')return {nextState:state,events:[],halt:true,advancedTime:0};
  let cur=state,remaining=dt;
  const events:PhysicsEvent[]=[];
  let trail=[...state.trail];
  const append=(q:ElectrostaticState,force=false)=>{
    const last=trail.at(-1);
    if(force||!last||Math.hypot(q.px-last.x,q.py-last.y)>0.03)
      trail=[...trail.slice(-300),{x:q.px,y:q.py}];
  };
  for(let transitions=0;remaining>0&&transitions<3;transitions++){
    const phase=cur.tubePhase;
    const ay=phase==='inside'?p.testChargeRatio*p.uDeflectV/2:0;
    const advance=(q:ElectrostaticState,h:number):ElectrostaticState=>{
      const py=q.py+q.vy*h+0.5*ay*h*h;
      return {...q,t:q.t+h,px:q.px+q.vx*h,py,vy:q.vy+ay*h,tubeWork:q.tubeWork+ay*(py-q.py)};
    };
    const end=advance(cur,remaining);
    const root=(fn:(q:ElectrostaticState)=>number)=>{
      // Snap only roundoff-sized endpoint errors; never clip a physical overshoot.
      if(Math.abs(fn(end))<=8*Number.EPSILON)return remaining;
      const hit=bisectEvent(cur,cur.t,remaining,advance,fn,{timeTolerance:1e-13,triggerOnStartZero:true});
      return hit?.timeOffset??null;
    };
    const edge=phase==='approach'?-1:1;
    const crossing=(phase==='approach'||phase==='inside')&&cur.vx>0?root(q=>q.px-edge):null;
    const wall=phase==='inside'&&ay!==0?root(q=>Math.sign(ay)*q.py-1):null;
    const hitWall=wall!==null&&(crossing===null||wall<=crossing+1e-12);
    const h=hitWall?wall:crossing;
    if(h===null){cur=end;append(cur);remaining=0;break;}
    const next=advance(cur,h);
    remaining=Math.max(0,remaining-h);
    const nextPhase=hitWall?'hit':phase==='approach'?'inside':'exit';
    const py=hitWall?Math.sign(ay):next.py;
    cur={...next,px:hitWall?next.px:edge,py,tubePhase:nextPhase,
      tubeWork:next.tubeWork+ay*(py-next.py)};
    append(cur,true);
    const kind=hitWall?'hit-plate':phase==='approach'?'entry-plate':'exit-plate';
    events.push({id:kind+'-'+(state.events.length+events.length),time:cur.t,
      label:hitWall?'首次触板 · 碰撞前停止':phase==='approach'?'进入理想偏转区':'离开理想偏转区',
      position:{x:cur.px,y:cur.py},metrics:{vx:cur.vx,vy:cur.vy,...(nextPhase==='exit'?{yExit:cur.py}:{})}});
    if(hitWall)break;
  }
  const terminal=cur.tubePhase==='hit';
  return {nextState:{...cur,trail,events:[...state.events,...events]},events,
    ...(terminal?{halt:true,advancedTime:cur.t-state.t}:{})};
}

export function stepElectrostatic(
  state: ElectrostaticState,
  params: ElectrostaticParams,
  dt: number
): StepResult<ElectrostaticState> {
  if (!Number.isFinite(dt) || dt < 0) throw new Error(`Invalid dt: ${dt}`);
  if(params.mode==='deflection-tube')return stepTube(state,params,dt);
  if (dt === 0) return { nextState: state, events: [] };

  const eta = params.testChargeRatio;
  const res = integrateAdaptiveRK45(
    [state.px, state.py, state.vx, state.vy],
    state.t,
    dt,
    (_t, y) => {
      const { Ex, Ey } = getFieldAt(y[0]!, y[1]!, params);
      return [y[2]!, y[3]!, eta * Ex, eta * Ey];
    },
    { absTol: 1e-10, relTol: 1e-9 }
  );

  const nx = res.state[0]!;
  const ny = res.state[1]!;
  const nvx = res.state[2]!;
  const nvy = res.state[3]!;
  const last = state.trail[state.trail.length - 1];
  const append = !last || Math.hypot(nx - last.x, ny - last.y) > 0.03;
  const trail = append ? [...state.trail.slice(-300), { x: nx, y: ny }] : state.trail;

  const events: PhysicsEvent[] = [];

  return {
    nextState: {
      ...state,
      t: state.t + dt,
      px: nx,
      py: ny,
      vx: nvx,
      vy: nvy,
      trail,
      events: events.length > 0 ? [...state.events, ...events] : state.events
    },
    events
  };
}

export function computeObservables(
  state: ElectrostaticState,
  params: ElectrostaticParams
): Record<string, number> {
  const tube=params.mode==='deflection-tube';
  const inside=state.tubePhase==='inside'||state.tubePhase==='hit';
  const field=tube?{phi:inside?-params.uDeflectV*state.py/2:0,Ex:0,Ey:inside?params.uDeflectV/2:0}:getFieldAt(state.px,state.py,params);
  const {phi,Ex,Ey}=field;
  const construction=params.mode==='uniform-three-point'?solveThreePointUniformField(params).construction:null;
  const ek = 0.5 * (state.vx * state.vx + state.vy * state.vy);
  const ep = params.testChargeRatio * phi;
  return {
    t: state.t,
    px: state.px,
    py: state.py,
    vx:state.vx,vy:state.vy,
    Ex,
    Ey,
    eMag: Math.hypot(Ex, Ey),
    phi,
    ek,
    ...(params.mode==='uniform-three-point'?{constructionDefined:construction?1:0,...(construction?{constructionStartX:construction.start.x,constructionStartY:construction.start.y,constructionEndX:construction.end.x,constructionEndY:construction.end.y,constructionFraction:construction.fraction,constructionPhi:construction.start.phi}:{})}:{}),
    ...(tube?{tubeWork:state.tubeWork,energyResidual:Math.abs(ek-state.tubeWork-state.initialEnergy),tubePhase:state.tubePhase==='approach'?0:state.tubePhase==='inside'?1:state.tubePhase==='exit'?2:3,terminal:state.tubePhase==='hit'?1:0,...(state.events.find(e=>e.id.startsWith('exit-plate'))?{yExit:state.events.find(e=>e.id.startsWith('exit-plate'))!.position!.y}:{})}:{totalEnergy:ek+ep,energyResidual:Math.abs(ek+ep-state.initialEnergy)})
  };
}

export function checkInvariants(
  state: ElectrostaticState,
  _initial: ElectrostaticState,
  params: ElectrostaticParams
): InvariantReport[] {
  const obs = computeObservables(state, params);
  const conservative=params.mode!=='deflection-tube';
  const err=conservative?(Math.abs(state.initialEnergy)>1e-9?obs.energyResidual!/Math.abs(state.initialEnergy):obs.energyResidual!):obs.energyResidual!/Math.max(1e-9,Math.abs(state.initialEnergy));
  return [{name:conservative?'静电场总能量守恒':'偏转区电场功—动能平衡',measuredError:err,tolerance:1e-5,
    passed:Object.values(obs).every(Number.isFinite)&&err<1e-5}];
}
