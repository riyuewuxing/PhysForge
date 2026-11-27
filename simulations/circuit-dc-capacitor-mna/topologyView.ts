import { createWorldMapper, type DiagramPrimitive, type DiagramIR, type Viewport } from '@physforge/sim-sdk';
import type { CircuitParams, CircuitState } from './engine.js';
import { dividerPotentialColor } from './dividerView.js';
import {drawLampGlass} from './visualStyle.js';

type Point={x:number;y:number};
type Kind='wire'|'resistor'|'battery'|'capacitor'|'lamp'|'diode';
export type Edge={id:string;kind:Kind;a:Point;b:Point;na:number;nb:number;i:number;label?:string;labelAt?:Point};
const p=(x:number,y:number):Point=>({x,y});
const L=-1.7,R=1.7,T=1.12,B=-1.12;
const f=(v:number)=>v.toFixed(2);
export function sliderRange(params:CircuitParams):[number,number]{
  return params.topology==='rc-bridge-charge'?[.20,.91]:[-.7,.7];
}
export function topologyCamera(width:number,height:number,reserveInspector=true){
  const base=Math.max(1,Math.min(width,height)*.24),usable=width-(reserveInspector&&width>=900?300:0);
  const scale=Math.max(.1,Math.min(1.12,(usable-36)/(4.9*base),(height-135)/(3.65*base)));
  return {scale,offsetRatioX:usable/(2*Math.max(1,width))-.45,offsetRatioY:-.035};
}

/** Each edge follows conventional current from a to b; wire endpoints share a net.
 *  Node 3 in RC and nonlinear series is the external source terminal. */
export function topologyEdges(s:CircuitState,q:CircuitParams):Edge[]{
  const e:Edge[]=[];
  const add=(id:string,kind:Kind,a:Point,b:Point,na:number,nb:number,i:number,label?:string,labelAt?:Point)=>{
    e.push({id,kind,a,b,na,nb,i,...(label===undefined?{}:{label}),...(labelAt?{labelAt}:{})});
  };
  const wire=(id:string,a:Point,b:Point,n:number,i:number)=>add(id,'wire',a,b,n,n,i);
  const resist=(id:string,a:Point,b:Point,na:number,nb:number,i:number,v:number,label:string,at:Point)=>{
    // A zero-ohm element still has a labelled adjustment location.
    add(id,v===0?'wire':'resistor',a,b,na,nb,i,label+' '+v+' Ω',at);
  };
  const I=s.totalCurrent,Il=s.branchCurrent1,Ir=s.branchCurrent2;
  const source=(n:number,end:number)=>{
    wire('source-top',p(L,.32),p(L,T),1,I);
    add('E','battery',p(L,.32),p(L,-.32),1,0,-I,'E '+q.emf+' V',p(L+.39,0));
    wire('source-bottom',p(L,B),p(L,-.32),0,I);
    wire('source-lead',p(L,T),p(-1.32,T),1,I);
    resist('r',p(-1.32,T),p(-.54,T),1,n,I,q.internalR,'r',p(-.93,T+.18));
    wire('source-terminal',p(-.54,T),p(end,T),n,I);
  };
  const bottom=(xs:number[],currents:number[])=>{
    for(let k=0;k<xs.length-1;k++)wire('return-'+k,p(xs[k+1]!,B),p(xs[k]!,B),0,currents[k]!);
  };
  if(q.topology==='closed-power'){
    source(2,R);
    wire('load-upper',p(R,T),p(R,.7),2,I);
    resist('Rp',p(R,.7),p(R,-.7),2,0,I,q.sliderR,'Rₚ',p(R-.44,0));
    wire('load-lower',p(R,-.7),p(R,B),0,I);
    bottom([L,R],[I]);
  }else if(q.topology==='series-parallel-dynamic'){
    source(2,-.4);
    resist('R1',p(-.4,T),p(.32,T),2,3,I,q.r1,'R₁',p(-.04,T+.18));
    wire('split',p(.32,T),p(R,T),3,Ir);
    for(const [x,id,v,i] of [[.32,'R2',q.r2,Il],[R,'Rp',q.sliderR,Ir]] as const){
      wire(id+'-upper',p(x,T),p(x,.7),3,i);
      resist(id,p(x,.7),p(x,-.7),3,0,i,v,id==='R2'?'R₂':'Rₚ',p(x-.43,0));
      wire(id+'-lower',p(x,-.7),p(x,B),0,i);
    }
    bottom([L,.32,R],[I,Ir]);
  }else if(q.topology==='rc-bridge-charge'){
    source(2,-.22);
    wire('split',p(-.22,T),p(R,T),2,Ir);
    const lowerL=Il-s.capCurrent,lowerR=Ir+s.capCurrent;
    for(const [x,id,n,v,iu,idown] of [[-.22,'R1',3,q.r1,Il,lowerL],[R,'Rp',4,q.sliderR,Ir,lowerR]] as const){
      wire(id+'-upper',p(x,T),p(x,.91),2,iu);
      resist(id,p(x,.91),p(x,.20),2,n,iu,v,id==='R1'?'R₁':'Rₚ',p(x+(x<0?-.36:-.44),.64));
      wire(id+'-mid',p(x,.20),p(x,0),n,iu);
      wire(id+'-lower-start',p(x,0),p(x,-.20),n,idown);
      resist(id+'-bottom',p(x,-.20),p(x,-.91),n,0,idown,q.r2,'R₂',p(x+(x<0?-.36:-.44),-.55));
      wire(id+'-lower',p(x,-.91),p(x,B),0,idown);
    }
    add('C','capacitor',p(-.22,0),p(R,0),3,4,s.capCurrent,'C '+q.capacitance+' F',p(.74,.19));
    bottom([L,-.22,R],[I,lowerR]);
  }else if(q.topology==='rc-transient'){
    if(q.switchClosed){
      source(3,-.4);
      resist('R1',p(-.4,T),p(.65,T),3,2,I,q.r1,'R₁',p(.12,T+.18));
      wire('load-top',p(.65,T),p(R,T),2,I);
    }else{
      wire('left-return',p(L,B),p(L,T),0,I);
      wire('discharge-top',p(L,T),p(-.65,T),0,I);
      resist('R1',p(-.65,T),p(.65,T),0,2,I,q.r1,'R₁',p(0,T+.18));
      wire('load-top',p(.65,T),p(R,T),2,I);
    }
    wire('cap-upper',p(R,T),p(R,.36),2,I);
    add('C','capacitor',p(R,.36),p(R,-.36),2,0,I,'C '+q.capacitance+' F',p(R-.49,.03));
    wire('cap-lower',p(R,-.36),p(R,B),0,I);
    bottom([L,R],[I]);
  }else if(q.topology==='nonlinear-lamp-diode'){
    source(3,-.4);
    const rp=q.sliderR;
    resist('Rp',p(-.4,T),p(.65,T),3,2,I,rp,'Rₚ',p(.12,T+.18));
    wire('load-top',p(.65,T),p(R,T),2,I);
    wire('load-upper',p(R,T),p(R,.4),2,I);
    add('load',q.switchClosed?'diode':'lamp',p(R,.4),p(R,-.4),2,0,I,q.switchClosed?'D':'L',p(R-.39,0));
    wire('load-lower',p(R,-.4),p(R,B),0,I);
    bottom([L,R],[I]);
  }
  return e;
}

type Stroke={points:Point[];net:number;closed?:boolean};
type Ring={center:Point;r:number;net:number};
function symbol(e:Edge):{strokes:Stroke[];rings:Ring[]}{
  const strokes:Stroke[]=[],rings:Ring[]=[];
  const dx=e.b.x-e.a.x,dy=e.b.y-e.a.y,d=Math.hypot(dx,dy);
  if(d===0)return {strokes,rings};
  const ux=dx/d,uy=dy/d,m=p((e.a.x+e.b.x)/2,(e.a.y+e.b.y)/2);
  const v=(x:number,y:number)=>p(m.x+ux*x-uy*y,m.y+uy*x+ux*y);
  const line=(points:Point[],net:number,closed=false)=>strokes.push({points,net,closed});
  if(e.kind==='wire'){line([e.a,e.b],e.na);return {strokes,rings};}
  const w=Math.min(.22,d*.30),h=Math.min(.105,d*.22);
  line([e.a,v(-w,0)],e.na);line([v(w,0),e.b],e.nb);
  if(e.kind==='resistor'){
    line([v(-w,-h),v(w,-h),v(w,h),v(-w,h)],-1,true);
  }else if(e.kind==='capacitor'||e.kind==='battery'){
    const gap=Math.min(.065,w*.6);
    line([v(-w,0),v(-gap,0)],e.na);line([v(gap,0),v(w,0)],e.nb);
    line([v(-gap,-h*1.35),v(-gap,h*1.35)],e.na);
    const k=e.kind==='battery'?.66:1.35;
    line([v(gap,-h*k),v(gap,h*k)],e.nb);
  }else if(e.kind==='diode'){
    line([v(-w,-h),v(-w,h),v(w,0)],-1,true);
    line([v(w,-h),v(w,h)],e.nb);
  }else{
    rings.push({center:m,r:w,net:-1});
    line([v(-w*.65,-w*.65),v(w*.65,w*.65)],-1);
    line([v(-w*.65,w*.65),v(w*.65,-w*.65)],-1);
  }
  return {strokes,rings};
}
function junctions(edges:Edge[]){
  const map=new Map<string,{point:Point;net:number;count:number}>();
  for(const e of edges)for(const [point,net] of [[e.a,e.na],[e.b,e.nb]] as const){
    const k=point.x+','+point.y,old=map.get(k);
    if(old)old.count++;else map.set(k,{point,net,count:1});
  }
  return [...map.values()].filter(x=>x.count>2);
}
export function exportTopologyDiagram(s:CircuitState,q:CircuitParams):DiagramIR{
  const edges=topologyEdges(s,q),primitives:DiagramPrimitive[]=[];
  for(const e of edges){
    // Explicit symbol geometry is supported by both SVG and TikZ, including
    // the diode, rather than relying on their incomplete circuitElement cases.
    const a=symbol(e);
    for(const st of a.strokes)primitives.push({kind:'polyline',points:st.points,...(st.closed?{closed:true}:{})});
    for(const r of a.rings)primitives.push({kind:'circle',cx:r.center.x,cy:r.center.y,r:r.r});
    if(e.label&&e.labelAt)primitives.push({kind:'text',x:e.labelAt.x,y:e.labelAt.y,text:e.label,align:'middle'});
  }
  for(const j of junctions(edges))primitives.push({kind:'circle',cx:j.point.x,cy:j.point.y,r:.025,fill:true});
  if(q.topology==='rc-transient'&&!q.switchClosed)primitives.push({kind:'text',x:0,y:-1.47,text:'电源已断开 · R₁ 放电回路',align:'middle'});
  return {width:800,height:500,viewBox:{minX:-2.25,minY:-1.75,maxX:2.25,maxY:1.65},title:'电路原理图 · '+q.topology,primitives};
}

export function renderTopology(ctx:CanvasRenderingContext2D,s:CircuitState,q:CircuitParams,vp:Viewport,layers:ReadonlySet<string>){
  const edges=topologyEdges(s,q),m=createWorldMapper(vp),screen=(a:Point)=>m.toScreen(a.x,a.y),paper=vp.theme==='projector';
  const ink=paper?'#334155':'#dce6ef',size=Math.max(10,Math.min(16,m.len(.086)));
  const voltage=(n:number)=>n===3&&q.topology==='nonlinear-lamp-diode'?(s.sourceTerminalVoltage??0):(s.nodeVoltages[n]??0);
  const invalid=Boolean(s.idealShort||s.modelError);
  const color=(n:number)=>invalid?'#94a3b8':n<0?ink:dividerPotentialColor(voltage(n),q.emf,paper);
  function trace(points:Point[],paint:string|CanvasGradient,width:number,closed=false){
    const a=points.map(screen);ctx.beginPath();ctx.moveTo(a[0]!.x,a[0]!.y);
    for(const x of a.slice(1))ctx.lineTo(x.x,x.y);if(closed)ctx.closePath();
    ctx.strokeStyle=paint;ctx.lineWidth=width;ctx.stroke();
  }
  function label(at:Point,value:string,paint=ink){
    const z=screen(at);ctx.font='500 '+size+'px system-ui,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.strokeStyle=paper?'#fff':'#111827';ctx.lineWidth=3;ctx.strokeText(value,z.x,z.y);ctx.fillStyle=paint;ctx.fillText(value,z.x,z.y);
  }
  const width=Math.max(2,Math.min(5,m.len(.024)));
  ctx.save();ctx.lineJoin='round';ctx.lineCap='round';
  if(layers.has('schematic')){
    for(const e of edges){
      const a=symbol(e),ca=color(e.na),cb=color(e.nb);
      if(e.kind==='lamp'){
        for(const r of a.rings)drawLampGlass(ctx,screen(r.center),m.len(r.r),invalid?0:s.outputPower,paper);
      }
      for(const st of a.strokes){
        let paint:string|CanvasGradient=color(st.net);
        if(st.net<0&&ca!==cb){const aa=screen(e.a),bb=screen(e.b),g=ctx.createLinearGradient(aa.x,aa.y,bb.x,bb.y);g.addColorStop(0,ca);g.addColorStop(1,cb);paint=g;}
        if(s.idealShort&&layers.has('short-circuit'))paint=paper?'#b91c1c':'#fb7185';
        ctx.shadowColor=st.net<0?ca:color(st.net);ctx.shadowBlur=paper?0:8;
        trace(st.points,paint,width,st.closed);ctx.shadowBlur=0;
      }
      if(e.kind!=='lamp')for(const r of a.rings){const z=screen(r.center);ctx.beginPath();ctx.arc(z.x,z.y,m.len(r.r),0,Math.PI*2);ctx.strokeStyle=ink;ctx.lineWidth=width;ctx.stroke();}
      if(e.label&&e.labelAt)label(e.labelAt,e.label);
      // One bounded arrow per sufficiently long ideal wire. State time,
      // not wall clock, controls phase; no arrows across capacitor gaps.
      const d=Math.hypot(e.b.x-e.a.x,e.b.y-e.a.y);
      if(!invalid&&layers.has('current-flow')&&e.kind==='wire'&&d>.20&&Math.abs(e.i)>1e-7){
        const dir=Math.sign(e.i),phase=(s.t*.65*Math.tanh(Math.abs(e.i))+.13)%1;
        const t=dir>0?.2+.6*phase:.8-.6*phase;
        const z=screen(p(e.a.x+(e.b.x-e.a.x)*t,e.a.y+(e.b.y-e.a.y)*t)),h=m.len(.046);
        const aa=screen(e.a),bb=screen(e.b),angle=Math.atan2(bb.y-aa.y,bb.x-aa.x)+(dir<0?Math.PI:0);
        ctx.save();ctx.translate(z.x,z.y);ctx.rotate(angle);ctx.fillStyle=paper?'#92400e':'#fde68a';
        ctx.beginPath();ctx.moveTo(h,0);ctx.lineTo(-h,-h*.7);ctx.lineTo(-h,h*.7);ctx.closePath();ctx.fill();ctx.restore();
      }
    }
    for(const j of junctions(edges)){const z=screen(j.point);ctx.fillStyle=color(j.net);ctx.beginPath();ctx.arc(z.x,z.y,m.len(.028),0,Math.PI*2);ctx.fill();}
    if(layers.has('potential-labels')&&!invalid){
      const nodes=q.topology==='rc-bridge-charge'?[[3,-.45,.16],[4,1.45,.16]]:q.topology==='series-parallel-dynamic'?[[3,.9,.92]]:[[2,1.23,.91]];
      for(const [n,x,y] of nodes)label(p(x!,y!),'N'+n+' '+f(voltage(n!))+' V',color(n!));
      label(p(0,B-.13),'0 V',color(0));
    }
  }
  if(layers.has('meters')){
    if(s.modelError)label(p(0,-.73),'直连二极管超出模型适用范围',paper?'#b91c1c':'#fda4af');
    else if(s.idealShort)label(p(0,-.73),q.emf===0?'理想零阻回路：电流不唯一':'理想短路：无有限解',paper?'#b91c1c':'#fda4af');
    else if(q.topology==='rc-transient'||q.topology==='rc-bridge-charge'){
      label(p(-.9,-1.46),'U꜀ '+f(s.capVoltage)+' V');label(p(.83,-1.46),'I꜀ '+f(s.capCurrent)+' A');
    }else if(q.topology==='series-parallel-dynamic'){
      label(p(-1.0,-1.46),'I '+f(s.totalCurrent)+' A');label(p(.55,-1.46),'I₂ '+f(s.branchCurrent1)+' A · Iₚ '+f(s.branchCurrent2)+' A');
    }else{
      label(p(-.88,-1.46),'I '+f(s.totalCurrent)+' A');label(p(.78,-1.46),'U '+f(s.terminalVoltage)+' V');
    }
  }
  if(q.topology==='rc-transient'&&!q.switchClosed)label(p(0,.32),'电源已断开 · R₁ 放电');
  ctx.restore();
}
