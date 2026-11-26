import type { LiveFormulaSpec } from '@physforge/sim-sdk';
import { CLASSROOM_GRAVITY } from '@physforge/physics-core';
import { createWorldMapper, defineSimulationPlugin, resolveAndDrawLabels, type CanvasLabel, type DiagramPrimitive, type ParamFieldSpec, type TelemetryChannelSpec, type Viewport } from '@physforge/sim-sdk';
import { wireframePresets } from './presets.js';
import {
  checkInvariants,
  fieldAtWorldY,
  computeObservables,
  createInitialState,
  stepWireframeRotation,
  type WireframeParams,
  type WireframeState
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<WireframeParams>[] = [
  {
    key: 'mode',
    kind: 'select',
    label: '切割类型',
    defaultValue: 'wireframe-gravity-fall',
    options: [
      { value: 'wireframe-gravity-fall', label: '闭合线框进出多区域磁场' },
      { value: 'rotating-rod', label: '金属棒绕端点转动切割' },
      { value: 'faraday-disk', label: '法拉第铜盘发电机' }
    ]
  },
  {
    key: 'loopShape',
    kind: 'select',
    label: '线框几何形状',
    defaultValue: 'square',
    options: [
      { value: 'square', label: '正方形线框' },
      { value: 'triangle', label: '底边在下的三角形线框' },
      { value: 'circle', label: '圆形线框' }
    ]
  },
  {
    key: 'fieldProfile',
    kind: 'select',
    label: '磁场区域分布',
    defaultValue: 'dual-opposite',
    options: [
      { value: 'single-zone', label: '单一匀强磁场区' },
      { value: 'dual-opposite', label: '反向双区域磁场 (+B / -B)' },
      { value: 'linear-gradient', label: '竖直梯度变化磁场 B(y)' }
    ]
  },
  { key: 'magneticB', kind: 'number', label: '有向磁感应强度 B₀', unit: 'T', min: -3, max: 3, step: 0.1, defaultValue: 1.5 },
  { key: 'loopSizeL', kind: 'number', label: '线框尺寸/杆长 L', unit: 'm', min: 0.3, max: 1.4, step: 0.1, defaultValue: 0.8 },
  { key: 'zoneHeightH', kind: 'number', label: '单磁场区高度 H', unit: 'm', min: 0.5, max: 2.0, step: 0.1, defaultValue: 1.0 },
  { key: 'massM', kind: 'number', label: '线框质量 m', unit: 'kg', min: 0.1, max: 3, step: 0.1, defaultValue: 0.5 },
  { key: 'resistanceR', kind: 'number', label: '线框总电阻 R', unit: 'Ω', min: 0.2, max: 5, step: 0.2, defaultValue: 1.0 },
  { key: 'initialVy', kind: 'number', label: '初始下落速度 v₀', unit: 'm/s', min: 0, max: 6, step: 0.5, defaultValue: 2.0 },
  { key: 'omegaRadS', kind: 'number', label: '有向转动角速度 ω', unit: 'rad/s', min: -10, max: 10, step: 0.5, defaultValue: 4.0 },
  { key: 'gravityEnabled', kind: 'boolean', label: '包含重力自由下落', defaultValue: true }
];


const liveFormulas: readonly LiveFormulaSpec[] = [{
  "id": "induced-current",
  "title": "纯电阻闭合线框的感应电流",
  "latex": "I=\\frac{\\mathcal E}{\\htmlClass{pf-live-var}{\\htmlData{param=resistanceR}{R}}}",
  "bindings": [
    {
      "tokenKey": "resistanceR",
      "paramKey": "resistanceR",
      "label": "线框总电阻 R",
      "unit": "Ω",
      "min": 0.2,
      "max": 5,
      "step": 0.2,
      "precision": 2
    }
  ]
}];

const channels:readonly TelemetryChannelSpec[]=[
  {key:'fluxWb',label:'实际磁通 Φ',unit:'Wb',color:'#38bdf8'},
  {key:'emfV',label:'有向感应电动势',unit:'V',color:'#fbbf24'},
  {key:'currentA',label:'有向感应电流',unit:'A',color:'#4ade80'},
  {key:'ampereForceN',label:'有向安培力 Fᵧ',unit:'N',color:'#f472b6'},
  {key:'centerY',label:'线框中心 y',unit:'m',color:'#a78bfa'},
  {key:'vy',label:'有向速度 vᵧ',unit:'m/s',color:'#60a5fa'},
  {key:'cuttingFactorWbPerM',label:'磁通梯度 G',unit:'Wb/m',color:'#f472b6'},
  {key:'jouleHeatJ',label:'累计焦耳热 Q',unit:'J',color:'#fb923c'},
  {key:'sweptFluxWb',label:'累计扫过磁通（非盘面）',unit:'Wb',color:'#38bdf8'},
  {key:'emTorqueNm',label:'有向制动力矩',unit:'N·m',color:'#f472b6'},
  {key:'drivePowerW',label:'外部恒速驱动功率',unit:'W',color:'#4ade80'},
  {key:'driveWorkJ',label:'外部驱动功',unit:'J',color:'#fbbf24'}
];
export interface WireSafeRect{left:number;right:number;top:number;bottom:number}
export function wireDiagramBounds(s:WireframeState,p:WireframeParams){
  const L=Math.max(.2,p.loopSizeL),H=Math.max(.4,p.zoneHeightH);
  if(p.mode!=='wireframe-gravity-fall')return {minX:-1.6*L,maxX:2.5*L,minY:-1.65*L,maxY:1.65*L};
  const low=p.fieldProfile==='single-zone'?-H:-2*H,follow=s.centerY<low-2.5*L;
  return {minX:-Math.max(1.65,1.6*L),maxX:Math.max(1.65,1.6*L),
    minY:follow?s.centerY-1.25*L:Math.min(low-.2,s.centerY-L*.8),
    maxY:follow?s.centerY+1.25*L:Math.max(.2,s.centerY+L*.8)};
}
export function fitWireViewport(s:WireframeState,p:WireframeParams,v:Viewport,safe:WireSafeRect):Viewport|null{
  const b=wireDiagramBounds(s,p),w=safe.right-safe.left,h=safe.bottom-safe.top;
  if(w<140||h<120)return null;
  const ppm=Math.min((w-100)/(b.maxX-b.minX),(h-70)/(b.maxY-b.minY));
  if(!Number.isFinite(ppm)||ppm<=0)return null;
  return {...v,scale:ppm/(.24*Math.min(v.width,v.height)),offsetX:(safe.left+safe.right)/2-(b.minX+b.maxX)*ppm/2-.45*v.width,
    offsetY:(safe.top+safe.bottom)/2+(b.minY+b.maxY)*ppm/2-.5*v.height};
}
export function wireBoundsFit(s:WireframeState,p:WireframeParams,v:Viewport,safe:WireSafeRect){
  const b=wireDiagramBounds(s,p),m=createWorldMapper(v);
  return m.toX(b.minX)>=safe.left+25&&m.toX(b.maxX)<=safe.right-25&&m.toY(b.maxY)>=safe.top+20&&m.toY(b.minY)<=safe.bottom-20;
}
function initialView(p:WireframeParams,v:{width:number;height:number}){
  const full={...v,dpr:1,scale:1,offsetX:0,offsetY:0},q=fitWireViewport(createInitialState(p),p,full,{left:30,right:v.width-30,top:25,bottom:v.height-25})??full;
  return {scale:q.scale,offsetRatioX:q.offsetX/v.width,offsetRatioY:q.offsetY/v.height};
}
function outline(y:number,L:number,shape:WireframeParams['loopShape']):{x:number;y:number}[]{
  const r=L/2;
  if(shape==='triangle')return [{x:0,y:y+r},{x:-r,y:y-r},{x:r,y:y-r},{x:0,y:y+r}];
  return [{x:-r,y:y+r},{x:r,y:y+r},{x:r,y:y-r},{x:-r,y:y-r},{x:-r,y:y+r}];
}
export const emWireframeRotationPlugin = Object.assign(defineSimulationPlugin<WireframeParams, WireframeState>({
  meta: {
    id: 'em-wireframe-rotation',
    title: '线框进出多区域磁场与旋转切割 (E05)',
    textbookRef: '人教版 选择性必修二 第二章',
    curriculumTags: ['物理观念', '科学思维', '科学探究'],
    difficulty: '压轴专题',
    version: '2.0.0'
  },
  defaultView:{minScale:.0001,scale:(p,v)=>initialView(p,v).scale,offsetRatioX:(p,v)=>initialView(p,v).offsetRatioX,offsetRatioY:(p,v)=>initialView(p,v).offsetRatioY},
  paramSchema,
  getParamFields:p=>{
    const keys=p.mode==='wireframe-gravity-fall'?['mode','loopShape','fieldProfile','magneticB','loopSizeL','massM','resistanceR','zoneHeightH','initialVy','gravityEnabled']:
      ['mode','magneticB','loopSizeL','omegaRadS','resistanceR'];
    return keys.flatMap(key=>paramSchema.filter(f=>f.key===key).map(f=>f.key==='loopSizeL'&&p.mode!=='wireframe-gravity-fall'?{...f,label:p.mode==='faraday-disk'?'圆盘真实半径':'转动杆全长'}:f));
  },
  presets: wireframePresets,
  engine: {
    createInitialState,
    step: stepWireframeRotation,
    computeObservables,
    checkInvariants
  },
  layers: [
    { id: 'fields', label: '单/双/梯度磁场区域', defaultVisible: true },
    { id: 'conductor', label: '闭合线框或旋转导体', defaultVisible: true }
  ],
  telemetryChannels:channels,
  getTelemetryChannels:p=>{
    const keys=p.mode==='wireframe-gravity-fall'?['fluxWb','emfV','currentA','ampereForceN','centerY','vy','cuttingFactorWbPerM','jouleHeatJ']:
      ['emfV','emTorqueNm','currentA','drivePowerW','driveWorkJ','jouleHeatJ','sweptFluxWb',...(p.mode==='faraday-disk'?['fluxWb']:[])];
    return keys.flatMap(key=>channels.filter(c=>c.key===key));
  },
  getForceVectors: (state, params) =>
    params.mode === 'wireframe-gravity-fall'
      ? [
          {
            id: 'mg',
            label: 'mg',
            origin: { x: 0, y: state.centerY },
            force: { x: 0, y: params.gravityEnabled ? -params.massM * CLASSROOM_GRAVITY : 0 },
            category: 'gravity',
            color: '#f59e0b'
          },
          {
            id: 'ampere',
            label: 'F安',
            origin: { x: 0, y: state.centerY },
            force: { x: 0, y: state.ampereForceN },
            category: 'magnetic',
            color: '#fb7185'
          }
        ]
      : [],
  referenceFrames:[{id:'loop-comoving',label:'平动线框随动系',getOrigin:(s,p)=>({x:0,y:p.mode==='wireframe-gravity-fall'?s.centerY:0}),
    getVelocity:(s,p)=>({x:0,y:p.mode==='wireframe-gravity-fall'?s.vy:0})}],
  getControlHandles:(s,p)=>{
    const fall=p.mode==='wireframe-gravity-fall',L=p.loopSizeL;
    return [{id:'loop-size',label:(fall?'L=':'半径/全长=')+L.toFixed(1)+'m',position:fall?{x:L/2,y:s.centerY}:{x:L*Math.cos(s.angleRad),y:L*Math.sin(s.angleRad)},
      handleKind:'radius',showWhenIdle:false,color:'#38bdf8',onDrag:wp=>({loopSizeL:Number(Math.max(.3,Math.min(1.4,fall?Math.abs(wp.x)*2:Math.hypot(wp.x,wp.y))).toFixed(1))})}];
  },
  sceneSerializer: {
    exportScene: (_s, params) => ({
      schemaVersion: '2.0',
      modelId: 'em-wireframe-rotation',
      title: '线框进出磁场与旋转切割',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<WireframeParams>
  },
  exportDiagramIR:(s,p)=>{
    const L=p.loopSizeL,H=p.zoneHeightH,primitives:DiagramPrimitive[]=[];
    if(p.mode==='wireframe-gravity-fall'){
      const low=p.fieldProfile==='single-zone'?-H:-2*H;
      if(s.centerY>=low-2.5*L){
        if(p.fieldProfile==='linear-gradient')primitives.push({kind:'rect',x:-1.5,y:-2*H,width:3,height:2*H,dashed:true,hatch:true},
          {kind:'text',x:-1.4,y:-H,text:'梯度 B(y)'});
        else{
          primitives.push({kind:'rect',x:-1.5,y:-H,width:3,height:H,dashed:true,hatch:true},
            {kind:'text',x:-1.4,y:-H/2,text:'B='+p.magneticB.toFixed(1)+' T'});
          if(p.fieldProfile==='dual-opposite')primitives.push({kind:'rect',x:-1.5,y:-2*H,width:3,height:H,dashed:true,hatch:true},
            {kind:'text',x:-1.4,y:-1.5*H,text:'−B'});
        }
      }
      if(p.loopShape==='circle')primitives.push({kind:'circle',cx:0,cy:s.centerY,r:L/2});
      else primitives.push({kind:'polyline',points:outline(s.centerY,L,p.loopShape)});
      primitives.push({kind:'text',x:0,y:s.centerY+.72*L,text:'y='+s.centerY.toFixed(3)+'m',align:'middle'});
    }else{
      if(p.mode==='faraday-disk')primitives.push({kind:'circle',cx:0,cy:0,r:L});
      else primitives.push({kind:'circle',cx:0,cy:0,r:L,dashed:true});
      primitives.push({kind:'circle',cx:0,cy:0,r:.035,fill:true},{kind:'line',x1:0,y1:0,x2:L*Math.cos(s.angleRad),y2:L*Math.sin(s.angleRad),strokeWidth:3},
        {kind:'text',x:0,y:L*1.2,text:'B='+p.magneticB.toFixed(1)+'T · ω='+p.omegaRadS.toFixed(1)+'rad/s',align:'middle'},
        {kind:'text',x:0,y:-L*1.2,text:'ℰ='+s.emfV.toFixed(3)+'V · τ='+s.emTorqueNm.toFixed(3)+'N·m',align:'middle'});
    }
    return {width:820,height:500,viewBox:wireDiagramBounds(s,p),title:'线框电磁感应 · 当前物理状态',primitives};
  },
  renderCanvas:(ctx,s,p,v,layers)=>{
    const m=createWorldMapper(v),paper=v.theme==='projector',ink=paper?'#0f172a':'#e2e8f0',muted=paper?'#475569':'#94a3b8',gold=paper?'#92400e':'#fbbf24',
      blue=paper?'#0369a1':'#38bdf8',rose=paper?'#be123c':'#fb7185',labels:CanvasLabel[]=[];
    const label=(id:string,x:number,y:number,text:string,color=ink,font='13px sans-serif')=>{const pt=m.toScreen(x,y);labels.push({id,x:pt.x,y:pt.y,text,color,font});};
    const line=(x1:number,y1:number,x2:number,y2:number,color:string,w=1.6,dash=false)=>{
      const a=m.toScreen(x1,y1),b=m.toScreen(x2,y2);ctx.strokeStyle=color;ctx.lineWidth=w;ctx.setLineDash(dash?[5,4]:[]);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.setLineDash([]);
    };
    const circle=(x:number,y:number,r:number,color:string,fill=false)=>{
      const pt=m.toScreen(x,y);ctx.beginPath();ctx.arc(pt.x,pt.y,Math.max(2,m.len(r)),0,2*Math.PI);if(fill){ctx.fillStyle=color;ctx.fill();}else{ctx.strokeStyle=color;ctx.stroke();}
    };
    const arrow=(x1:number,y1:number,x2:number,y2:number,color:string)=>{
      const a=m.toScreen(x1,y1),b=m.toScreen(x2,y2),dx=b.x-a.x,dy=b.y-a.y,n=Math.hypot(dx,dy);if(n<1e-7)return;
      line(x1,y1,x2,y2,color,2);const ux=dx/n,uy=dy/n,h=Math.min(9,n*.3);ctx.fillStyle=color;ctx.beginPath();ctx.moveTo(b.x,b.y);ctx.lineTo(b.x-h*ux+h*.45*uy,b.y-h*uy-h*.45*ux);ctx.lineTo(b.x-h*ux-h*.45*uy,b.y-h*uy+h*.45*ux);ctx.closePath();ctx.fill();
    };
    const L=p.loopSizeL,H=p.zoneHeightH;
    ctx.save();
    if(p.mode!=='wireframe-gravity-fall'){
      const c=m.toScreen(0,0),r=m.len(L);
      if(layers.has('fields')){
        const fieldColor=p.magneticB>=0?blue:rose;
        if(p.magneticB!==0)for(let ix=-2;ix<=2;ix++)for(let iy=-2;iy<=2;iy++){
          const x=ix*L*.48,y=iy*L*.48;if(x*x+y*y>L*L)continue;
          const q=m.toScreen(x,y);ctx.strokeStyle=fieldColor;ctx.fillStyle=fieldColor;ctx.lineWidth=1.1;
          ctx.beginPath();ctx.arc(q.x,q.y,5,0,Math.PI*2);ctx.stroke();
          if(p.magneticB>0){ctx.beginPath();ctx.arc(q.x,q.y,1.5,0,Math.PI*2);ctx.fill();}
          else{ctx.beginPath();ctx.moveTo(q.x-3,q.y-3);ctx.lineTo(q.x+3,q.y+3);ctx.moveTo(q.x+3,q.y-3);ctx.lineTo(q.x-3,q.y+3);ctx.stroke();}
        }
      }
      if(layers.has('conductor')){
        if(p.mode==='faraday-disk'){
          const grad=ctx.createRadialGradient(c.x-r*.4,c.y-r*.4,0,c.x,c.y,r);
          grad.addColorStop(0,paper?'#fde68a':'#fbd38d');grad.addColorStop(.5,paper?'#b45309':'#b46b25');grad.addColorStop(1,paper?'#92400e':'#4b2513');
          ctx.save();ctx.globalAlpha=.72;ctx.fillStyle=grad;ctx.strokeStyle=gold;ctx.lineWidth=2;ctx.beginPath();ctx.arc(c.x,c.y,r,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.restore();
        }else{ctx.setLineDash([5,5]);ctx.lineWidth=1;circle(0,0,L,muted);ctx.setLineDash([]);}
        const x=L*Math.cos(s.angleRad),y=L*Math.sin(s.angleRad);
        ctx.save();if(!paper){ctx.shadowColor=gold;ctx.shadowBlur=8;}line(0,0,x,y,gold,5);ctx.restore();
        circle(0,0,L*.035,ink,true);circle(x,y,L*.04,ink,true);
        label('rod-L',x*.52,y*.52,'L='+L.toFixed(2)+'m',ink);
        if(s.currentA!==0){const a=s.currentA>0?.2:.68,b=s.currentA>0?.68:.2;arrow(x*a,y*a,x*b,y*b,rose);}
        // A fixed brush/load loop is a circuit schematic; no rotating return wire is implied.
        const bx=1.38*L,by=.72*L;
        line(0,0,bx,0,muted,1,true);line(bx,0,bx,by,muted,1,true);line(bx,by,1.92*L,by,muted,1,true);
        line(1.92*L,by,1.92*L,-by,muted,1,true);line(1.92*L,-by,bx,-by,muted,1,true);line(bx,-by,L,0,muted,1,true);
        const a=m.toScreen(1.78*L,.18*L),b=m.toScreen(2.06*L,-.18*L);ctx.fillStyle=paper?'#f8fafc':'#1e293b';ctx.strokeStyle=muted;ctx.fillRect(a.x,a.y,b.x-a.x,b.y-a.y);ctx.strokeRect(a.x,a.y,b.x-a.x,b.y-a.y);
        label('load',2.07*L,0,'R='+p.resistanceR.toFixed(1)+'Ω · 示意',ink);
        label('rotation',0,1.34*L,'恒速驱动 · ω='+p.omegaRadS.toFixed(2)+' rad/s',ink,'bold 14px sans-serif');
        label('rotation-emf',0,-1.25*L,'ℰ='+s.emfV.toFixed(3)+' V · τ='+s.emTorqueNm.toFixed(3)+' N·m',gold);
        label('rotation-work',0,-1.5*L,'P驱动='+s.drivePowerW.toFixed(3)+' W',muted);
      }
      resolveAndDrawLabels(ctx,labels,v.width,v.height);ctx.restore();return;
    }
    const low=p.fieldProfile==='single-zone'?-H:-2*H,follow=s.centerY<low-2.5*L;
    if(layers.has('fields')&&!follow){
      const left=-1.5,right=1.5,parts=p.fieldProfile==='single-zone'?[[0,-H]]:p.fieldProfile==='linear-gradient'?[[0,-2*H]]:[[0,-H],[-H,-2*H]];
      for(let j=0;j<parts.length;j++){
        const [top,bottom]=parts[j]!,B=fieldAtWorldY((top!+bottom!)/2,p),color=B>=0?blue:rose;
        const a=m.toScreen(left,top!),b=m.toScreen(right,bottom!);
        const grad=ctx.createLinearGradient(0,a.y,0,b.y);grad.addColorStop(0,B===0?'rgba(148,163,184,.03)':B>0?'rgba(56,189,248,.08)':'rgba(244,114,182,.08)');
        grad.addColorStop(1,B===0?'rgba(148,163,184,.03)':B>0?'rgba(56,189,248,.18)':'rgba(244,114,182,.18)');
        ctx.fillStyle=grad;ctx.fillRect(a.x,a.y,b.x-a.x,b.y-a.y);line(left,top!,right,top!,muted,1,true);line(left,bottom!,right,bottom!,muted,1,true);
        if(B!==0)for(let ix=0;ix<7;ix++)for(let iy=0;iy<(p.fieldProfile==='linear-gradient'?6:3);iy++){
          const x=left+(ix+.5)*(right-left)/7,y=top!+(bottom!-top!)*(iy+.5)/(p.fieldProfile==='linear-gradient'?6:3),pt=m.toScreen(x,y),sign=Math.sign(fieldAtWorldY(y,p));
          ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=1.1;ctx.beginPath();ctx.arc(pt.x,pt.y,4,0,Math.PI*2);ctx.stroke();
          if(sign>0){ctx.beginPath();ctx.arc(pt.x,pt.y,1.2,0,Math.PI*2);ctx.fill();}
          else if(sign<0){ctx.beginPath();ctx.moveTo(pt.x-2.5,pt.y-2.5);ctx.lineTo(pt.x+2.5,pt.y+2.5);ctx.moveTo(pt.x+2.5,pt.y-2.5);ctx.lineTo(pt.x-2.5,pt.y+2.5);ctx.stroke();}
        }
        label('zone-'+j,-1.22,(top!+bottom!)/2,p.fieldProfile==='linear-gradient'?'B(y) · '+B.toFixed(2)+' T（中点）':'B='+B.toFixed(2)+' T',color);
      }
    }
    if(layers.has('conductor')){
      const cy=s.centerY,half=L/2;
      ctx.save();ctx.lineWidth=3.6;if(!paper){ctx.shadowColor=gold;ctx.shadowBlur=9;}
      if(p.loopShape==='circle')circle(0,cy,half,gold);
      else {const pts=outline(cy,L,p.loopShape);ctx.strokeStyle=gold;ctx.beginPath();pts.forEach((q,i)=>{const pt=m.toScreen(q.x,q.y);if(i===0)ctx.moveTo(pt.x,pt.y);else ctx.lineTo(pt.x,pt.y);});ctx.stroke();}
      ctx.restore();
      circle(0,cy,.025,ink,true);
      if(s.currentA!==0){
        const dir=Math.sign(s.currentA);
        if(p.loopShape==='square')arrow(-half,cy+half*.35*dir,-half,cy-half*.35*dir,rose);
        else if(p.loopShape==='triangle'){
          const a=dir>0?.38:.72,b=dir>0?.72:.38;
          arrow(-half*a,cy+half-L*a,-half*b,cy+half-L*b,rose);
        }else{
          const a=Math.PI-.32*dir,b=Math.PI+.32*dir;
          arrow(half*Math.cos(a),cy+half*Math.sin(a),half*Math.cos(b),cy+half*Math.sin(b),rose);
        }
      }
      if(s.vy!==0)arrow(half+.16,cy,half+.16,cy+Math.sign(s.vy)*half*.72,blue);
      label('loop-y',0,cy+half+.16,'y='+cy.toFixed(3)+' m · vᵧ='+s.vy.toFixed(3)+' m/s',ink);
      label('loop-emf',0,cy-half-.18,'Φ='+s.fluxWb.toFixed(3)+' Wb · ℰ='+s.emfV.toFixed(3)+' V',gold);
      if(follow)label('off-field',0,cy+L,'磁区已在上方 · 实际 y 连续推进',muted);
    }
    resolveAndDrawLabels(ctx,labels,v.width,v.height);ctx.restore();
  },
  formatFormulas:(s,p)=>p.mode==='wireframe-gravity-fall'?[
    {id:'wireframe-emf',label:'平动磁通梯度与感应电动势',latex:'G=d\\Phi/dy,\\quad\\mathcal E=-Gv,\\quad I=\\mathcal E/R',substitutedLatex:'\\Phi='+s.fluxWb.toFixed(3)+'\\,\\mathrm{Wb},\\quad\\mathcal E='+s.emfV.toFixed(3)+'\\,\\mathrm V'},
    {id:'wire-force',label:'安培力机械功率为负',latex:'F_y=GI=-G^2v/R,\\quad F_yv=-I^2R',substitutedLatex:'F_y='+s.ampereForceN.toFixed(3)+'\\,\\mathrm N'}
  ]:[
    {id:'rot-emf',label:'轴心到外缘运动电动势',latex:'\\mathcal E=\\frac12 B\\omega L^2,\\quad I=\\mathcal E/R',substitutedLatex:'\\mathcal E='+s.emfV.toFixed(3)+'\\,\\mathrm V'},
    {id:'rot-power',label:'恒速外部驱动与制动力矩',latex:'\\tau=-\\frac12 BIL^2,\\quad P_{\\rm drive}=-\\tau\\omega=I^2R',substitutedLatex:'\\tau='+s.emTorqueNm.toFixed(3)+'\\,\\mathrm{N\\cdot m},\\quad P='+s.drivePowerW.toFixed(3)+'\\,\\mathrm W'},
    ...(p.mode==='faraday-disk'?[{id:'disk-flux',label:'盘面实际磁通不变',latex:'\\Phi_{\\rm disk}=B\\pi L^2',substitutedLatex:'\\Phi='+s.fluxWb.toFixed(3)+'\\,\\mathrm{Wb}'}]:[])
  ]
}), {liveFormulas,fitWireViewport,wireBoundsFit,wireDiagramBounds});

export default emWireframeRotationPlugin;
