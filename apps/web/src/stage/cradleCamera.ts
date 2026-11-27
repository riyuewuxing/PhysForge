import type { Viewport } from '@physforge/sim-sdk';
import { getPixelsPerMeter, worldToScreen } from './ViewportController.js';

export interface CradleSafeRect { left:number; right:number; top:number; bottom:number }
export interface CradleBody { x:number; y:number; halfW:number; halfH:number; dynamic:boolean }
interface Bounds { minX:number; maxX:number; minY:number; maxY:number }

function dynamicBounds(bodies:readonly CradleBody[]):Bounds|null {
  const dynamic=bodies.filter(b=>b.dynamic);
  if(!dynamic.length||dynamic.some(b=>![b.x,b.y,b.halfW,b.halfH].every(Number.isFinite)))return null;
  return {
    minX:Math.min(...dynamic.map(b=>b.x-b.halfW)),
    maxX:Math.max(...dynamic.map(b=>b.x+b.halfW)),
    minY:Math.min(...dynamic.map(b=>b.y-b.halfH)),
    maxY:Math.max(...dynamic.map(b=>b.y+b.halfH))
  };
}

/** Reserve room for four measured velocity labels above the dynamic balls,
 * not the static guide extending across the stage. Screen units are CSS px. */
function bodySafeRect(safe:CradleSafeRect,labelHalfWidth:number):CradleSafeRect{
  const horizontal=Math.max(12,labelHalfWidth+8);
  return {left:safe.left+horizontal,right:safe.right-horizontal,top:safe.top+100,bottom:safe.bottom-18};
}

export function cradleBodiesFit(bodies:readonly CradleBody[],vp:Viewport,safe:CradleSafeRect,labelHalfWidth:number):boolean{
  const b=dynamicBounds(bodies);if(!b)return false;
  const r=bodySafeRect(safe,labelHalfWidth);
  const a=worldToScreen(b.minX,b.maxY,vp),z=worldToScreen(b.maxX,b.minY,vp);
  return a.x>=r.left&&z.x<=r.right&&a.y>=r.top&&z.y<=r.bottom;
}

/** Recenter conservatively only when the caller's automatic view is out of
 * bounds. Never mutate the bodies; both axes retain the same world scale. */
export function fitCradleCamera(bodies:readonly CradleBody[],vp:Viewport,safe:CradleSafeRect,labelHalfWidth:number):Viewport|null{
  const b=dynamicBounds(bodies);if(!b)return null;
  const r=bodySafeRect(safe,labelHalfWidth);
  const w=r.right-r.left-32,h=r.bottom-r.top-24;
  const unit=getPixelsPerMeter({...vp,scale:1});
  if(!(w>40&&h>40&&unit>0))return null;
  const ppm=Math.min(.58*unit,w/Math.max(.01,b.maxX-b.minX),h/Math.max(.01,b.maxY-b.minY));
  if(!Number.isFinite(ppm)||ppm/unit<.1)return null;
  const origin=worldToScreen(0,0,{...vp,scale:1,offsetX:0,offsetY:0});
  return {...vp,scale:ppm/unit,
    offsetX:(r.left+r.right)/2-(b.minX+b.maxX)*ppm/2-origin.x,
    offsetY:(r.top+r.bottom)/2+(b.minY+b.maxY)*ppm/2-origin.y};
}
