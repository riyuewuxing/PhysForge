import { CLASSROOM_GRAVITY } from '@physforge/physics-core';
import { createWorldMapper, defineSimulationPlugin, resolveAndDrawLabels, type DiagramPrimitive, type ParamFieldSpec, type Viewport } from '@physforge/sim-sdk';
import { constrainedVelocityPresets } from './presets.js';
import { checkInvariants,computeObservables,createInitialState,stepConstrainedVelocity,normalizedParams,
  type ConstrainedVelocityParams,type ConstrainedVelocityState,type Point } from './engine.js';

const paramSchema:readonly ParamFieldSpec<ConstrainedVelocityParams>[]=[
  {key:'mode',kind:'select',label:'关联速度模型',options:[
    {label:'岸边定滑轮收绳拉船',value:'rope-pull-boat'},{label:'直杆靠墙角下滑',value:'ladder-wall'},
    {label:'斜面推竖直轻杆',value:'wedge-rod'},{label:'双绳不等速收绳',value:'dual-rope-pull'}],defaultValue:'rope-pull-boat'},
  {key:'driveSpeed',kind:'number',label:'驱动速率 u',unit:'m/s',min:0,max:5,step:.5,defaultValue:1.5},
  {key:'heightOrLength',kind:'number',label:'几何尺寸',unit:'m',min:1,max:4,step:.2,defaultValue:1.8},
  {key:'initialAngleDeg',kind:'number',label:'初始几何倾角 θ₀',unit:'°',min:15,max:75,step:1,defaultValue:25},
  {key:'secondarySpeedRatio',kind:'number',label:'右/左收绳速率比 r',min:0,max:1.5,step:.1,defaultValue:.6},
  {key:'payloadMassKg',kind:'number',label:'载荷质量 m（仅用于重力）',unit:'kg',min:.5,max:10,step:.5,defaultValue:1}
];
type Role='structure'|'object'|'velocity'|'parallel'|'perpendicular'|'guide'|'text';
interface Item{primitive:DiagramPrimitive;role:Role}
const add=(a:Point,b:Point,k=1):Point=>({x:a.x+k*b.x,y:a.y+k*b.y});
const norm=(v:Point)=>Math.hypot(v.x,v.y);
const magnitude=(x:number)=>x.toFixed(2);
function layout(p:ConstrainedVelocityParams){
  const q=normalizedParams(p),D=q.size,a=q.initialAngleDeg*Math.PI/180;
  let minX=0,maxX=D,minY=0,maxY=D;
  if(q.mode==='rope-pull-boat')maxX=D/Math.tan(a);
  if(q.mode==='wedge-rod'){maxX=1.75*D;maxY=D*Math.tan(a)+.5*D;}
  if(q.mode==='dual-rope-pull'){const l=D/(2*Math.cos(a));minX=Math.min(0,D-l);maxX=Math.max(D,l);minY=-l;maxY=0;}
  const span=Math.max(1,maxX-minX,maxY-minY),cy=(minY+maxY)/2,cx=maxX+.90*span;
  const bounds={minX:minX-.42*span,minY:Math.min(minY-.40*span,cy-.82*span),
    maxX:maxX+1.50*span,maxY:Math.max(maxY+.40*span,cy+.99*span)};
  return {minX,maxX,minY,maxY,span,cx,cy,bounds};
}
export function fitConstrainedViewport(p:ConstrainedVelocityParams,v:Viewport,safe:{left:number;right:number;top:number;bottom:number}):Viewport|null{
  const b=layout(p).bounds,{left,right,top,bottom}=safe;
  if(right-left<100||bottom-top<100)return null;
  const ppm=Math.min((right-left)/(b.maxX-b.minX),(bottom-top)/(b.maxY-b.minY));
  if(!(ppm>0&&Number.isFinite(ppm)))return null;
  return {...v,scale:ppm/(.24*Math.min(v.width,v.height)),
    offsetX:(left+right)/2-(b.minX+b.maxX)*ppm/2-.45*v.width,
    offsetY:(top+bottom)/2+(b.minY+b.maxY)*ppm/2-.5*v.height};
}
export const constrainedViewBounds=(p:ConstrainedVelocityParams)=>layout(p).bounds;
function initialCamera(p:ConstrainedVelocityParams,v:{width:number;height:number}){
  const b=layout(p).bounds,base=.24*Math.min(v.width,v.height),left=26,right=v.width>=1200?v.width-300:v.width-26;
  const top=30,bottom=v.height>=650?v.height-175:v.height-26;
  const ppm=Math.min((right-left)/(b.maxX-b.minX),(bottom-top)/(b.maxY-b.minY));
  const scale=ppm/base;
  return {scale,offsetRatioX:((left+right)/2-(b.minX+b.maxX)*ppm/2-.45*v.width)/v.width,
    offsetRatioY:((top+bottom)/2+(b.minY+b.maxY)*ppm/2-.5*v.height)/v.height};
}
/** Both output surfaces use the same world geometry and vector components. */
export function constrainedGeometry(s:ConstrainedVelocityState,p:ConstrainedVelocityParams){
  const L=layout(p),{span,cx,cy}=L,D=s.size,a=s.initialAngleDeg*Math.PI/180;
  const structure:Item[]=[],vectors:Item[]=[];
  const line=(items:Item[],a:Point,b:Point,role:Role='structure',dashed=false)=>items.push({role,primitive:{kind:'line',x1:a.x,y1:a.y,x2:b.x,y2:b.y,dashed}});
  const text=(items:Item[],at:Point,value:string,role:Role='text')=>items.push({role,primitive:{kind:'text',x:at.x,y:at.y,text:value,align:'middle'}});
  const dot=(p:Point,r=.025*span,fill=true)=>structure.push({role:fill?'object':'structure',primitive:{kind:'circle',cx:p.x,cy:p.y,r,fill}});
  const A=s.posA,B=s.posB;
  if(s.mode==='rope-pull-boat'){
    line(structure,{x:-.12*span,y:0},{x:L.maxX+.12*span,y:0});
    line(structure,{x:0,y:-.12*span},B);line(structure,A,B);
    dot(B,.045*span,false);
    const w=.10*span,h=.045*span;
    structure.push({role:'object',primitive:{kind:'polyline',points:[{x:A.x-w,y:A.y},{x:A.x-.06*span,y:A.y-h},{x:A.x+.06*span,y:A.y-h},{x:A.x+w,y:A.y}],closed:true}});
    dot(A,.018*span);text(structure,{x:B.x,y:B.y+.12*span},'固定滑轮');
    text(structure,{x:(A.x+B.x)/2,y:(A.y+B.y)/2+.10*span},'l='+magnitude(s.ropeLength1M??0)+' m');
  }else if(s.mode==='ladder-wall'){
    line(structure,{x:0,y:0},{x:0,y:D*1.12});
    line(structure,{x:-.08*span,y:0},{x:D*1.12,y:0});
    line(structure,A,B);dot(A);dot(B);
    text(structure,{x:A.x-.10*span,y:A.y+.06*span},'A');
    text(structure,{x:B.x+.08*span,y:B.y-.08*span},'B');
    text(structure,{x:(A.x+B.x)/2+.06*span,y:(A.y+B.y)/2+.08*span},'L='+magnitude(D)+' m');
  }else if(s.mode==='wedge-rod'){
    const apex={x:A.x,y:D*Math.tan(a)},right={x:A.x+D,y:0},tip={x:B.x,y:B.y+.4*D};
    line(structure,{x:-.08*span,y:0},{x:L.maxX+.1*span,y:0});
    structure.push({role:'structure',primitive:{kind:'polyline',points:[A,apex,right],closed:true}});
    line(structure,B,tip);line(structure,{x:B.x-.04*span,y:B.y+.22*D},{x:B.x+.04*span,y:B.y+.22*D},'guide',true);
    dot(B,.022*span);text(structure,{x:A.x+.12*D,y:-.10*span},'斜面 A');text(structure,{x:tip.x+.09*span,y:tip.y},'竖杆 B');
  }else{
    const C=s.anchorRight!;
    line(structure,{x:-.10*span,y:0},{x:D+.10*span,y:0});line(structure,B,A);line(structure,C,A);
    dot(B,.04*span,false);dot(C,.04*span,false);dot(A,.028*span);
    text(structure,{x:B.x,y:.10*span},'左滑轮');text(structure,{x:C.x,y:.10*span},'右滑轮');
    text(structure,{x:(A.x+B.x)/2-.11*span,y:A.y/2},'l₁='+magnitude(s.ropeLength1M??0)+' m');
    text(structure,{x:(A.x+C.x)/2+.11*span,y:A.y/2},'l₂='+magnitude(s.ropeLength2M??0)+' m');
  }
  const speedMax=Math.max(1e-12,norm(s.velA),norm(s.velB)),scale=.28*span/speedMax;
  const arrow=(origin:Point,v:Point,role:Role,label:string)=>{
    if(norm(v)<1e-10)return;
    const to=add(origin,v,scale);vectors.push({role,primitive:{kind:'arrow',x1:origin.x,y1:origin.y,x2:to.x,y2:to.y,label}});
  };
  arrow(A,s.velA,'velocity',s.mode==='rope-pull-boat'?'v船':s.mode==='dual-rope-pull'?'v物':'vA');
  arrow(B,s.velB,'velocity','vB');
  text(vectors,{x:cx,y:cy+.88*span},'速度空间 · 同帧统一比例');
  for(const [i,c] of s.constraints.entries()){
    const y=cy+(s.constraints.length===1?0:(i===0?.35:-.35)*span),o={x:cx,y};
    const end=add(o,c.parallel,scale);
    line(vectors,add(o,c.unit,-.31*span),add(o,c.unit,.31*span),'guide',true);
    arrow(o,c.velocity,'velocity','v');arrow(o,c.parallel,'parallel','v∥');arrow(end,c.perpendicular,'perpendicular','v⊥');
    text(vectors,{x:cx,y:y+.32*span},c.label);
    text(vectors,{x:cx,y:y-.31*span},'v∥='+magnitude(c.projected)+' m/s','parallel');
  }
  if(s.terminal)text(structure,{x:(L.minX+L.maxX)/2,y:L.maxY+.27*span},'边界前瞬时值 · 已停止演示');
  return {structure,vectors,bounds:L.bounds,scale};
}
function handle(s:ConstrainedVelocityState){
  const D=s.size,a=s.initialAngleDeg*Math.PI/180,A=s.posA,B=s.posB;
  const origin=s.mode==='rope-pull-boat'?B:s.mode==='wedge-rod'?{x:A.x+D,y:0}:s.mode==='dual-rope-pull'?{x:D/2,y:0}:{x:0,y:0};
  const position=s.mode==='wedge-rod'?{x:A.x,y:D*Math.tan(a)}:A;
  return {origin,position};
}
export const mechConstrainedVelocityPlugin=defineSimulationPlugin<ConstrainedVelocityParams,ConstrainedVelocityState>({
  meta:{id:'mech-constrained-velocity',title:'关联速度（绳拉船 / 靠墙杆 / 接触面分解）(M03)',textbookRef:'人教版 必修第二册 第五章 第1–2节',curriculumTags:['物理观念','科学思维'],difficulty:'高三一轮',version:'2.1.0'},
  defaultView:{scale:(p,v)=>initialCamera(p,v).scale,offsetRatioX:(p,v)=>initialCamera(p,v).offsetRatioX,offsetRatioY:(p,v)=>initialCamera(p,v).offsetRatioY},
  paramSchema,
  getParamFields:p=>paramSchema.filter(f=>(f.key!=='secondarySpeedRatio'||p.mode==='dual-rope-pull')&&(f.key!=='payloadMassKg'||p.mode==='rope-pull-boat'||p.mode==='dual-rope-pull')).map(f=>f.key==='heightOrLength'?{...f,label:p.mode==='rope-pull-boat'?'滑轮高度 H':p.mode==='ladder-wall'?'杆长 L':p.mode==='wedge-rod'?'斜面底长 D':'滑轮间距 D'}:f),
  presets:constrainedVelocityPresets,
  engine:{createInitialState,step:stepConstrainedVelocity,computeObservables,checkInvariants},
  layers:[{id:'geometry',label:'真实约束几何',defaultVisible:true},{id:'decomposition',label:'合速度与正交分量',defaultVisible:true}],
  telemetryChannels:[{key:'speedA',label:'A 端速率',unit:'m/s',color:'#38bdf8'},{key:'speedB',label:'B 端速率',unit:'m/s',color:'#f472b6'},{key:'angleDeg',label:'实际几何角',unit:'°',color:'#fbbf24'},{key:'projection1',label:'约束投影 1',unit:'m/s',color:'#4ade80'},{key:'target1',label:'目标投影 1',unit:'m/s',color:'#e8ba76'}],
  getControlHandles:s=>{
    if(s.t>0)return []; // This is an initial-configuration control, not a moving constraint.
    const h=handle(s);
    return [{id:'initial-angle',label:'θ₀='+s.initialAngleDeg+'°',...h,handleKind:'angle',showWhenIdle:false,color:'#fbbf24',
      onDrag:wp=>{
        const rad=s.mode==='rope-pull-boat'?Math.atan2(s.size,Math.max(.001,wp.x)):
          s.mode==='ladder-wall'?Math.asin(Math.max(0,Math.min(1,wp.y/s.size))):
          s.mode==='wedge-rod'?Math.atan2(Math.max(0,wp.y),Math.max(.001,h.origin.x-wp.x)):
          Math.atan2(Math.max(0,-wp.y),s.size/2);
        return {initialAngleDeg:Math.max(15,Math.min(75,Math.round(rad*180/Math.PI)))};
      }}];
  },
  // The prescribed trajectory does not determine constraint forces. Only the
  // explicitly specified payload's gravity is known, never its net force.
  getForceVectors:(s,p)=>{
    if(s.mode!=='rope-pull-boat'&&s.mode!=='dual-rope-pull')return [];
    const raw=p.payloadMassKg,mass=Math.max(.5,Math.min(10,typeof raw==='number'&&Number.isFinite(raw)?raw:1));
    return [{id:'payload-weight',label:'载荷重力（非合力）',origin:s.posA,force:{x:0,y:-mass*CLASSROOM_GRAVITY},category:'gravity',unit:'N',color:'#fbbf24'}];
  },
  referenceFrames:[{id:'block-a',label:'A 端平移参考系',getOrigin:s=>s.posA,getVelocity:s=>s.velA}],
  sceneSerializer:{exportScene:(_s,params)=>({schemaVersion:'2.0',modelId:'mech-constrained-velocity',title:'关联速度约束分解',params}),importScene:dsl=>dsl.params as Partial<ConstrainedVelocityParams>},
  exportDiagramIR:(s,p)=>{
    const g=constrainedGeometry(s,p);return {width:900,height:560,viewBox:g.bounds,title:'关联速度 · 真实几何与速度分解',primitives:[...g.structure,...g.vectors].map(x=>x.primitive)};
  },
  formatFormulas:s=>{
    const pair=(a:string,b:string)=>'\\begin{gathered}'+a+'\\\\'+b+'\\end{gathered}';
    const eq=s.mode==='rope-pull-boat'?'\\vec v_A\\cdot\\hat e=u':s.mode==='dual-rope-pull'?pair('\\vec v\\cdot\\hat e_1=u_1','\\vec v\\cdot\\hat e_2=u_2'):s.mode==='ladder-wall'?'\\vec v_A\\cdot\\hat e=\\vec v_B\\cdot\\hat e':'\\vec v_A\\cdot\\hat n=\\vec v_B\\cdot\\hat n';
    const law=s.mode==='rope-pull-boat'?pair('v_A=ul/x','a_A=u^2H^2/x^3'):s.mode==='ladder-wall'?'v_B=u\\tan\\theta':s.mode==='wedge-rod'?'v_B=u\\tan\\alpha':pair('l_i=l_{i0}-u_it','\\vec v=E^{-1}\\vec u');
    return [{id:'proj-eq',label:'约束全导数',latex:eq,substitutedLatex:s.constraints.map((c,i)=>'v_{\\parallel'+(s.constraints.length>1?','+(i+1):'')+'}='+c.projected.toFixed(3)+'\\,\\mathrm{m/s}').reduce((a,b)=>pair(a,b))},
      {id:'kinematics',label:'解析瞬时速度',latex:law,substitutedLatex:pair('v_A='+norm(s.velA).toFixed(3)+'\\,\\mathrm{m/s}','v_B='+norm(s.velB).toFixed(3)+'\\,\\mathrm{m/s}')},
      ...(s.terminal?[{id:'terminal',label:s.terminal,latex:'\\text{边界前瞬时值；演示终止}'}]:[])];
  },
  renderCanvas:(ctx,s,p,vp,layers)=>{
    const g=constrainedGeometry(s,p),m=createWorldMapper(vp),paper=vp.theme==='projector';
    const palette:Record<Role,string>=paper?{structure:'#334155',object:'#075985',velocity:'#0369a1',parallel:'#166534',perpendicular:'#9d174d',guide:'#64748b',text:'#0f172a'}:{structure:'#cbd5e1',object:'#67e8f9',velocity:'#38bdf8',parallel:'#4ade80',perpendicular:'#f472b6',guide:'#64748b',text:'#e2e8f0'};
    const labels:Array<{id:string;x:number;y:number;text:string;color:string;font:string}>=[];
    const list=[...(layers.has('geometry')?g.structure:[]),...(layers.has('decomposition')?g.vectors:[])];
    for(const [i,{primitive:d,role}] of list.entries()){
      const color=palette[role];ctx.save();ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=role==='structure'?2.4:2;
      if(d.kind==='line'||d.kind==='arrow'){
        const a=m.toScreen(d.x1,d.y1),b=m.toScreen(d.x2,d.y2);
        ctx.setLineDash(d.dashed?[5,5]:[]);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.setLineDash([]);
        if(d.kind==='arrow'){
          const ang=Math.atan2(b.y-a.y,b.x-a.x);
          if(Math.hypot(b.x-a.x,b.y-a.y)>2){ctx.beginPath();ctx.moveTo(b.x,b.y);ctx.lineTo(b.x-9*Math.cos(ang-.4),b.y-9*Math.sin(ang-.4));ctx.lineTo(b.x-9*Math.cos(ang+.4),b.y-9*Math.sin(ang+.4));ctx.closePath();ctx.fill();}
          if(d.label)labels.push({id:'arrow-'+i,x:(a.x+b.x)/2+Math.sin(ang)*16,y:(a.y+b.y)/2-Math.cos(ang)*16,text:d.label,color,font:'bold 13px sans-serif'});
        }
      }else if(d.kind==='circle'){
        const q=m.toScreen(d.cx,d.cy);ctx.beginPath();ctx.arc(q.x,q.y,Math.max(3,m.len(d.r)),0,Math.PI*2);if(d.fill)ctx.fill();else ctx.stroke();
      }else if(d.kind==='polyline'){
        ctx.beginPath();d.points.forEach((p,j)=>{const q=m.toScreen(p.x,p.y);if(j===0)ctx.moveTo(q.x,q.y);else ctx.lineTo(q.x,q.y);});if(d.closed)ctx.closePath();ctx.stroke();
      }else if(d.kind==='text'){
        const q=m.toScreen(d.x,d.y);labels.push({id:'text-'+i,x:q.x,y:q.y,text:d.text,color,font:'13px sans-serif'});
      }
      ctx.restore();
    }
    resolveAndDrawLabels(ctx,labels,vp.width,vp.height);
  }
});
export default mechConstrainedVelocityPlugin;
