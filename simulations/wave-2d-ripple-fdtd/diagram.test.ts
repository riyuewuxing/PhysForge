import {describe,it,expect} from 'vitest';
import {resolvePluginParams,type Viewport} from '@physforge/sim-sdk';
import {wave2dRippleFdtdPlugin} from './plugin.js';
import {createInitialState,stepWaveFdtd,DX,SPONGE_CELLS} from './engine.js';
import {gridX,gridY,screenProfilePoints,rippleScene,fitRippleViewport,rippleBoundsFit} from './diagram.js';
const p=(mode:string)=>resolvePluginParams(wave2dRippleFdtdPlugin.paramSchema,wave2dRippleFdtdPlugin.presets.find(x=>x.id===mode)!.params);
describe('W02 physical screen and mask mapping',()=>{
  it('uses actual aperture runs, physical screen and equal y coordinates for all measured rows',()=>{
    const q=p('fdtd-double-slit-fast'),i=createInitialState(q);
    expect(screenProfilePoints(i)).toEqual([]);
    const s=stepWaveFdtd(i,q,i.averageStartTime+.1).nextState,points=screenProfilePoints(s);
    expect(points.length).toBe(s.ny-2*SPONGE_CELLS);
    for(const [k,pt] of points.entries())expect(pt.y).toBe(gridY(k+SPONGE_CELLS));
    const marks=rippleScene(s,q),walls=marks.filter(m=>m.primitive.kind==='rect'&&m.primitive.hatch);
    expect(walls.length).toBe(3);
    for(const a of s.geometry.apertures)for(let j=a.firstJ;j<=a.lastJ;j++){
      expect(s.speedSnapshot[j*s.nx+s.wallI]).toBeGreaterThan(0);
      expect(walls.some(m=>m.primitive.kind==='rect'&&gridY(j)>=m.primitive.y&&gridY(j)<=m.primitive.y+m.primitive.height)).toBe(false);
    }
    const screen=marks.find(m=>m.tone==='screen'&&m.primitive.kind==='line')!.primitive;
    if(screen.kind==='line'){expect(screen.x1).toBe(gridX(s.screenI));expect(screen.x2).toBe(gridX(s.screenI));}
    expect((s.screenI-s.wallI)*DX).toBeCloseTo(5.5,12);
  },30000);
  it('uses only actual medium boundary in refraction and fits common physical geometry',()=>{
    const q=p('fdtd-refraction-snell'),s=createInitialState(q),marks=rippleScene(s,q);
    expect(marks.some(m=>m.primitive.kind==='rect'&&m.primitive.hatch)).toBe(false);
    const b=marks.find(m=>m.tone==='medium'&&m.primitive.kind==='polyline')!.primitive;
    if(b.kind==='polyline')for(let j=0;j<s.ny;j++){expect(b.points[2*j]!.x).toBe(gridX(s.geometry.boundaryI[j]!)-DX/2);expect(b.points[2*j]!.y).toBeCloseTo(gridY(j)+DX/2,12);}
    const v:Viewport={width:1440,height:900,dpr:1,scale:1,offsetX:0,offsetY:0},safe={left:30,right:1090,top:30,bottom:700};
    expect(rippleBoundsFit(fitRippleViewport(v,safe)!,safe)).toBe(true);
  });
});
