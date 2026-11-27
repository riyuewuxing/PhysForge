import type { InductionSafeRect } from './viewport.js';

export type InductionLabel={id:string;x:number;y:number;text:string;color:string;font?:string};
type Placed=InductionLabel&{box:InductionSafeRect};

export const inductionSegmentBox=(x1:number,y1:number,x2:number,y2:number,pad:number):InductionSafeRect=>({
  left:Math.min(x1,x2)-pad,right:Math.max(x1,x2)+pad,top:Math.min(y1,y2)-pad,bottom:Math.max(y1,y2)+pad
});
const overlap=(a:InductionSafeRect,b:InductionSafeRect)=>
  Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));

/** Local E04 screen-space placement, using actual projected conductors.
 * Keep label text and its preferred anchor; move only when occupied.
 * When a manual view leaves no free slot, retain the least-overlapping label. */
export function placeInductionLabels(labels:readonly InductionLabel[],obstacles:readonly InductionSafeRect[],safe:InductionSafeRect,measure:(text:string,font:string)=>number):Placed[]{
  const placed:Placed[]=[];
  const occupied=[...obstacles];
  for(const label of labels){
    const font=label.font??'600 13px system-ui, sans-serif';
    const hw=measure(label.text,font)/2+5,hh=Math.max(11,(Number(font.match(/([\d.]+)px/)?.[1])||13)/2+4);
    const minX=Math.min((safe.left+safe.right)/2,safe.left+hw),maxX=Math.max(minX,safe.right-hw);
    const minY=Math.min((safe.top+safe.bottom)/2,safe.top+hh),maxY=Math.max(minY,safe.bottom-hh);
    const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
    const bx=clamp(label.x,minX,maxX),by=clamp(label.y,minY,maxY);
    const box=(x:number,y:number)=>({left:x-hw,right:x+hw,top:y-hh,bottom:y+hh});
    let best={x:bx,y:by,box:box(bx,by)},score=Infinity;
    const consider=(x:number,y:number)=>{
      x=clamp(x,minX,maxX);y=clamp(y,minY,maxY);
      const b=box(x,y),area=occupied.reduce((sum,q)=>sum+overlap(b,q),0);
      const distance=(x-bx)**2+(y-by)**2;
      const rank=area*1e7+distance;
      if(rank<score){score=rank;best={x,y,box:b};}
    };
    consider(bx,by);
    if(score>0){
      // Boundary candidates find the nearest clear side of each conductor;
      // the bounded grid handles intersections with previously placed labels.
      for(const q of occupied){
        consider(q.left-hw-2,by);consider(q.right+hw+2,by);
        consider(bx,q.top-hh-2);consider(bx,q.bottom+hh+2);
      }
      for(let r=1;r<=9;r++){
        if(score<((r*16)**2))break;
        for(let j=-r;j<=r;j++){
          consider(bx+j*16,by-r*16);consider(bx+j*16,by+r*16);
          if(Math.abs(j)<r){consider(bx-r*16,by+j*16);consider(bx+r*16,by+j*16);}
        }
      }
    }
    occupied.push(best.box);placed.push({...label,font,...best});
  }
  return placed;
}

export function drawInductionLabels(ctx:CanvasRenderingContext2D,labels:readonly InductionLabel[],obstacles:readonly InductionSafeRect[],safe:InductionSafeRect):void{
  ctx.save();ctx.textAlign='center';ctx.textBaseline='middle';
  const placed=placeInductionLabels(labels,obstacles,safe,(text,font)=>{ctx.font=font;return ctx.measureText(text).width;});
  for(const label of placed){ctx.font=label.font!;ctx.fillStyle=label.color;ctx.fillText(label.text,label.x,label.y);}
  ctx.restore();
}
