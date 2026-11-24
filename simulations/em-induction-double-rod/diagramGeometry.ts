import { getEffectiveL2, type InductionParams, type InductionState } from './engine.js';

export interface RodDiagramPoint { readonly x:number; readonly y:number }
export interface RodDiagramSegment { readonly start:RodDiagramPoint; readonly end:RodDiagramPoint }
const point=(x:number,y:number):RodDiagramPoint=>({x,y});
const segment=(start:RodDiagramPoint,end:RodDiagramPoint):RodDiagramSegment=>({start,end});

/** Display-space origin shared by rods, handles, FBD and the orthographic 3D stage. */
export function rodDisplayX(state: Pick<InductionState,'x1'>,x:number):number {
  return x-(1.2+Math.max(0,state.x1-1.6));
}

/** Positive conventional current on rod 1 goes from y=-L1/2 to y=+L1/2.
 * The engine's battery-current reference is reversed relative to its motional-emf reference. */
export function inductionDiagramCurrent(state:Pick<InductionState,'current'|'qTotalIntegral'>,p:InductionParams) {
  const sign=p.rodMode==='single'&&p.circuitLoad==='battery'?-1:1;
  return {current:sign*state.current,charge:sign*state.qTotalIntegral};
}

function route(a:RodDiagramPoint,b:RodDiagramPoint,midX:number):RodDiagramSegment[] {
  if(Math.abs(a.y-b.y)<1e-10)return [segment(a,b)];
  const u=point(midX,a.y),v=point(midX,b.y);
  return [segment(a,u),segment(u,v),segment(v,b)];
}
function longest(segs:readonly RodDiagramSegment[]):RodDiagramSegment {
  return segs.reduce((best,next)=>Math.hypot(next.end.x-next.start.x,next.end.y-next.start.y)>
    Math.hypot(best.end.x-best.start.x,best.end.y-best.start.y)?next:best);
}

/** A moving classroom drawing window. For unequal widths, the connector is a schematic
 * stepped lead, not a physical claim that a real rod passes through a movable rail corner.
 * Rod lengths and relative rod positions are the actual engine parameters/state. */
export function inductionDiagramGeometry(state:Pick<InductionState,'x1'|'x2'>,p:InductionParams) {
  const x1=rodDisplayX(state,state.x1),double=p.rodMode==='double',l1=p.railWidth,l2=double?getEffectiveL2(p):l1;
  const x2=double?rodDisplayX(state,state.x2):Math.min(-2.05,x1-0.65);
  const minX=Math.min(-2.05,x1-0.3,x2),maxX=Math.max(2.15,x1+0.3,x2+0.3);
  const leftL=x1<=x2?l1:l2,rightL=x1<=x2?l2:l1,midX=(x1+x2)/2;
  const bottom1=point(x1,-l1/2),top1=point(x1,l1/2),bottom2=point(x2,-l2/2),top2=point(x2,l2/2);
  const rails=[...route(point(minX,-leftL/2),point(maxX,-rightL/2),midX),
    ...route(point(minX,leftL/2),point(maxX,rightL/2),midX)];
  const currentGuides=[segment(bottom1,top1),segment(top2,bottom2),
    longest(route(bottom2,bottom1,midX)),longest(route(top1,top2,midX))];
  return {x1,x2,l1,l2,double,minX,maxX,rod1:segment(bottom1,top1),rod2:segment(bottom2,top2),
    rails,currentGuides,schematicStep:double&&Math.abs(l1-l2)>1e-10};
}
