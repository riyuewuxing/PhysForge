import {createWorldMapper,resolveAndDrawLabels,drawGlowVectorArrow,type CanvasLabel,type DiagramPrimitive,type DiagramIR,type Viewport} from '@physforge/sim-sdk';
import {computeWaveSpeed,computeObservables,evaluateInterferenceAtPoint,evaluateStandingWave,evaluateTransverseWave,type WaveCouplingParams,type WaveCouplingState} from './engine.js';
type Point={x:number;y:number};
export type WaveBounds={minX:number;minY:number;maxX:number;maxY:number};
type Tone='axis'|'ink'|'muted'|'wave'|'ghost'|'probe'|'velocity'|'source'|'node'|'antinode'|'front';
export type WaveMark={primitive:DiagramPrimitive;tone:Tone;fill?:boolean};
const fieldBox:WaveBounds={minX:-3.7,maxX:3.7,minY:-2.45,maxY:2.45};
const dopplerBox:WaveBounds={minX:-4.4,maxX:4.4,minY:-2.6,maxY:2.6};
const point=(x:number,y:number):Point=>({x,y});
const allLayers=new Set(['waveform','slopeGhost','probeParticle','vibrationGraph','interferenceField','antinodeCurves','dopplerFronts']);
const lineMode=(p:WaveCouplingParams)=>p.mode==='transverse'||p.mode==='standing';
const extent=(p:WaveCouplingParams)=>Math.max(.45,(p.mode==='standing'?2:1)*p.amplitude);
export function waveDiagramBounds(p:WaveCouplingParams):WaveBounds{
  if(lineMode(p)){const a=extent(p);return {minX:-4.55,maxX:4.55,minY:-a-2.1,maxY:a+.95};}
  return p.mode==='interference'?{minX:-4.1,maxX:4.1,minY:-3.05,maxY:3.2}:{minX:-4.8,maxX:4.8,minY:-3.25,maxY:3.35};
}
const inside=(p:Point,b:WaveBounds)=>p.x>=b.minX-1e-10&&p.x<=b.maxX+1e-10&&p.y>=b.minY-1e-10&&p.y<=b.maxY+1e-10;
function clipSegment(a:Point,b:Point,box:WaveBounds):Point[]{
  const dx=b.x-a.x,dy=b.y-a.y,ps=[-dx,dx,-dy,dy],qs=[a.x-box.minX,box.maxX-a.x,a.y-box.minY,box.maxY-a.y];let lo=0,hi=1;
  for(let j=0;j<4;j++){const p=ps[j]!,q=qs[j]!;if(p===0){if(q<0)return [];continue;}const r=q/p;if(p<0)lo=Math.max(lo,r);else hi=Math.min(hi,r);if(lo>hi)return [];}
  return [point(a.x+lo*dx,a.y+lo*dy),point(a.x+hi*dx,a.y+hi*dy)];
}
/** Exact circle/boundary intersections; only drawing chords approximate the arc. */
export function wavefrontPrimitives(cx:number,cy:number,r:number,b:WaveBounds):DiagramPrimitive[]{
  if(!(r>1e-10))return [];
  if(cx-r>=b.minX&&cx+r<=b.maxX&&cy-r>=b.minY&&cy+r<=b.maxY)return [{kind:'circle',cx,cy,r}];
  const tau=2*Math.PI,normalize=(a:number)=>(a%tau+tau)%tau,angles=[0,tau];
  for(const x of [b.minX,b.maxX]){const q=(x-cx)/r;if(Math.abs(q)<=1){const a=Math.acos(q);angles.push(normalize(a),normalize(-a));}}
  for(const y of [b.minY,b.maxY]){const q=(y-cy)/r;if(Math.abs(q)<=1){const a=Math.asin(q);angles.push(normalize(a),normalize(Math.PI-a));}}
  angles.sort((x,y)=>x-y);const out:DiagramPrimitive[]=[];
  for(let j=1;j<angles.length;j++){
    const a=angles[j-1]!,d=angles[j]!-a,m=a+d/2;if(d<1e-10||!inside(point(cx+r*Math.cos(m),cy+r*Math.sin(m)),b))continue;
    const n=Math.max(2,Math.ceil(d*60/Math.PI)),pts=Array.from({length:n+1},(_,i)=>{const theta=a+d*i/n;return point(cx+r*Math.cos(theta),cy+r*Math.sin(theta));});out.push({kind:'polyline',points:pts});
  }
  return out;
}
/** Signed r2-r1 hyperbolae. Only the two-source overlap has a stable fringe. */
export function interferenceFringes(p:WaveCouplingParams,t:number):{node:boolean;delta:number;points:Point[]}[]{
  if(p.amplitude===0||p.frequency<=0||p.wavelength<=0)return [];
  const d=p.sourceSeparation,h=d/2,c=computeWaveSpeed(p),lambda=p.wavelength,phase=p.phaseDiffDeg/360,b=fieldBox;
  const out:{node:boolean;delta:number;points:Point[]}[]=[];
  const allowed=(q:Point)=>inside(q,b)&&(!p.causalFront||Math.max(Math.hypot(q.x+h,q.y),Math.hypot(q.x-h,q.y))<=c*t+1e-10);
  for(const node of [false,true]){
    const shift=phase+(node?.5:0),n0=Math.ceil(-d/lambda-shift-1e-10),n1=Math.floor(d/lambda-shift+1e-10);
    for(let n=n0;n<=n1;n++){
      const delta=(n+shift)*lambda,a=Math.abs(delta)/2;
      if(a>h+1e-10)continue;
      if(Math.abs(a-h)<1e-10){
        // Degenerate outer axial ray for |r2-r1|=d.
        const sign=-Math.sign(delta),limit=sign>0?b.maxX:-b.minX,end=p.causalFront?Math.min(limit,c*t-h):limit;
        if(end>h&&allowed(point(sign*h,0)))out.push({node,delta,points:[point(sign*h,0),point(sign*end,0)]});continue;
      }
      let pts:Point[]=[];
      for(let j=0;j<=160;j++){
        const y=b.minY+(b.maxY-b.minY)*j/160,x=a===0?0:-Math.sign(delta)*a*Math.sqrt(1+y*y/(h*h-a*a)),q=point(x,y);
        if(allowed(q))pts.push(q);else if(pts.length){if(pts.length>1)out.push({node,delta,points:pts});pts=[];}
      }
      if(pts.length>1)out.push({node,delta,points:pts});
    }
  }
  return out;
}
export function waveDiagramScene(s:WaveCouplingState,p:WaveCouplingParams,layers:ReadonlySet<string>=allLayers):WaveMark[]{
  const marks:WaveMark[]=[],add=(primitive:DiagramPrimitive,tone:Tone,fill=false)=>marks.push({primitive,tone,fill}),
    line=(a:Point,b:Point,tone:Tone,dashed=false)=>add({kind:'line',x1:a.x,y1:a.y,x2:b.x,y2:b.y,dashed},tone),
    arrow=(a:Point,b:Point,tone:Tone)=>{if(Math.hypot(a.x-b.x,a.y-b.y)>1e-8)add({kind:'arrow',x1:a.x,y1:a.y,x2:b.x,y2:b.y},tone);},
    circle=(q:Point,r:number,tone:Tone,fill=false)=>add({kind:'circle',cx:q.x,cy:q.y,r,fill},tone,fill),
    text=(x:number,y:number,str:string,tone:Tone='ink')=>add({kind:'text',x,y,text:str,align:'middle'},tone),
    poly=(points:Point[],tone:Tone,dashed=false)=>{if(points.length>=2)add({kind:'polyline',points,dashed},tone);},
    c=computeWaveSpeed(p),obs=computeObservables(s,p);
  if(lineMode(p)){
    const a=extent(p),wave=(x:number,t:number)=>p.mode==='standing'?evaluateStandingWave(x,t,p):evaluateTransverseWave(x,t,p);
    text(0,a+.67,p.mode==='standing'?'相向行波叠加 · 固定波节与振幅包络':'空间波形 y(x,t) · t='+s.t.toFixed(2)+' s');
    arrow(point(-4.15,0),point(4.2,0),'axis');arrow(point(0,-a-.18),point(0,a+.27),'axis');
    text(4.23,-.2,'x / m','muted');text(.28,a+.22,'y / m','muted');
    for(let x=-4;x<=4;x++){line(point(x,-.055),point(x,.055),'axis');text(x,-.24,String(x),'muted');}
    for(const sign of [-1,1]){line(point(-.055,sign*a),point(.055,sign*a),'axis');text(-.34,sign*a,(sign*a).toFixed(2),'muted');}
    if(layers.has('waveform')){
      const xs=Array.from({length:401},(_,j)=>-4+8*j/400);
      if(p.mode==='transverse'&&p.causalFront){const front=(p.direction==='right'?1:-1)*c*s.t;if(front>=-4&&front<=4)xs.push(front,0);xs.sort((a,b)=>a-b);}
      poly(xs.map(x=>point(x,wave(x,s.t).y)),'wave');
      for(let j=0;j<=20;j++){const x=-4+8*j/20;circle(point(x,wave(x,s.t).y),.027,'wave',true);}
      if(p.mode==='standing'&&p.wavelength>0){
        for(const sign of [-1,1])poly(xs.map(x=>point(x,sign*2*p.amplitude*Math.abs(Math.sin(2*Math.PI*x/p.wavelength)))),'ghost',true);
        const h=p.wavelength/2;for(let j=Math.ceil(-4/h);j<=Math.floor(4/h);j++)circle(point(j*h,0),.055,'node');
        text(-2.4,a+.28,'虚线：±2A|sin(kx)|　空心：波节','muted');
      }
    }
    if(layers.has('slopeGhost')&&p.mode==='transverse'&&p.frequency>0){
      const dt=.08/p.frequency;
      poly(Array.from({length:321},(_,j)=>{const x=-4+8*j/320;return point(x,wave(x,s.t+dt).y);}), 'ghost',true);
      const dir=p.direction==='right'?1:-1;arrow(point(-3.8,a+.28),point(-3.8+dir*.8,a+.28),'ghost');
      text(-1.8,a+.28,'传播 '+(dir>0?'+x':'−x')+' · 虚线 t+Δt','muted');
    }
    if(p.mode==='transverse'&&p.causalFront&&c>0){
      const front=obs.frontX??0;
      if(front>=-4&&front<=4){line(point(front,-a-.14),point(front,a+.14),'front',true);text(front,a+.42,'波前','source');}
      else text(2.7,a+.35,'波前 x='+front.toFixed(2)+' m','source');
    }
    if(layers.has('probeParticle')){
      const pos=point(p.probeX,s.probeDisplacement),eq=point(p.probeX,0),v=s.probeVelocityY;
      line(point(p.probeX,-a-.09),point(p.probeX,a+.09),'probe',true);circle(eq,.045,'probe');circle(pos,.065,'probe',true);
      if(Math.abs(v)>1e-8)arrow(pos,point(pos.x,pos.y+Math.sign(v)*Math.min(.45,Math.max(.13,Math.abs(v)*.065))),'velocity');
      text(pos.x,pos.y+.22,'P · y='+s.probeDisplacement.toFixed(2)+' m','probe');
    }
    if(layers.has('vibrationGraph')){
      const left=-3.7,right=3.7,bottom=-a-1.78,top=-a-.68,mid=(bottom+top)/2,span=top-bottom,
        tEnd=Math.max(4,s.t),tStart=tEnd-4,pt=(t:number,y:number)=>point(left+(t-tStart)/4*(right-left),mid+y/(a)*span*.42);
      add({kind:'rect',x:left,y:bottom,width:right-left,height:span},'axis');
      line(point(left,mid),point(right,mid),'axis');text(0,top+.22,'固定质点 P：实际采样 yP(t)','probe');
      text(left-.25,top-.12,'+'+a.toFixed(2),'muted');text(left-.25,bottom+.12,'−'+a.toFixed(2),'muted');
      for(let j=0;j<=4;j++){const x=left+j/4*(right-left);line(point(x,bottom),point(x,bottom-.045),'axis');text(x,bottom-.17,(tStart+j).toFixed(1),'muted');}text(right+.25,bottom-.17,'t/s','muted');
      const samples=s.probeHistory.filter(q=>q.x>=tStart-1e-10&&q.x<=tEnd+1e-10).map(q=>pt(q.x,q.y));
      poly(samples,'probe');if(samples.length)circle(samples.at(-1)!,.04,'probe',true);
      if(p.mode==='transverse'&&p.causalFront&&obs.arrivalTime!==undefined&&obs.arrivalTime>=tStart&&obs.arrivalTime<=tEnd){
        const x=pt(obs.arrivalTime,0).x;line(point(x,bottom),point(x,top),'front',true);
      }
    }
    return marks;
  }
  if(p.mode==='interference'){
    const b=fieldBox,h=p.sourceSeparation/2;
    add({kind:'rect',x:b.minX,y:b.minY,width:b.maxX-b.minX,height:b.maxY-b.minY},'axis');
    text(0,2.95,'双波源瞬时位移场 · t='+s.t.toFixed(2)+' s');
    if(layers.has('interferenceField')){
      if(p.causalFront)for(const x of [-h,h])for(const q of wavefrontPrimitives(x,0,c*s.t,b))add(q,'front');
      // Export phase contour of each source with exact emission time; screen
      // additionally fills instantaneous signed displacement as a raster.
      if(c>0&&p.amplitude>0){
        for(const [i,x] of [-h,h].entries()){
          const phase=i===0?0:p.phaseDiffDeg/360;
          for(let n=-Math.ceil(8/p.wavelength)-1;n<=Math.ceil(s.t*p.frequency+phase);n++){
            const r=(s.t*p.frequency+phase-n)*p.wavelength;
            if(r<=0||r>8||(p.causalFront&&r>c*s.t+1e-10))continue;
            for(const q of wavefrontPrimitives(x,0,r,b))add(q,'wave');
          }
        }
      }
    }
    if(layers.has('antinodeCurves'))for(const f of interferenceFringes(p,s.t))poly(f.points,f.node?'node':'antinode',f.node);
    for(const [j,x] of [-h,h].entries()){circle(point(x,0),.067,'source',true);text(x,-.23,'S'+(j+1),'source');}
    if(layers.has('probeParticle')){
      const P=point(p.probeX,p.probeY);line(point(-h,0),P,'muted',true);line(point(h,0),P,'muted',true);circle(P,.074,'probe',true);text(P.x,P.y+.2,'P · y='+s.probeDisplacement.toFixed(2)+' m','probe');
      const o=obs; text(0,-2.72,'r₂−r₁='+((o.signedPathDifference??0).toFixed(2))+' m · 合振幅 '+(o.analyticalAmplitude??0).toFixed(2)+' m','ink');
    }
    text(0,2.68,'青/玫红：正/负位移　实线：加强　虚线：减弱','muted');
    return marks;
  }
  const b=dopplerBox,beta=p.sourceSpeedRatio;
  add({kind:'rect',x:b.minX,y:b.minY,width:b.maxX-b.minX,height:b.maxY-b.minY},'axis');
  text(0,3.12,'运动波源 · 因果波前与固定接收点');
  text(0,2.85,'β='+beta.toFixed(2)+' · '+(beta<1?'亚声速':beta===1?'声速边界':'超声速尾迹')+' · t='+s.t.toFixed(2)+' s','muted');
  line(point(b.minX,0),point(b.maxX,0),'axis',true);
  if(layers.has('dopplerFronts'))for(const f of s.wavefronts)for(const q of wavefrontPrimitives(f.cx,f.cy,c*Math.max(0,s.t-f.emittedAt),b))add(q,'wave');
  if(beta>1&&c>0&&p.amplitude>0){
    const alpha=Math.asin(1/beta),L=c*s.t*Math.sqrt(beta*beta-1),apex=point(s.sourceX,0);
    for(const sign of [-1,1]){const segment=clipSegment(apex,point(apex.x-L*Math.cos(alpha),sign*L*Math.sin(alpha)),b);if(segment.length===2)line(segment[0]!,segment[1]!,'source',true);}
    text(0,-2.86,'有限历程马赫包络 · α='+(alpha*180/Math.PI).toFixed(1)+'°','source');
  }else text(0,-2.86,'波前：每隔一个源周期发出的等相位标记','muted');
  if(inside(point(s.sourceX,0),b)){
    const q=point(s.sourceX,0);circle(q,.08,'source',true);if(beta>0)arrow(q,point(Math.min(b.maxX,q.x+.5),0),'source');text(q.x,.24,'S','source');
  }else text(s.sourceX>b.maxX?3.3:-3.3,.22,'S 已离开视窗 · '+s.sourceX.toFixed(2)+' m','source');
  if(layers.has('probeParticle')){
    const q=point(p.probeX,p.probeY);circle(q,.075,'probe',true);text(q.x,q.y+.22,'P · '+(!s.probeSampleDefined?'奇异域':s.arrivalCount===0?'未到达':s.arrivalCount+' 支接收'),'probe');
    if(s.probeSampleDefined&&s.arrivalCount>0){for(const tau of s.retardedTimes){const x=-2+beta*c*tau,segment=clipSegment(point(x,0),q,b);if(segment.length===2)line(segment[0]!,segment[1]!,'muted',true);}}
  }
  return marks;
}
export function waveExport(s:WaveCouplingState,p:WaveCouplingParams):DiagramIR{
  return {width:1000,height:640,viewBox:waveDiagramBounds(p),title:p.mode==='doppler'?'运动波源因果波前与马赫包络':p.mode==='interference'?'双波源等相位波前及干涉条纹':p.mode==='standing'?'驻波波节、包络与质点振动':'行波空间波形与实际质点采样',primitives:waveDiagramScene(s,p).map(m=>m.primitive),metadata:{model:'wave-vibration-coupling',mode:p.mode,t:String(s.t),notes:'二维等幅标量波示意；空间图 y(x,t) 与时间图 yP(t) 各有坐标。导出保留等相位线和条纹，不含瞬时位移热图。'}};
}
type Safe={left:number;right:number;top:number;bottom:number};
export function fitWaveViewport(p:WaveCouplingParams,v:Viewport,safe:Safe):Viewport|null{
  const b=waveDiagramBounds(p),w=safe.right-safe.left,h=safe.bottom-safe.top;
  if(w<60||h<60)return null;
  const ppm=Math.min((w-24)/(b.maxX-b.minX),(h-20)/(b.maxY-b.minY));
  return {...v,scale:ppm/(.24*Math.min(v.width,v.height)),offsetX:(safe.left+safe.right)/2-v.width*.45-ppm*(b.minX+b.maxX)/2,offsetY:(safe.top+safe.bottom)/2-v.height*.5+ppm*(b.minY+b.maxY)/2};
}
export function waveBoundsFit(p:WaveCouplingParams,v:Viewport,safe:Safe){
  const b=waveDiagramBounds(p),m=createWorldMapper(v),a=m.toScreen(b.minX,b.maxY),z=m.toScreen(b.maxX,b.minY);
  return a.x>=safe.left-1&&a.y>=safe.top-1&&z.x<=safe.right+1&&z.y<=safe.bottom+1;
}
export function renderWaveDiagram(ctx:CanvasRenderingContext2D,s:WaveCouplingState,p:WaveCouplingParams,v:Viewport,layers:ReadonlySet<string>){
  const m=createWorldMapper(v),paper=v.theme==='projector',colors:Record<Tone,string>=paper?{axis:'#64748b',ink:'#0f172a',muted:'#475569',wave:'#0369a1',ghost:'#a16207',probe:'#be185d',velocity:'#047857',source:'#92400e',node:'#be123c',antinode:'#047857',front:'#b45309'}:{axis:'#52677f',ink:'#e2e8f0',muted:'#9aadc3',wave:'#67e8f9',ghost:'#fbbf24',probe:'#f472b6',velocity:'#4ade80',source:'#f8cc87',node:'#fda4af',antinode:'#86efac',front:'#fbbf24'};
  ctx.save();ctx.lineCap='round';ctx.lineJoin='round';
  if(p.mode==='interference'&&layers.has('interferenceField')&&p.amplitude>0){
    const b=fieldBox,cols=92,rows=60,dx=(b.maxX-b.minX)/cols,dy=(b.maxY-b.minY)/rows;
    const palette=Array.from({length:33},(_,i)=>{const q=(i-16)/16,a=Math.abs(q)*.64;return q>=0?'rgba(8,145,178,'+a.toFixed(3)+')':'rgba(225,80,140,'+a.toFixed(3)+')';});
    for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
      const x=b.minX+(col+.5)*dx,y=b.minY+(row+.5)*dy,r=evaluateInterferenceAtPoint(x,y,s.t,p),q=Math.round(16*Math.max(-1,Math.min(1,r.displacement/(2*p.amplitude))))+16;
      ctx.fillStyle=palette[q]!;const a=m.toScreen(x-dx/2,y+dy/2);ctx.fillRect(a.x,a.y,m.len(dx)+.3,m.len(dy)+.3);
    }
  }
  const labels:CanvasLabel[]=[];
  for(const [i,{primitive:q,tone,fill}] of waveDiagramScene(s,p,layers).entries()){
    const color=colors[tone];ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=tone==='wave'&&lineMode(p)?2.9:tone==='axis'?1:tone==='muted'?1:1.6;
    ctx.globalAlpha=p.mode==='interference'&&tone==='wave'?.27:tone==='muted'?.8:1;
    ctx.shadowBlur=!paper&&(tone==='wave'||tone==='probe')?4:0;ctx.shadowColor=color;
    if(q.kind==='text'){
      const a=m.toScreen(q.x,q.y);labels.push({id:'w01-'+i,x:a.x,y:a.y,text:q.text,color,font:tone==='ink'?'bold 13px system-ui':'11px system-ui'});
    }else if(q.kind==='line'||q.kind==='arrow'){
      const a=m.toScreen(q.x1,q.y1),b=m.toScreen(q.x2,q.y2);
      if(q.kind==='arrow'&&tone!=='axis'){drawGlowVectorArrow(ctx,a.x,a.y,b.x,b.y,color,2.2,9);}
      else{ctx.setLineDash(q.dashed?[5,4]:[]);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.setLineDash([]);if(q.kind==='arrow'){const dx=b.x-a.x,dy=b.y-a.y,n=Math.hypot(dx,dy);if(n>0){const u=dx/n,w=dy/n;ctx.beginPath();ctx.moveTo(b.x,b.y);ctx.lineTo(b.x-6*u+3*w,b.y-6*w-3*u);ctx.lineTo(b.x-6*u-3*w,b.y-6*w+3*u);ctx.closePath();ctx.fill();}}}
    }else if(q.kind==='circle'){const a=m.toScreen(q.cx,q.cy);ctx.beginPath();ctx.arc(a.x,a.y,fill?Math.max(2,m.len(q.r)):m.len(q.r),0,2*Math.PI);if(fill){ctx.fill();if(tone==='probe'){ctx.strokeStyle=paper?'#ffffff':'#e2e8f0';ctx.lineWidth=1;ctx.stroke();}}else ctx.stroke();}
    else if(q.kind==='polyline'||q.kind==='trajectory'){if(q.points.length<2)continue;ctx.setLineDash(q.dashed?[5,4]:[]);const a=m.toScreen(q.points[0]!.x,q.points[0]!.y);ctx.beginPath();ctx.moveTo(a.x,a.y);for(const b of q.points.slice(1)){const t=m.toScreen(b.x,b.y);ctx.lineTo(t.x,t.y);}ctx.stroke();ctx.setLineDash([]);}
    else if(q.kind==='rect'){const a=m.toScreen(q.x,q.y+q.height);ctx.strokeRect(a.x,a.y,m.len(q.width),m.len(q.height));}
  }
  ctx.globalAlpha=1;ctx.shadowBlur=0;resolveAndDrawLabels(ctx,labels,v.width,v.height);ctx.restore();
}
