import { describe, expect, it } from 'vitest';
import { CLASSROOM_GRAVITY, degToRad } from '@physforge/physics-core';
import {
  computeObservables,
  createInitialState,
  stepProjectileCoupling,
  type ProjectileCouplingParams
} from './engine.js';

describe('M04 mech-projectile-coupling verification', () => {
  it('captures flat projectile impact time on incline within < 1e-7 s and stays within safety envelope', () => {
    const params: ProjectileCouplingParams = {
      mode: 'incline-flat',
      v0: 6.0,
      launchAngleDeg: 0,
      inclineDeg: 37,
      troughRadius: 2.5,
      dragCoeff: 0,
      mass: 1.0
    };
    const expectedFlyTime = (2 * params.v0 * Math.tan(degToRad(params.inclineDeg))) / CLASSROOM_GRAVITY;

    let state = createInitialState(params);
    for (let i = 0; i < 400; i++) {
      state = stepProjectileCoupling(state, params, 0.01).nextState;
      if (state.landed) break;
    }
    expect(state.landed).toBe(true);
    expect(Math.abs(state.impactTime! - expectedFlyTime)).toBeLessThan(1e-7);

    // Oblique projectile under quadratic drag vs safety envelope and strictly smaller kinetic energy
    const dragParams: ProjectileCouplingParams = {
      mode: 'safety-envelope',
      v0: 8.0,
      launchAngleDeg: 55,
      inclineDeg: 30,
      troughRadius: 2.0,
      dragCoeff: 0.1,
      mass: 1.0
    };
    let dState = createInitialState(dragParams);
    for (let i = 0; i < 300; i++) {
      dState = stepProjectileCoupling(dState, dragParams, 0.01).nextState;
      const envY =
        (dragParams.v0 * dragParams.v0) / (2 * CLASSROOM_GRAVITY) -
        (CLASSROOM_GRAVITY * dState.x * dState.x) / (2 * dragParams.v0 * dragParams.v0);
      expect(dState.y).toBeLessThanOrEqual(envY + 1e-7);
      if (dState.landed) break;
    }
    const obs = computeObservables(dState, dragParams);
    expect(obs.kineticEnergy!).toBeLessThan(dState.initialEnergy);
  });
});

describe('H20 M04 independent impact and terminal semantics',()=>{
  const p:ProjectileCouplingParams={mode:'incline-flat',v0:6,launchAngleDeg:0,inclineDeg:37,troughRadius:2.5,dragCoeff:0,mass:1};
  it('captures the nonzero return to the incline even inside the very first coarse step',()=>{
    const T=12*Math.tan(37*Math.PI/180)/9.8;
    const hit=stepProjectileCoupling(createInitialState(p),p,2*T);
    expect(hit.nextState.landed).toBe(true);
    expect(hit.events).toHaveLength(1);
    expect(hit.halt).toBe(true);
    expect(Math.abs(hit.nextState.t-T)).toBeLessThan(1e-7);
    expect(Math.abs(hit.nextState.x-6*T)).toBeLessThan(1e-6);
    expect(Math.abs(hit.nextState.y+6*T*Math.tan(37*Math.PI/180))).toBeLessThan(1e-6);
    expect(Math.abs((hit.advancedTime??2*T)-T)).toBeLessThan(1e-7);
  });
  it('reports actual advanced time at impact and does not re-advance or emit duplicate impact events',()=>{
    let state=createInitialState(p);
    for(let i=0;i<100;i++){
      const before=state.t,r=stepProjectileCoupling(state,p,.05);state=r.nextState;
      if(state.landed){
        expect(r.halt).toBe(true);
        expect(r.advancedTime).toBeCloseTo(state.t-before,12);
        const again=stepProjectileCoupling(state,p,1);
        expect(again.nextState).toBe(state);
        expect(again.events).toHaveLength(0);
        expect(again.advancedTime).toBe(0);
        expect(again.halt).toBe(true);return;
      }
    }
    throw Error('missed incline event');
  });
  it('treats horizontal launch from the safety-envelope ground as zero-duration contact',()=>{
    const q={...p,mode:'safety-envelope' as const,launchAngleDeg:0};
    const r=stepProjectileCoupling(createInitialState(q),q,.1);
    expect(r.halt).toBe(true);
    expect(r.nextState.landed).toBe(true);
    expect(r.nextState.impactTime).toBe(0);
    expect(r.advancedTime).toBe(0);
    expect(r.events).toHaveLength(1);
  });
  it('never collides with the nonexistent upper semicircle',()=>{
    const q={...p,mode:'semicircle-trough' as const,troughRadius:1,v0:8,launchAngleDeg:60};
    let s=createInitialState(q);
    for(let i=0;i<40;i++)s=stepProjectileCoupling(s,q,.01).nextState;
    expect(s.landed).toBe(false);
    expect(s.events).toHaveLength(0);
    expect(s.t).toBeCloseTo(.4,10);
    expect(s.x).toBeCloseTo(1.6,10);
    expect(s.y).toBeCloseTo(8*Math.sin(Math.PI/3)*.4-.5*9.8*.4**2,10);
  });
  it('captures the physical lower arc in one coarse step, against an independent analytic root',()=>{
    const q={...p,mode:'semicircle-trough' as const,v0:4,launchAngleDeg:0,troughRadius:2.5};
    // Substitute x=4t, y=-gt²/2 into (x-R)²+y²=R²,
    // then divide out the launch root t=0.
    const f=(t:number)=>16*t+9.8**2*t**3/4-20;
    let lo=0,hi=2;
    for(let i=0;i<70;i++){const mid=(lo+hi)/2;if(f(mid)<0)lo=mid;else hi=mid;}
    const T=(lo+hi)/2,r=stepProjectileCoupling(createInitialState(q),q,2);
    expect(r.nextState.landed).toBe(true);expect(r.halt).toBe(true);
    expect(Math.abs(r.nextState.t-T)).toBeLessThan(1e-7);
    expect(r.nextState.y).toBeLessThan(0);
    expect(Math.abs((r.nextState.x-2.5)**2+r.nextState.y**2-2.5**2)).toBeLessThan(1e-6);
  });
});

it('terminates above the right rim as escape, never as a fictitious collision',()=>{
  const p:ProjectileCouplingParams={mode:'semicircle-trough',v0:8,launchAngleDeg:60,inclineDeg:30,troughRadius:1,dragCoeff:0,mass:1};
  const r=stepProjectileCoupling(createInitialState(p),p,2),s=r.nextState;
  expect(r.halt).toBe(true);expect(s.landed).toBe(false);expect(s.impactTime).toBeNull();expect(s.termination).toBe('escaped');
  expect(Math.abs(s.t-.5)).toBeLessThan(1e-7);expect(s.y).toBeGreaterThan(0);
  expect(r.events[0]!.id).toBe('m04-escaped');
  expect(stepProjectileCoupling(s,p,1).advancedTime).toBe(0);
});
it('preserves exact flight and impact under different outer step sizes, with or without drag',()=>{
  for(const mode of ['incline-flat','semicircle-trough','safety-envelope'] as const)for(const dragCoeff of [0,.08,.3]){
    const p:ProjectileCouplingParams={mode,v0:6,launchAngleDeg:mode==='semicircle-trough'?0:35,inclineDeg:30,troughRadius:2.5,dragCoeff,mass:1};
    const a=stepProjectileCoupling(createInitialState(p),p,20).nextState;
    let b=createInitialState(p);
    for(let i=0;i<2000&&!b.termination;i++)b=stepProjectileCoupling(b,p,1/240).nextState;
    expect(a.termination).toBeTruthy();expect(b.termination).toBe(a.termination);
    expect(Math.abs(a.t-b.t)).toBeLessThan(1e-7);
    expect(Math.hypot(a.x-b.x,a.y-b.y)).toBeLessThan(1e-6);
    expect(Math.hypot(a.vx-b.vx,a.vy-b.vy)).toBeLessThan(1e-6);
  }
});

import { mechProjectileCouplingPlugin } from './plugin.js';
describe('H21 independent classroom geometry and print contracts',()=>{
  const p:ProjectileCouplingParams={mode:'incline-flat',v0:6,launchAngleDeg:0,inclineDeg:37,troughRadius:2.5,dragCoeff:0,mass:1};
  const model=mechProjectileCouplingPlugin;
  it('exports the actual lower semicircle instead of a fictitious horizontal floor',()=>{
    const q={...p,mode:'semicircle-trough' as const,launchAngleDeg:0};
    const ir=model.exportDiagramIR!(createInitialState(q),q);
    const arc=ir.primitives.find(d=>d.kind==='arc'&&d.cx===2.5&&d.cy===0&&d.r===2.5);
    expect(arc).toMatchObject({startAngle:Math.PI,endAngle:2*Math.PI});
    expect(ir.primitives.some(d=>d.kind==='hatchedGround')).toBe(false);
  });
  it('constructs the vacuum tangent intercept at the midpoint and the true farthest-point perpendicular',()=>{
    const t=6*Math.tan(37*Math.PI/180)/9.8,s=stepProjectileCoupling(createInitialState(p),p,t).nextState;
    const ir=model.exportDiagramIR!(s,p),mid={x:s.x/2,y:0};
    const tangent=ir.primitives.find(d=>d.kind==='line'&&d.dashed&&Math.abs(d.x1-mid.x)<1e-8&&Math.abs(d.y1)<1e-8&&Math.abs(d.x2-s.x)<1e-8&&Math.abs(d.y2-s.y)<1e-8);
    expect(tangent).toBeDefined();
    const th=37*Math.PI/180,n={x:Math.sin(th),y:Math.cos(th)},distance=s.x*n.x+s.y*n.y;
    const foot={x:s.x-distance*n.x,y:s.y-distance*n.y};
    expect(ir.primitives.some(d=>d.kind==='line'&&d.dashed&&Math.abs(d.x1-s.x)<1e-8&&Math.abs(d.y1-s.y)<1e-8&&Math.abs(d.x2-foot.x)<1e-8&&Math.abs(d.y2-foot.y)<1e-8)).toBe(true);
    expect(s.vx*n.x+s.vy*n.y).toBeCloseTo(0,10);
  });
  it('draws the analytical safety envelope and correct initial launch direction in print',()=>{
    const q={...p,mode:'safety-envelope' as const,launchAngleDeg:55,v0:8};
    const ir=model.exportDiagramIR!(createInitialState(q),q),envelope=ir.primitives.find(d=>d.kind==='polyline'&&d.dashed);
    expect(envelope?.kind).toBe('polyline');
    if(envelope?.kind!=='polyline')throw Error('missing envelope');
    expect(envelope.points.length).toBeGreaterThan(20);
    for(const pt of envelope.points)expect(pt.y).toBeCloseTo(64/19.6-9.8*pt.x**2/128,10);
    const v=ir.primitives.find(d=>d.kind==='arrow'&&d.label==='v₀');
    expect(v?.kind).toBe('arrow');
    if(v?.kind!=='arrow')throw Error('missing v0');
    expect(Math.atan2(v.y2-v.y1,v.x2-v.x1)).toBeCloseTo(55*Math.PI/180,10);
  });
  it('does not present the vacuum midpoint property under drag and includes the actual terminal geometry',()=>{
    const q={...p,dragCoeff:.1};
    const s=stepProjectileCoupling(createInitialState(q),q,10).nextState;
    const ir=model.exportDiagramIR!(s,q);
    expect(s.landed).toBe(true);
    expect(ir.primitives.some(d=>d.kind==='text'&&d.text.includes('撞击'))).toBe(true);
    expect(ir.primitives.some(d=>d.kind==='text'&&d.text.includes('中点'))).toBe(false);
    expect(ir.viewBox.minX).toBeLessThan(s.x);expect(ir.viewBox.maxX).toBeGreaterThan(s.x);
    expect(ir.viewBox.minY).toBeLessThan(s.y);expect(ir.viewBox.maxY).toBeGreaterThan(s.y);
  });
});

import { projectileDiagram,projectileBounds,fitProjectileViewport,projectileBoundsFit,vacuumFarthest } from './diagram.js';
it('fits physical domains at extremes and exports exactly the shared geometry',()=>{
  for(const mode of ['incline-flat','semicircle-trough','safety-envelope'] as const)for(const v0 of [1,6,14])for(const inclineDeg of [15,60])for(const launchAngleDeg of [0,85]){
    const p:ProjectileCouplingParams={mode,v0,inclineDeg,launchAngleDeg,troughRadius:5,mass:.5,dragCoeff:.3};
    const s=stepProjectileCoupling(createInitialState(p),p,10).nextState;
    const d=projectileDiagram(s,p),ir=mechProjectileCouplingPlugin.exportDiagramIR!(s,p);
    expect(ir.primitives).toEqual(d.items.map(x=>x.primitive));
    const b=projectileBounds(p,s);expect(b.maxX).toBeGreaterThan(s.x);expect(b.minY).toBeLessThan(s.y);expect(b.maxY).toBeGreaterThan(s.y);
    for(const [width,height,right,bottom] of [[1392,852,1090,680],[900,600,600,430],[600,420,570,380]] as const){
      const safe={left:30,right,top:28,bottom},v=fitProjectileViewport(p,s,{width,height,dpr:1,scale:1,offsetX:0,offsetY:0},safe)!;
      expect(projectileBoundsFit(p,s,v,safe)).toBe(true);
    }
  }
});
it('uses the signed normal distance and true perpendicular at the vacuum maximum',()=>{
  for(const inclineDeg of [15,37,60])for(const v0 of [1,14]){
    const p:ProjectileCouplingParams={mode:'incline-flat',v0,inclineDeg,launchAngleDeg:0,troughRadius:2,mass:1,dragCoeff:0};
    const f=vacuumFarthest(p)!,th=degToRad(inclineDeg),d=v0*v0*Math.sin(th)**2/(2*9.8*Math.cos(th));
    expect(f.distance).toBeCloseTo(d,10);
    expect(f.foot.y+f.foot.x*Math.tan(th)).toBeCloseTo(0,10);
    expect(Math.hypot(f.point.x-f.foot.x,f.point.y-f.foot.y)).toBeCloseTo(d,10);
    expect(vacuumFarthest({...p,dragCoeff:.1})).toBeNull();
  }
});

it('anchors the editable initial speed handle to the actual initial arrow, not a fictitious screen point',()=>{
  for(const mode of ['incline-flat','semicircle-trough','safety-envelope'] as const){
    const p:ProjectileCouplingParams={mode,v0:6,launchAngleDeg:55,inclineDeg:37,troughRadius:2.5,dragCoeff:0,mass:1};
    const s=createInitialState(p),h=mechProjectileCouplingPlugin.getControlHandles!(s,p)[0]!;
    const arrow=projectileDiagram(s,p).items.map(x=>x.primitive).find(d=>d.kind==='arrow'&&d.label==='v₀');
    if(arrow?.kind!=='arrow')throw Error('missing launch arrow');
    expect(h.position.x).toBeCloseTo(arrow.x2,12);expect(h.position.y).toBeCloseTo(arrow.y2,12);
    expect(h.onDrag(h.position).v0).toBe(p.v0);
    expect(mechProjectileCouplingPlugin.getControlHandles!(stepProjectileCoupling(s,p,.01).nextState,p)).toHaveLength(0);
  }
});
