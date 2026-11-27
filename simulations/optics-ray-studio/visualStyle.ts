import { opticalScene } from './sceneGeometry.js';
import { createInitialState, type OpticsParams } from './engine.js';

type Point = { x: number; y: number };
export const TIR_WINDOW = { halfWidth: 2.55, halfHeight: 2.42 };

/** The standalone canvas is already to the left of its inspector. Do not
 * reserve the floating workbench inspector a second time. Keep an isotropic
 * world-to-screen scale; no model coordinates or physical angles change. */
export function resolveOpticsSliceCamera(params: OpticsParams, width: number, height: number) {
  const w=Math.max(1,width),h=Math.max(1,height),base=Math.min(w,h)*.24;
  const isInterface=params.sceneMode==='tir-interface';
  const bounds=isInterface
    ? {minX:-TIR_WINDOW.halfWidth,maxX:TIR_WINDOW.halfWidth,minY:-TIR_WINDOW.halfHeight,maxY:TIR_WINDOW.halfHeight}
    : opticalScene(createInitialState(params),params).bounds;
  const scale=Math.max(.1,Math.min(1.3,(w-36)/((bounds.maxX-bounds.minX)*base),(h-(isInterface?84:70))/((bounds.maxY-bounds.minY)*base)));
  return {scale,offsetX:w*.05-(bounds.minX+bounds.maxX)*.5*base*scale,
    offsetY:isInterface?-.025*h:(bounds.minY+bounds.maxY)*.5*base*scale};
}

/** Perceptual compression for display, not linear radiometry. Zero power
 * has no drawable beam. Every visible width and alpha is monotonic in power. */
export function heroBeamStyle(power:number,scale:number,paper:boolean) {
  if(!Number.isFinite(power)||power<=1e-12||!Number.isFinite(scale)||scale<=0)return null;
  const strength=Math.sqrt(Math.min(1,power));
  return {outerWidth:(20+14*strength)*scale,outerAlpha:.025+.085*strength,
    middleWidth:(9+6*strength)*scale,middleAlpha:.05+.14*strength,
    coreWidth:(3.3+2*strength)*scale,coreAlpha:paper?.55+.45*strength:.30+.70*strength,
    highlightWidth:(.8+1.2*strength)*scale,highlightAlpha:.15+.54*strength};
}

/** A finite viewing window on two half spaces. Feathered decorative tint
 * never adds top/side refracting interfaces or clips the true optical rays. */
export function drawTirMediumWindow(ctx:CanvasRenderingContext2D,left:number,right:number,top:number,bottom:number,hit:Point,paper:boolean){
  if(![left,right,top,bottom,hit.x,hit.y].every(Number.isFinite)||right<=left||top>=hit.y||bottom<=hit.y)return;
  const w=right-left;
  ctx.save();
  const upper=ctx.createLinearGradient(0,top,0,hit.y);
  upper.addColorStop(0,paper?'rgba(56,189,248,.035)':'rgba(58,122,168,.025)');
  upper.addColorStop(.35,paper?'rgba(56,189,248,.08)':'rgba(68,135,184,.085)');
  upper.addColorStop(.77,paper?'rgba(56,189,248,.16)':'rgba(94,166,215,.23)');
  upper.addColorStop(1,paper?'rgba(56,189,248,.20)':'rgba(126,193,235,.32)');
  ctx.fillStyle=upper;ctx.fillRect(left,top,w,hit.y-top);
  // A soft local specular wash provides glass-like depth without extra walls.
  if(!paper){
    ctx.save();ctx.beginPath();ctx.rect(left,top,w,hit.y-top);ctx.clip();
    const wash=ctx.createRadialGradient(hit.x,hit.y,0,hit.x,hit.y,Math.max(w*.54,hit.y-top));
    wash.addColorStop(0,'rgba(106,174,216,.19)');
    wash.addColorStop(.48,'rgba(72,139,184,.07)');wash.addColorStop(1,'rgba(72,139,184,0)');
    ctx.fillStyle=wash;ctx.fillRect(left,top,w,hit.y-top);ctx.restore();
  }
  const lower=ctx.createLinearGradient(0,hit.y,0,bottom);
  lower.addColorStop(0,paper?'rgba(100,116,139,.07)':'rgba(112,138,167,.13)');
  lower.addColorStop(.24,paper?'rgba(100,116,139,.035)':'rgba(112,138,167,.045)');
  lower.addColorStop(1,'rgba(100,116,139,0)');
  ctx.fillStyle=lower;ctx.fillRect(left,hit.y,w,bottom-hit.y);
  // Only this horizontal line is the actual material interface.
  ctx.strokeStyle=paper?'#64748b':'rgba(143,212,250,.72)';ctx.lineWidth=1.5;
  if(!paper){ctx.shadowColor='#78c9ec';ctx.shadowBlur=9;}
  ctx.beginPath();ctx.moveTo(left,hit.y);ctx.lineTo(right,hit.y);ctx.stroke();
  if(!paper){
    ctx.shadowBlur=0;ctx.strokeStyle='rgba(206,236,255,.36)';ctx.lineWidth=.8;
    ctx.stroke();
  }
  ctx.restore();
}

/** Real ray centerline and direction, with a soft multiscale warm/cool halo.
 * The tip stays on the ray and the incidence arrow leaves the handle clear. */
export function drawTirHeroRay(ctx:CanvasRenderingContext2D,from:Point,to:Point,color:string,power:number,incident:boolean,transmitted:boolean,paper:boolean,scale:number){
  const dx=to.x-from.x,dy=to.y-from.y,len=Math.hypot(dx,dy),style=heroBeamStyle(power,scale,paper);
  if(!style||!Number.isFinite(len)||len<1e-6)return;
  const ux=dx/len,uy=dy/len;
  ctx.save();ctx.lineCap='round';ctx.strokeStyle=color;ctx.fillStyle=color;
  ctx.beginPath();ctx.moveTo(from.x,from.y);ctx.lineTo(to.x,to.y);
  if(!paper){
    ctx.globalAlpha=style.outerAlpha;ctx.lineWidth=style.outerWidth;ctx.shadowColor=color;ctx.shadowBlur=25*scale;ctx.stroke();
    ctx.shadowBlur=0;ctx.globalAlpha=style.middleAlpha;ctx.lineWidth=style.middleWidth;ctx.stroke();
  }
  ctx.globalAlpha=style.coreAlpha;ctx.lineWidth=style.coreWidth;ctx.stroke();
  if(!paper){
    ctx.strokeStyle=transmitted?'#e0fdff':'#fff6db';
    ctx.globalAlpha=style.highlightAlpha;ctx.lineWidth=style.highlightWidth;ctx.stroke();
  }
  const offset=incident?Math.min(15*scale,len*.2):0,tx=to.x-ux*offset,ty=to.y-uy*offset;
  const head=Math.min(16*scale,len*.22),half=head*.46;
  ctx.globalAlpha=style.coreAlpha;ctx.fillStyle=color;
  ctx.beginPath();ctx.moveTo(tx,ty);ctx.lineTo(tx-ux*head-uy*half,ty-uy*head+ux*half);ctx.lineTo(tx-ux*head+uy*half,ty-uy*head-ux*half);ctx.closePath();ctx.fill();ctx.restore();
}

export function drawTirHitRing(ctx:CanvasRenderingContext2D,p:Point,warm:string,paper:boolean,scale:number){
  ctx.save();
  if(!paper){
    const g=ctx.createRadialGradient(p.x,p.y,3*scale,p.x,p.y,27*scale);
    g.addColorStop(0,'rgba(255,221,151,.38)');g.addColorStop(.40,'rgba(255,205,125,.16)');g.addColorStop(1,'rgba(255,205,125,0)');
    ctx.fillStyle=g;ctx.fillRect(p.x-27*scale,p.y-27*scale,54*scale,54*scale);
  }
  ctx.strokeStyle=warm;ctx.lineWidth=2.5*scale;ctx.fillStyle=paper?'#fff':'#14191f';
  if(!paper){ctx.shadowColor=warm;ctx.shadowBlur=13*scale;}
  ctx.beginPath();ctx.arc(p.x,p.y,10*scale,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.shadowBlur=0;
  ctx.restore();
}
