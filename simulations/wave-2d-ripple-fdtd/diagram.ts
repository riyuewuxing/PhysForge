import {createWorldMapper,resolveAndDrawLabels,type CanvasLabel,type DiagramPrimitive,type DiagramIR,type Viewport} from '@physforge/sim-sdk';
import {extractIsolines} from '@physforge/physics-core';
import {DX,WALL_I,SCREEN_I,SOURCE_I,CENTER_J,GRID_NX,GRID_NY,SPONGE_CELLS,type WaveFdtdParams,type WaveFdtdState} from './engine.js';
export const gridX=(i:number)=>(i-WALL_I)*DX;
export const gridY=(j:number)=>(CENTER_J-j)*DX;
const tank={minX:gridX(0)-DX/2,maxX:gridX(GRID_NX-1)+DX/2,minY:gridY(GRID_NY-1)-DX/2,maxY:gridY(0)+DX/2};
const profile={minX:tank.maxX+.38,maxX:tank.maxX+2.45,minY:tank.minY,maxY:tank.maxY};
export function rippleDiagramBounds(){return {minX:tank.minX-.52,maxX:profile.maxX+.35,minY:tank.minY-.7,maxY:tank.maxY+.88};}
type Tone='ink'|'axis'|'wall'|'sponge'|'source'|'screen'|'profile'|'medium'|'muted';
type Mark={primitive:DiagramPrimitive;tone:Tone};
const allLayers=new Set(['waveField','screenProfile']);
export function screenProfilePoints(s:WaveFdtdState){
  if(s.screenAverageSamples===0||!s.allFinite||!s.geometry.valid)return [];
  let max=0;for(let j=SPONGE_CELLS;j<GRID_NY-SPONGE_CELLS;j++)max=Math.max(max,s.screenIntensity[j]!);
  return Array.from({length:GRID_NY-2*SPONGE_CELLS},(_,k)=>{const j=k+SPONGE_CELLS;return {x:profile.minX+(max>0?s.screenIntensity[j]!/max:0)*(profile.maxX-profile.minX),y:gridY(j)};});
}
export function rippleScene(s:WaveFdtdState,p:WaveFdtdParams,layers:ReadonlySet<string>=allLayers):Mark[]{
  const out:Mark[]=[],g=s.geometry,add=(primitive:DiagramPrimitive,tone:Tone)=>out.push({primitive,tone}),
  line=(x1:number,y1:number,x2:number,y2:number,tone:Tone,dashed=false)=>add({kind:'line',x1,y1,x2,y2,dashed},tone),
  text=(x:number,y:number,text:string,tone:Tone='ink')=>add({kind:'text',x,y,text,align:'middle'},tone),
  rect=(x:number,y:number,width:number,height:number,tone:Tone,dashed=false,hatch=false)=>add({kind:'rect',x,y,width,height,dashed,hatch},tone),
  poly=(points:{x:number;y:number}[],tone:Tone)=>{if(points.length>1)add({kind:'polyline',points},tone);};
  rect(tank.minX,tank.minY,tank.maxX-tank.minX,tank.maxY-tank.minY,'axis');
  rect(gridX(SPONGE_CELLS)-DX/2,gridY(GRID_NY-SPONGE_CELLS-1)-DX/2,(GRID_NX-2*SPONGE_CELLS)*DX,(GRID_NY-2*SPONGE_CELLS)*DX,'sponge',true);
  text((tank.minX+tank.maxX)/2,tank.maxY+.62,'二维波动池 · '+(p.mode==='double-slit'?'双缝干涉':p.mode==='single-slit'?'单缝衍射':p.mode==='obstacle-diffraction'?'障碍绕射':'斜界面折射'));
  text((tank.minX+tank.maxX)/2,tank.maxY+.31,'200 × 150 网格 · Δx=0.05 m · 场时刻 '+s.fieldTime.toFixed(3)+' s','muted');
  if(!g.valid){text((tank.minX+tank.maxX)/2,.45,'无有效双缝请求：缝宽必须小于中心间距','source');text((tank.minX+tank.maxX)/2,0,'请调整缝宽或间距；未启动求解','muted');}
  else{
    for(const r of g.blockedRuns)rect(gridX(WALL_I-1)-DX/2,gridY(r.lastJ)-DX/2,3*DX,(r.lastJ-r.firstJ+1)*DX,'wall',false,true);
    if(p.mode==='refraction-prism'){
      const points:{x:number;y:number}[]=[];
      for(let j=0;j<GRID_NY;j++){
        const x=gridX(g.boundaryI[j]!)-DX/2;points.push({x,y:gridY(j)+DX/2},{x,y:gridY(j)-DX/2});
      }
      poly(points,'medium');
      text(-1.75,2.55,'介质 1 · c₀','medium');text(2.15,2.55,'介质 2 · c₀/n','medium');
    }
    line(gridX(SOURCE_I),gridY(g.sourceFirstJ),gridX(SOURCE_I),gridY(g.sourceLastJ),'source');
    text(gridX(SOURCE_I),tank.maxY-.27,'驱动线','source');
    for(const [i,a] of g.apertures.entries())text(gridX(WALL_I)+.43,gridY(a.centerJ),'S'+(i+1),'source');
    if(g.apertures.length===2){
      const a=g.apertures[0]!,b=g.apertures[1]!,x=gridX(WALL_I)-.5,ya=gridY(a.centerJ),yb=gridY(b.centerJ);
      line(x,ya,x,yb,'source');line(x-.13,ya,x+.13,ya,'source');line(x-.13,yb,x+.13,yb,'source');
      text(x-.55,(ya+yb)/2,'d='+ (g.separationCells*DX).toFixed(2)+' m','source');
    }
  }
  line(gridX(SCREEN_I),tank.minY,gridX(SCREEN_I),tank.maxY,'screen',true);
  text(gridX(SCREEN_I),tank.maxY-.27,'接收屏','screen');
  line(gridX(WALL_I),tank.minY-.15,gridX(SCREEN_I),tank.minY-.15,'axis');
  line(gridX(WALL_I),tank.minY-.24,gridX(WALL_I),tank.minY-.07,'axis');line(gridX(SCREEN_I),tank.minY-.24,gridX(SCREEN_I),tank.minY-.07,'axis');
  text((gridX(WALL_I)+gridX(SCREEN_I))/2,tank.minY-.39,'L=5.50 m','muted');
  text(tank.minX+.72,tank.minY-.39,'海绵层：虚框之外','muted');
  if(layers.has('screenProfile')){
    rect(profile.minX,profile.minY,profile.maxX-profile.minX,profile.maxY-profile.minY,'axis');
    text((profile.minX+profile.maxX)/2,profile.maxY+.57,'屏幕均方位移 ⟨u²⟩','profile');
    const o=s.screenAverageSamples>0&&g.valid&&s.allFinite;
    if(o){
      const points=screenProfilePoints(s);poly(points,'profile');
      let peak=0;for(let j=SPONGE_CELLS;j<GRID_NY-SPONGE_CELLS;j++)peak=Math.max(peak,s.screenIntensity[j]!);
      text((profile.minX+profile.maxX)/2,profile.maxY+.25,'峰值 '+peak.toExponential(2),'muted');
      text((profile.minX+profile.maxX)/2,profile.minY-.39,'横轴 0 → 峰值','muted');
    }else{
      text((profile.minX+profile.maxX)/2,.3,'尚未开始平均','muted');
      text((profile.minX+profile.maxX)/2,-.1,'等待 t ≥ '+s.averageStartTime.toFixed(2)+' s','muted');
    }
    for(let y=-3;y<=3;y++){line(profile.minX-.1,y,profile.minX,y,'axis');text(profile.minX-.24,y,String(y),'muted');}
    text(profile.minX-.24,profile.maxY+.1,'y/m','muted');
    // Both profile and physical screen use exactly the same world y.
    for(const y of [-2,0,2])line(gridX(SCREEN_I),y,profile.minX,y,'muted',true);
  }
  return out;
}
export function rippleExport(s:WaveFdtdState,p:WaveFdtdParams):DiagramIR{
  const marks=rippleScene(s,p),primitives=marks.map(m=>m.primitive);
  const contours:DiagramPrimitive[]=[];
  if(s.geometry.valid&&s.allFinite&&p.amplitude>0&&s.maxAmplitude>0){
    const levels=[-.7,-.35,.35,.7].map(v=>v*p.amplitude);
    for(const contour of extractIsolines(s.fieldSnapshot,GRID_NX,GRID_NY,{xMin:gridX(0),xMax:gridX(GRID_NX-1),yMin:0,yMax:(GRID_NY-1)*DX},levels))
      for(const seg of contour.segments)contours.push({kind:'line',x1:seg.a.x,y1:CENTER_J*DX-seg.a.y,x2:seg.b.x,y2:CENTER_J*DX-seg.b.y,dashed:contour.level<0});
  }
  return {width:1200,height:780,viewBox:rippleDiagramBounds(),title:'二维波动池 · '+p.mode,primitives:[...contours,...primitives],metadata:{mode:p.mode,fieldTime:String(s.fieldTime),notes:'实际网格几何、实际屏幕均方位移曲线及非零场快照等值线；正负等值线用实虚区分，不含伪彩栅格。'}};
}
type Safe={left:number;right:number;top:number;bottom:number};
export function fitRippleViewport(v:Viewport,safe:Safe):Viewport|null{
  const b=rippleDiagramBounds(),w=safe.right-safe.left,h=safe.bottom-safe.top;if(w<60||h<60)return null;
  const ppm=Math.min((w-24)/(b.maxX-b.minX),(h-20)/(b.maxY-b.minY));
  return {...v,scale:ppm/(.24*Math.min(v.width,v.height)),offsetX:(safe.left+safe.right)/2-v.width*.45-ppm*(b.minX+b.maxX)/2,offsetY:(safe.top+safe.bottom)/2-v.height*.5+ppm*(b.minY+b.maxY)/2};
}
export function rippleBoundsFit(v:Viewport,safe:Safe){const b=rippleDiagramBounds(),m=createWorldMapper(v),a=m.toScreen(b.minX,b.maxY),z=m.toScreen(b.maxX,b.minY);return a.x>=safe.left-1&&a.y>=safe.top-1&&z.x<=safe.right+1&&z.y<=safe.bottom+1;}
type Raster={canvas:HTMLCanvasElement;image:ImageData;last?:Float32Array;speed?:Float32Array;key?:string;};
const rasterCache=new WeakMap<object,Raster>();
export function rippleColor(u:number,scale:number,paper:boolean):[number,number,number]{
  const q=Math.max(-1,Math.min(1,u/scale)),a=Math.abs(q),base=paper?[242,246,250]:[10,27,43],end=q>=0?(paper?[0,100,146]:[76,220,247]):(paper?[171,29,87]:[247,95,155]);
  return [Math.round(base[0]!+(end[0]!-base[0]!)*a),Math.round(base[1]!+(end[1]!-base[1]!)*a),Math.round(base[2]!+(end[2]!-base[2]!)*a)];
}
export function renderRipple(ctx:CanvasRenderingContext2D,s:WaveFdtdState,p:WaveFdtdParams,v:Viewport,layers:ReadonlySet<string>){
  const m=createWorldMapper(v),paper=v.theme==='projector',scale=Math.max(.01,2*p.amplitude),colors:Record<Tone,string>=paper?{ink:'#0f172a',axis:'#64748b',wall:'#475569',sponge:'#94a3b8',source:'#a16207',screen:'#0369a1',profile:'#a16207',medium:'#047857',muted:'#475569'}:{ink:'#e2e8f0',axis:'#52677f',wall:'#94a3b8',sponge:'#658198',source:'#fbbf24',screen:'#67e8f9',profile:'#fbbf24',medium:'#86efac',muted:'#a6b9cc'};
  ctx.save();
  if(layers.has('waveField')&&s.geometry.valid&&s.allFinite){
    const a=m.toScreen(tank.minX,tank.maxY),w=m.len(tank.maxX-tank.minX),h=m.len(tank.maxY-tank.minY);
    if(typeof document!=='undefined'&&typeof ctx.drawImage==='function'){
      let r=rasterCache.get(ctx);if(!r){const canvas=document.createElement('canvas');canvas.width=GRID_NX;canvas.height=GRID_NY;const rc=canvas.getContext('2d')!;r={canvas,image:rc.createImageData(GRID_NX,GRID_NY)};rasterCache.set(ctx,r);}
      const key=paper+':'+scale;
      if(r.last!==s.fieldSnapshot||r.speed!==s.speedSnapshot||r.key!==key){
        const palette=Array.from({length:257},(_,i)=>rippleColor((i-128)*scale/128,scale,paper));
        const b=r.image.data;
        for(let k=0;k<s.fieldSnapshot.length;k++){const rgb=s.speedSnapshot[k]===0?(paper?[71,85,105]:[119,135,151]):palette[Math.max(0,Math.min(256,Math.round(128*s.fieldSnapshot[k]!/scale)+128))]!;b[4*k]=rgb[0]!;b[4*k+1]=rgb[1]!;b[4*k+2]=rgb[2]!;b[4*k+3]=255;}
        r.canvas.getContext('2d')!.putImageData(r.image,0,0);r.last=s.fieldSnapshot;r.speed=s.speedSnapshot;r.key=key;
      }
      ctx.imageSmoothingEnabled=true;ctx.drawImage(r.canvas,a.x,a.y,w,h);
    }else{
      // Headless drawing spies: still use physical world mapping, not a mock crop.
      for(let j=0;j<GRID_NY;j+=3)for(let i=0;i<GRID_NX;i+=3){
        const k=j*GRID_NX+i,rgb=rippleColor(s.fieldSnapshot[k]!,scale,paper),q=m.toScreen(gridX(i)-DX/2,gridY(j)+DX/2);
        ctx.fillStyle='rgb('+rgb.join(',')+')';ctx.fillRect(q.x,q.y,m.len(Math.min(3,GRID_NX-i)*DX),m.len(Math.min(3,GRID_NY-j)*DX));
      }
    }
  }
  const labels:CanvasLabel[]=[];
  for(const [i,{primitive:q,tone}] of rippleScene(s,p,layers).entries()){
    const color=colors[tone];ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=tone==='source'||tone==='profile'?2.2:tone==='wall'?1.3:1;ctx.globalAlpha=tone==='muted'?.7:1;
    if(q.kind==='text'){const a=m.toScreen(q.x,q.y);labels.push({id:'w02-'+i,x:a.x,y:a.y,text:q.text,color,font:tone==='ink'?'bold 13px system-ui':'11px system-ui'});}
    else if(q.kind==='rect'){const a=m.toScreen(q.x,q.y+q.height);ctx.setLineDash(q.dashed?[5,5]:[]);if(q.hatch)ctx.fillRect(a.x,a.y,m.len(q.width),m.len(q.height));ctx.strokeRect(a.x,a.y,m.len(q.width),m.len(q.height));ctx.setLineDash([]);}
    else if(q.kind==='line'){const a=m.toScreen(q.x1,q.y1),b=m.toScreen(q.x2,q.y2);ctx.setLineDash(q.dashed?[5,4]:[]);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.setLineDash([]);}
    else if(q.kind==='polyline'){const a=m.toScreen(q.points[0]!.x,q.points[0]!.y);ctx.beginPath();ctx.moveTo(a.x,a.y);for(const pt of q.points.slice(1)){const b=m.toScreen(pt.x,pt.y);ctx.lineTo(b.x,b.y);}ctx.stroke();}
  }
  if(layers.has('waveField')&&s.geometry.valid){const y=tank.minY-.39,x=tank.maxX-2.55;for(let i=0;i<48;i++){const rgb=rippleColor((i/47*2-1)*scale,scale,paper),a=m.toScreen(x+i*.042,y+.08);ctx.fillStyle='rgb('+rgb.join(',')+')';ctx.fillRect(a.x,a.y,m.len(.043),m.len(.16));}const a=m.toScreen(x-.12,y),b=m.toScreen(x+2.2,y);labels.push({id:'negative',x:a.x,y:a.y,text:'−'+scale.toFixed(2),color:colors.muted,font:'11px system-ui'},{id:'positive',x:b.x,y:b.y,text:'+'+scale.toFixed(2),color:colors.muted,font:'11px system-ui'});}
  ctx.globalAlpha=1;resolveAndDrawLabels(ctx,labels,v.width,v.height);ctx.restore();
}
