import { drawGlowingConductorRod, drawMetallicRail } from '@physforge/sim-sdk';

export function inductionVisualPalette(projector: boolean) {
  return projector ? {
    field: '#64748b', fieldAlpha: .66,
    load: '#92400e', loadLabel: '#78350f',
    current: '#92400e', currentLabel: '#78350f',
    force: '#9f1239', velocity: '#075985', external: '#166534',
    rod: '#0369a1', rodCore: '#bae6fd', rod2: '#86198f', rod2Core: '#f5d0fe',
    rod2Label: '#86198f', note: '#475569'
  } : {
    field: '#94a3b8', fieldAlpha: .38,
    load: '#fbbf24', loadLabel: '#fcd34d',
    current: '#f59e0b', currentLabel: '#fbbf24',
    force: '#ff8177', velocity: '#67e8f9', external: '#4ade80',
    rod: '#38bdf8', rodCore: '#e0f2fe', rod2: '#f472b6', rod2Core: '#fbcfe8',
    rod2Label: '#f9a8d4', note: '#94a3b8'
  };
}

/** Signed screen length. Different physical quantities use independent
 * display scales; these arrows do not claim a common force/velocity scale. */
export function inductionArrowLength(value: number, pixelsPerUnit: number, cap: number): number {
  if (!Number.isFinite(value) || !(pixelsPerUnit > 0) || !(cap > 0)) return 0;
  return Math.sign(value) * Math.min(cap, Math.abs(value) * pixelsPerUnit);
}

/** Decorative wake, not a sampled position history. No wake at rest. */
export function inductionWakeExtent(velocity: number): number {
  if (!Number.isFinite(velocity) || Math.abs(velocity) <= .01) return 0;
  return -Math.sign(velocity) * Math.min(165, Math.abs(velocity) * 70);
}

/** Keep the actual connected metal fully visible. Only shade the free
 * overhangs outside the leftmost/rightmost electrical contacts. Never erase
 * the scene or use destination-in/destination-out compositing. */
export function drawInductionRail(
  ctx: CanvasRenderingContext2D, x1: number, y: number, x2: number,
  leftContact: number, rightContact: number, thickness: number, projector: boolean
): void {
  if (![x1,y,x2,leftContact,rightContact,thickness].every(Number.isFinite) || x2<=x1 || thickness<=0) return;
  drawMetallicRail(ctx,x1,y,x2,thickness);
  ctx.save();
  if(projector){
    ctx.strokeStyle='#64748b';ctx.lineWidth=1;
    ctx.strokeRect(x1+.5,y-thickness/2+.5,x2-x1-1,thickness-1);
  } else {
    const lo=Math.max(x1,Math.min(x2,leftContact)),hi=Math.max(lo,Math.min(x2,rightContact));
    const fade=(edge:number,inner:number)=>{
      if(Math.abs(edge-inner)<.5)return;
      const g=ctx.createLinearGradient(edge,0,inner,0);
      g.addColorStop(0,'rgba(12,17,23,.84)');g.addColorStop(.4,'rgba(12,17,23,.34)');
      g.addColorStop(1,'rgba(12,17,23,0)');
      ctx.fillStyle=g;ctx.fillRect(Math.min(edge,inner),y-thickness/2,Math.abs(edge-inner),thickness);
    };
    fade(x1,lo);fade(x2,hi);
  }
  ctx.restore();
}

/** A larger, soft direction-dependent wake and metallic core; the rod
 * endpoints remain exactly at the shared diagram geometry coordinates. */
export function drawInductionRod(
  ctx: CanvasRenderingContext2D,x:number,yTop:number,yBot:number,v:number,
  tint:string,core:string,width:number,projector:boolean
):void{
  if(![x,yTop,yBot,v,width].every(Number.isFinite)||yBot<=yTop||width<=0)return;
  const extent=inductionWakeExtent(v);
  const h=yBot-yTop;
  if(Math.abs(extent)>.5&&h>10){
    ctx.save();
    const edge=x+extent;
    const g=ctx.createLinearGradient(x,0,edge,0);
    g.addColorStop(0,tint+(projector?'26':'66'));
    g.addColorStop(.46,tint+(projector?'0e':'30'));
    g.addColorStop(1,tint+'00');
    ctx.fillStyle=g;
    ctx.fillRect(Math.min(edge,x),yTop+4,Math.abs(extent),h-8);
    // A second soft elliptical layer avoids the flat rectangular impression.
    ctx.translate(x,(yTop+yBot)/2);
    ctx.scale(extent,h*.46);
    const soft=ctx.createRadialGradient(0,0,0,0,0,1);
    soft.addColorStop(0,tint+(projector?'14':'38'));soft.addColorStop(1,tint+'00');
    ctx.fillStyle=soft;ctx.fillRect(0,-1,1,2);
    ctx.restore();
  }
  // The base primitive draws the exact conductor without a duplicate wake.
  drawGlowingConductorRod(ctx,x,yTop,yBot,0,tint,core,width);
}
