import { createWorldMapper, defineSimulationPlugin, resolveAndDrawLabels, type CanvasLabel, type DiagramPrimitive, type ParamFieldSpec, type TelemetryChannelSpec, type Viewport } from '@physforge/sim-sdk';
import { eddyVortexPresets } from './presets.js';
import {
  checkInvariants,
  computeObservables,
  createInitialState,
  evalVortexField,
  dampingOverlap,
  stepEddyVortex,
  type EddyVortexParams,
  type EddyVortexState
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<EddyVortexParams>[] = [
  {
    key: 'mode',
    kind: 'select',
    label: '实验场景',
    defaultValue: 'betatron-vortex',
    options: [
      { value: 'betatron-vortex', label: '柱对称涡旋电场与带电粒子' },
      { value: 'eddy-damping-compare', label: '整块 vs 开槽铜板阻尼摆对比' }
    ]
  },
  { key: 'cylinderRadiusR', kind: 'number', label: '圆柱磁场半径 R', unit: 'm', min: 0.4, max: 1.8, step: 0.1, defaultValue: 1.2 },
  { key: 'bDotRate', kind: 'number', label: '磁感应强度变化率 dB/dt', unit: 'T/s', min: -3, max: 3, step: 0.1, defaultValue: 1.5 },
  { key: 'bField0', kind: 'number', label: '初始有向磁场 B₀', unit: 'T', min: -3, max: 3, step: 0.2, defaultValue: 1.0 },
  { key: 'particleChargeRatio', kind: 'number', label: '示教有向荷质比 q/m', unit: 'C/kg', min: -4, max: 4, step: 0.2, defaultValue: 1.6 },
  { key: 'particleInitRadius', kind: 'number', label: '初始轨道半径 r₀', unit: 'm', min: 0.3, max: 1.8, step: 0.1, defaultValue: 0.9 },
  { key: 'pendulumLengthL', kind: 'number', label: '铜板摆长 L', unit: 'm', min: 0.5, max: 1.6, step: 0.1, defaultValue: 1.0 },
  { key: 'solidDampingGamma', kind: 'number', label: '整块铜板涡流阻尼系数', unit: 's⁻¹', min: 0, max: 4, step: 0.2, defaultValue: 2.2 },
  { key: 'slottedDampingGamma', kind: 'number', label: '开槽铜板等效阻尼系数', unit: 's⁻¹', min: 0, max: 0.5, step: 0.02, defaultValue: 0.06 },
  { key: 'initialAngleDeg', kind: 'number', label: '双摆初始释放角 θ₀', unit: '°', min: -60, max: 60, step: 5, defaultValue: 35 }
];


const channels:readonly TelemetryChannelSpec[]=[
  {key:'bCurrent',label:'柱内有向 B(t)',unit:'T',color:'#38bdf8'},
  {key:'eVortexMag',label:'所在处 |E|',unit:'V/m',color:'#fbbf24'},
  {key:'bLocal',label:'所在处 Bz',unit:'T',color:'#60a5fa'},
  {key:'Ex',label:'感生 Eₓ',unit:'V/m',color:'#f472b6'},
  {key:'Ey',label:'感生 Eᵧ',unit:'V/m',color:'#a78bfa'},
  {key:'particleSpeed',label:'试探粒子速率',unit:'m/s',color:'#4ade80'},
  {key:'particleRadius',label:'距磁区轴线 r',unit:'m',color:'#fb923c'},
  {key:'specificKineticEnergy',label:'单位质量动能',unit:'J/kg',color:'#38bdf8'},
  {key:'specificElectricWork',label:'单位质量感生电功',unit:'J/kg',color:'#fbbf24'},
  {key:'solidAngleDeg',label:'整块板有向摆角',unit:'°',color:'#fb7185'},
  {key:'slottedAngleDeg',label:'开槽板有向摆角',unit:'°',color:'#4ade80'},
  {key:'solidOmega',label:'整块板有向角速度',unit:'rad/s',color:'#fb7185'},
  {key:'slottedOmega',label:'开槽板有向角速度',unit:'rad/s',color:'#4ade80'},
  {key:'solidEnergySpecific',label:'整块板单位质量机械能',unit:'J/kg',color:'#fb7185'},
  {key:'slottedEnergySpecific',label:'开槽板单位质量机械能',unit:'J/kg',color:'#4ade80'},
  {key:'solidHeatSpecific',label:'整块板单位质量耗散热',unit:'J/kg',color:'#fbbf24'},
  {key:'slottedHeatSpecific',label:'开槽板单位质量耗散热',unit:'J/kg',color:'#38bdf8'}
];
export interface EddySafeRect{left:number;right:number;top:number;bottom:number}
const rFor=(p:EddyVortexParams)=>Math.max(.2,p.cylinderRadiusR);
const lFor=(p:EddyVortexParams)=>Math.max(.4,p.pendulumLengthL);
const bob=(side:number,th:number,L:number)=>({x:side*1.4*L+L*Math.sin(th),y:.5*L-L*Math.cos(th)});
export function eddyDiagramBounds(s:EddyVortexState,p:EddyVortexParams){
  if(p.mode==='eddy-damping-compare'){
    const L=lFor(p);return {minX:-2.8*L,maxX:2.8*L,minY:-.93*L,maxY:1.1*L};
  }
  const R=rFor(p),r=Math.hypot(s.px,s.py),follow=r>4*R;
  if(follow)return {minX:s.px-1.45*R,maxX:s.px+1.45*R,minY:s.py-1.45*R,maxY:s.py+1.45*R};
  return {minX:Math.min(-1.98*R,s.px-.35*R),maxX:Math.max(1.98*R,s.px+.35*R),minY:Math.min(-1.98*R,s.py-.35*R),maxY:Math.max(1.98*R,s.py+.35*R)};
}
export function fitEddyViewport(s:EddyVortexState,p:EddyVortexParams,v:Viewport,safe:EddySafeRect):Viewport|null{
  const b=eddyDiagramBounds(s,p),w=safe.right-safe.left,h=safe.bottom-safe.top;
  if(w<140||h<120)return null;
  const ppm=Math.min((w-86)/(b.maxX-b.minX),(h-70)/(b.maxY-b.minY));
  if(!Number.isFinite(ppm)||ppm<=0)return null;
  return {...v,scale:ppm/(.24*Math.min(v.width,v.height)),offsetX:(safe.left+safe.right)/2-(b.minX+b.maxX)*ppm/2-.45*v.width,
    offsetY:(safe.top+safe.bottom)/2+(b.minY+b.maxY)*ppm/2-.5*v.height};
}
export function eddyBoundsFit(s:EddyVortexState,p:EddyVortexParams,v:Viewport,safe:EddySafeRect){
  const b=eddyDiagramBounds(s,p),m=createWorldMapper(v);
  return m.toX(b.minX)>=safe.left+22&&m.toX(b.maxX)<=safe.right-22&&m.toY(b.maxY)>=safe.top+20&&m.toY(b.minY)<=safe.bottom-20;
}
function initialView(p:EddyVortexParams,v:{width:number;height:number}){
  const full={...v,dpr:1,scale:1,offsetX:0,offsetY:0},q=fitEddyViewport(createInitialState(p),p,full,{left:30,right:v.width-30,top:25,bottom:v.height-25})??full;
  return {scale:q.scale,offsetRatioX:q.offsetX/v.width,offsetRatioY:q.offsetY/v.height};
}

export const emEddyVortexFieldPlugin=Object.assign(defineSimulationPlugin<EddyVortexParams,EddyVortexState>({
  meta:{id:'em-eddy-vortex-field',title:'感生涡旋电场与电磁阻尼对比 (E06)',textbookRef:'人教版 选择性必修二 第二章 第4节',
    curriculumTags:['物理观念','科学思维','科学探究'],difficulty:'压轴专题',version:'2.0.0'},
  defaultView:{minScale:.0001,scale:(p,v)=>initialView(p,v).scale,offsetRatioX:(p,v)=>initialView(p,v).offsetRatioX,offsetRatioY:(p,v)=>initialView(p,v).offsetRatioY},
  paramSchema,presets:eddyVortexPresets,
  getParamFields:p=>{
    const keys=p.mode==='betatron-vortex'?['mode','cylinderRadiusR','bDotRate','bField0','particleChargeRatio','particleInitRadius']:
      ['mode','pendulumLengthL','solidDampingGamma','slottedDampingGamma','initialAngleDeg'];
    return keys.flatMap(k=>paramSchema.filter(f=>f.key===k));
  },
  engine:{createInitialState,step:stepEddyVortex,computeObservables,checkInvariants},
  layers:[{id:'vortexRings',label:'磁场区域与感生环 / 阻尼极区',defaultVisible:true},{id:'particle',label:'试探粒子轨迹 / 双摆',defaultVisible:true}],
  telemetryChannels:channels,
  getTelemetryChannels:p=>p.mode==='betatron-vortex'?channels.filter(c=>!c.key.startsWith('solid')&&!c.key.startsWith('slotted')):channels.filter(c=>c.key.startsWith('solid')||c.key.startsWith('slotted')),
  getForceVectors:(s,p)=>{
    if(p.mode!=='betatron-vortex')return [];
    const o=computeObservables(s,p),eta=p.particleChargeRatio,origin={x:s.px,y:s.py};
    return [
      {id:'vortex-electric',label:'a_E',origin,force:{x:eta*o.Ex!,y:eta*o.Ey!},category:'electric',color:'#fbbf24',unit:'m/s²'},
      {id:'vortex-magnetic',label:'a_B',origin,force:{x:eta*s.vy*o.bLocal!,y:-eta*s.vx*o.bLocal!},category:'magnetic',color:'#38bdf8',unit:'m/s²'}
    ];
  },
  referenceFrames:[{id:'eddy-probe',label:'试探粒子随动（仅涡旋）',
    getOrigin:(s,p)=>p.mode==='betatron-vortex'?{x:s.px,y:s.py}:{x:0,y:0},getVelocity:(s,p)=>p.mode==='betatron-vortex'?{x:s.vx,y:s.vy}:{x:0,y:0}}],
  getControlHandles:(_s,p)=>{
    if(p.mode==='betatron-vortex')return [
      {id:'cyl-radius',label:'R='+p.cylinderRadiusR.toFixed(1)+'m',position:{x:p.cylinderRadiusR,y:0},handleKind:'radius',color:'#38bdf8',showWhenIdle:false,
        onDrag:wp=>({cylinderRadiusR:Number(Math.max(.4,Math.min(1.8,Math.hypot(wp.x,wp.y))).toFixed(1))})}];
    const L=lFor(p),point=bob(-1,p.initialAngleDeg*Math.PI/180,L);
    return [{id:'pendulum-angle',label:'初角='+p.initialAngleDeg+'°',position:point,handleKind:'angle',color:'#fbbf24',showWhenIdle:false,
      onDrag:wp=>({initialAngleDeg:Math.round(Math.max(-60,Math.min(60,Math.atan2(wp.x+1.4*L,.5*L-wp.y)*180/Math.PI))/5)*5})}];
  },
  sceneSerializer:{exportScene:(_s,p)=>({schemaVersion:'2.0',modelId:'em-eddy-vortex-field',title:'感生涡旋电场与电磁阻尼',params:p}),
    importScene:dsl=>dsl.params as Partial<EddyVortexParams>},
  exportDiagramIR:(s,p)=>{
    const primitives:DiagramPrimitive[]=[];
    if(p.mode==='eddy-damping-compare'){
      const L=lFor(p);
      for(const side of [-1,1]){
        const th=side<0?s.solidTheta:s.slottedTheta,b=bob(side,th,L),px=side*1.4*L;
        primitives.push({kind:'line',x1:px,y1:.5*L,x2:b.x,y2:b.y,strokeWidth:2},
          
          {kind:'text',x:px,y:.83*L,text:side<0?'整块铜板':'开槽铜板',align:'middle'});
        if(side<0)primitives.push({kind:'rect',x:b.x-.22*L,y:b.y-.15*L,width:.44*L,height:.3*L});
        else{
          const points=[{x:b.x-.22*L,y:b.y+.15*L},{x:b.x+.22*L,y:b.y+.15*L},{x:b.x+.22*L,y:b.y-.15*L}];
          for(let i=0;i<3;i++){
            const x=b.x+(.22-.105*(i+1))*L;
            points.push({x:x+.018*L,y:b.y-.15*L},{x:x+.018*L,y:b.y+.055*L},{x:x-.018*L,y:b.y+.055*L},{x:x-.018*L,y:b.y-.15*L});
          }
          points.push({x:b.x-.22*L,y:b.y-.15*L},{x:b.x-.22*L,y:b.y+.15*L});
          primitives.push({kind:'polyline',points});
        }
        const pts=Array.from({length:25},(_,i)=>bob(side,-.45+.9*i/24,L));
        primitives.push({kind:'polyline',points:pts,dashed:true});
      }
    }else{
      const R=rFor(p),follow=Math.hypot(s.px,s.py)>4*R;
      if(!follow){
        primitives.push({kind:'circle',cx:0,cy:0,r:R,dashed:true});
        if(p.bDotRate!==0)for(const f of [.5,1.35]){
          primitives.push({kind:'circle',cx:0,cy:0,r:R*f,dashed:true});
          const x=R*f,dir=-Math.sign(p.bDotRate);
          primitives.push({kind:'arrow',x1:x,y1:0,x2:x,y2:dir*.15*R});
        }
      }
      primitives.push({kind:'circle',cx:s.px,cy:s.py,r:.04*R,fill:true},
        {kind:'trajectory',points:s.trail.map(v=>({x:v.x,y:v.y})),strokeWidth:1.5});
      const e=evalVortexField(s.px,s.py,R,p.bDotRate),mag=Math.hypot(e.Ex,e.Ey);
      if(mag>0)primitives.push({kind:'arrow',x1:s.px,y1:s.py,x2:s.px+e.Ex/mag*.35*R,y2:s.py+e.Ey/mag*.35*R},
        {kind:'text',x:s.px,y:s.py+.18*R,text:'E（方向）'});
    }
    return {width:820,height:500,viewBox:eddyDiagramBounds(s,p),title:p.mode==='betatron-vortex'?'柱对称感生电场':'整块与开槽铜板等效阻尼',primitives};
  },
  renderCanvas:(ctx,s,p,v,layers)=>{
    const m=createWorldMapper(v),paper=v.theme==='projector',ink=paper?'#0f172a':'#e2e8f0',muted=paper?'#475569':'#94a3b8',
      blue=paper?'#0369a1':'#38bdf8',gold=paper?'#92400e':'#fbbf24',rose=paper?'#be123c':'#fb7185',green=paper?'#166534':'#4ade80',labels:CanvasLabel[]=[];
    const label=(id:string,x:number,y:number,text:string,color=ink,font='13px sans-serif')=>{const q=m.toScreen(x,y);labels.push({id,x:q.x,y:q.y,text,color,font});};
    const line=(x1:number,y1:number,x2:number,y2:number,c:string,w=1.5)=>{
      const a=m.toScreen(x1,y1),b=m.toScreen(x2,y2);ctx.strokeStyle=c;ctx.lineWidth=w;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
    };
    const arrow=(x1:number,y1:number,x2:number,y2:number,c:string)=>{
      const a=m.toScreen(x1,y1),b=m.toScreen(x2,y2),dx=b.x-a.x,dy=b.y-a.y,n=Math.hypot(dx,dy);if(n<1e-8)return;
      line(x1,y1,x2,y2,c,1.8);const u=dx/n,w=dy/n,h=Math.min(9,n*.36);ctx.fillStyle=c;ctx.beginPath();ctx.moveTo(b.x,b.y);ctx.lineTo(b.x-h*u+h*.43*w,b.y-h*w-h*.43*u);ctx.lineTo(b.x-h*u-h*.43*w,b.y-h*w+h*.43*u);ctx.closePath();ctx.fill();
    };
    const dot=(x:number,y:number,r:number,c:string)=>{const q=m.toScreen(x,y);ctx.fillStyle=c;ctx.beginPath();ctx.arc(q.x,q.y,Math.max(3,m.len(r)),0,2*Math.PI);ctx.fill();};
    ctx.save();
    if(p.mode==='eddy-damping-compare'){
      const L=lFor(p),o=computeObservables(s,p);
      for(const side of [-1,1]){
        const solid=side<0,th=solid?s.solidTheta:s.slottedTheta,b=bob(side,th,L),px=side*1.4*L,col=solid?rose:green;
        if(layers.has('vortexRings')){
          // Angular overlap is explicitly a phenomenological pole-gap region.
          const q=m.toScreen(px,.5*L),r=m.len(L),a=Math.PI/2-.45,z=Math.PI/2+.45;
          ctx.save();ctx.strokeStyle=paper?'rgba(3,105,161,.18)':'rgba(56,189,248,.16)';ctx.lineWidth=m.len(.37*L);
          ctx.beginPath();ctx.arc(q.x,q.y,r,a,z);ctx.stroke();ctx.strokeStyle=blue;ctx.lineWidth=1.2;ctx.setLineDash([4,4]);
          ctx.beginPath();ctx.arc(q.x,q.y,r,a,z);ctx.stroke();ctx.restore();
          label('gap-'+side,px,-.83*L,'等效阻尼极区 · f='+dampingOverlap(th).toFixed(2),muted);
        }
        if(layers.has('particle')){
          dot(px,.5*L,.035*L,ink);line(px,.5*L,b.x,b.y,muted,2.5);
          const a=m.toScreen(b.x-.22*L,b.y+.15*L),c=m.toScreen(b.x+.22*L,b.y-.15*L),w=c.x-a.x,h=c.y-a.y;
          const grad=ctx.createLinearGradient(a.x,a.y,c.x,c.y);grad.addColorStop(0,paper?'#fde68a':'#fbd38d');grad.addColorStop(.45,paper?'#b45309':'#c08446');grad.addColorStop(1,paper?'#92400e':'#5e351e');
          ctx.fillStyle=grad;ctx.strokeStyle=col;ctx.lineWidth=1.3;
          if(solid){ctx.fillRect(a.x,a.y,w,h);ctx.strokeRect(a.x,a.y,w,h);}
          else{
            // Real gaps in the drawn conductor; no background-colour erasure.
            ctx.fillRect(a.x,a.y,w,h*.3);ctx.strokeRect(a.x,a.y,w,h*.3);
            for(let i=0;i<4;i++){const x=a.x+i*w*.255;ctx.fillRect(x,a.y+h*.3,w*.21,h*.7);ctx.strokeRect(x,a.y+h*.3,w*.21,h*.7);}
          }
          label('type-'+side,px,.91*L,solid?'整块铜板':'开槽铜板',col,'bold 15px sans-serif');
          label('angle-'+side,px,.7*L,'θ='+(th*180/Math.PI).toFixed(1)+'° · γ='+(solid?p.solidDampingGamma:p.slottedDampingGamma).toFixed(2)+' s⁻¹',ink);
          label('heat-'+side,b.x,b.y-.21*L,'Q/m='+(solid?o.solidHeatSpecific!:o.slottedHeatSpecific!).toFixed(3)+' J/kg',gold);
        }
      }
      resolveAndDrawLabels(ctx,labels,v.width,v.height);ctx.restore();return;
    }
    const R=rFor(p),c=m.toScreen(0,0),r=m.len(R),follow=Math.hypot(s.px,s.py)>4*R;
    if(layers.has('vortexRings')&&!follow){
      const grad=ctx.createRadialGradient(c.x-r*.25,c.y-r*.25,0,c.x,c.y,r);grad.addColorStop(0,paper?'rgba(3,105,161,.05)':'rgba(56,189,248,.20)');grad.addColorStop(1,paper?'rgba(3,105,161,.10)':'rgba(56,189,248,.04)');
      ctx.fillStyle=grad;ctx.strokeStyle=blue;ctx.lineWidth=2;ctx.beginPath();ctx.arc(c.x,c.y,r,0,2*Math.PI);ctx.fill();ctx.stroke();
      if(s.bCurrent!==0)for(let ix=-2;ix<=2;ix++)for(let iy=-2;iy<=2;iy++){
        const x=ix*.42*R,y=iy*.42*R;if(x*x+y*y>R*R*.85)continue;const q=m.toScreen(x,y);
        ctx.strokeStyle=blue;ctx.fillStyle=blue;ctx.lineWidth=1;ctx.beginPath();ctx.arc(q.x,q.y,4,0,2*Math.PI);ctx.stroke();
        if(s.bCurrent>0){ctx.beginPath();ctx.arc(q.x,q.y,1.4,0,2*Math.PI);ctx.fill();}
        else{ctx.beginPath();ctx.moveTo(q.x-2.5,q.y-2.5);ctx.lineTo(q.x+2.5,q.y+2.5);ctx.moveTo(q.x+2.5,q.y-2.5);ctx.lineTo(q.x-2.5,q.y+2.5);ctx.stroke();}
      }
      if(p.bDotRate!==0)for(const f of [.48,.86,1.3,1.65]){
        ctx.strokeStyle=gold;ctx.globalAlpha=.55;ctx.lineWidth=1.3;ctx.beginPath();ctx.arc(c.x,c.y,r*f,0,2*Math.PI);ctx.stroke();ctx.globalAlpha=1;
        const dir=-Math.sign(p.bDotRate),a=Math.PI/5,b=a+dir*.15;
        arrow(R*f*Math.cos(a),R*f*Math.sin(a),R*f*Math.cos(b),R*f*Math.sin(b),gold);
      }
      label('core',0,1.85*R,'柱内 B='+s.bCurrent.toFixed(3)+' T · R='+R.toFixed(2)+' m',ink,'bold 14px sans-serif');
      label('ramp',0,-1.85*R,'dB/dt='+p.bDotRate.toFixed(2)+' T/s · '+(p.bDotRate===0?'E=0':p.bDotRate>0?'E 顺时针':'E 逆时针'),gold);
    }
    if(layers.has('particle')){
      if(s.trail.length>1){
        ctx.strokeStyle=green;ctx.lineWidth=1.8;ctx.beginPath();s.trail.forEach((a,i)=>{const q=m.toScreen(a.x,a.y);if(i===0)ctx.moveTo(q.x,q.y);else ctx.lineTo(q.x,q.y);});ctx.stroke();
      }
      ctx.save();if(!paper){ctx.shadowColor=green;ctx.shadowBlur=13;}dot(s.px,s.py,.035*R,green);ctx.restore();
      const e=evalVortexField(s.px,s.py,R,p.bDotRate),mag=Math.hypot(e.Ex,e.Ey);
      if(mag>0)arrow(s.px,s.py,s.px+.34*R*e.Ex/mag,s.py+.34*R*e.Ey/mag,gold);
      label('particle',s.px,s.py+.13*R,'|E|='+mag.toFixed(3)+' V/m · '+(s.particleInCore?'柱内':'柱外'),green);
      if(follow)label('follow',s.px,s.py+R,p.bDotRate===0?'磁区在视窗外，局部 B=E=0':'磁区在视窗外，B局部=0，感生电场仍存在',muted);
      if(s.boundaryAmbiguous)label('ambiguous',s.px,s.py-.24*R,'理想突变边界切向不适定 · 暂停',rose);
    }
    resolveAndDrawLabels(ctx,labels,v.width,v.height);ctx.restore();
  },
  formatFormulas:(s,p)=>{
    const o=computeObservables(s,p);
    return p.mode==='betatron-vortex'?[
      {id:'vortex-law',label:'逆时针为正的感生环流',latex:'\\oint\\mathbf E\\cdot d\\mathbf l=-\\dot B A_{\\rm overlap}',substitutedLatex:'\\dot B='+p.bDotRate.toFixed(2)+'\\,\\mathrm{T/s},\\quad |E|='+o.eVortexMag!.toFixed(3)+'\\,\\mathrm{V/m}'},
      {id:'vortex-field',label:'柱内正比 r；柱外反比 r',latex:'E_\\theta=\\begin{cases}-\\dot B r/2&r\\le R\\\\-\\dot B R^2/(2r)&r>R\\end{cases}',substitutedLatex:'r='+o.particleRadius!.toFixed(3)+'\\,\\mathrm m,\\quad B_{\\rm local}='+o.bLocal!.toFixed(3)+'\\,\\mathrm T'},
      {id:'vortex-energy',label:'单位质量功—能关系',latex:'\\Delta(K/m)=\\int (q/m)\\mathbf E\\cdot\\mathbf v\\,dt',substitutedLatex:'K/m='+o.specificKineticEnergy!.toFixed(4)+'\\,\\mathrm{J/kg}'}
    ]:[
      {id:'damping-equation',label:'等效线性阻尼率，非完整涡流求解',latex:'\\ddot\\theta=-g\\sin\\theta/L-2\\gamma f(\\theta)\\dot\\theta',substitutedLatex:'\\gamma_s='+p.solidDampingGamma.toFixed(2)+',\\quad\\gamma_l='+p.slottedDampingGamma.toFixed(2)},
      {id:'damping-energy',label:'各自的机械能与耗散热（单位质量）',latex:'(E+Q)/m=E_0/m,\\quad\\dot Q/m=2\\gamma f L^2\\omega^2',substitutedLatex:'Q_s/m='+o.solidHeatSpecific!.toFixed(3)+',\\quad Q_l/m='+o.slottedHeatSpecific!.toFixed(3)+'\\,\\mathrm{J/kg}'}
    ];
  }
}),{fitEddyViewport,eddyBoundsFit,eddyDiagramBounds});
export default emEddyVortexFieldPlugin;
