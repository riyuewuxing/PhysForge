import { createWorldMapper,defineSimulationPlugin,resolveAndDrawLabels,type ParamFieldSpec,type TelemetryChannelSpec } from '@physforge/sim-sdk';
import { collisionRecoilPresets } from './presets.js';
import { checkInvariants,computeObservables,createInitialState,stepCollisionRecoil,type CollisionRecoilParams,type CollisionRecoilState } from './engine.js';
import { collisionDiagram,collisionForceVectors,collisionInitialView,fitCollisionViewport,collisionBoundsFit,type CollisionRole } from './diagram.js';
const paramSchema: readonly ParamFieldSpec<CollisionRecoilParams>[] = [
  {
    key: 'mode',
    kind: 'select',
    label: '物理模型',
    defaultValue: 'collision-2d-oblique',
    options: [
      { value: 'collision-2d-oblique', label: '二维非对心斜碰' },
      { value: 'collision-1d', label: '一维正碰 (e∈[0,1])' },
      { value: 'bullet-block', label: '子弹打木块' },
      { value: 'boat-recoil', label: '人船反冲（质心守恒）' }
    ]
  },
  { key: 'mass1', kind: 'number', label: '物体1 / 人质量 m₁', unit: 'kg', min: 0.2, max: 6, step: 0.2, defaultValue: 2 },
  { key: 'mass2', kind: 'number', label: '物体2 / 船质量 m₂', unit: 'kg', min: 0.5, max: 8, step: 0.5, defaultValue: 2 },
  { key: 'v10', kind: 'number', label: '初速度 / 峰值相对速度 v₁₀', unit: 'm/s', min: 0, max: 10, step: 0.5, defaultValue: 4 },
  { key: 'v20', kind: 'number', label: '2号球初速度 v₂₀', unit: 'm/s', min: -5, max: 5, step: 0.5, defaultValue: 0 },
  { key: 'restitutionE', kind: 'number', label: '恢复系数 e', unit: '', min: 0, max: 1, step: 0.05, defaultValue: 1 },
  { key: 'impactParamB', kind: 'number', label: '斜碰瞄准距 b', unit: 'm', min: -1.2, max: 1.2, step: 0.02, defaultValue: 0.36 },
  { key: 'radius1', kind: 'number', label: '1号球半径 R₁', unit: 'm', min: 0.12, max: 0.5, step: 0.02, defaultValue: 0.3 },
  { key: 'radius2', kind: 'number', label: '2号球半径 R₂', unit: 'm', min: 0.12, max: 0.5, step: 0.02, defaultValue: 0.3 },
  { key: 'dragForceF', kind: 'number', label: '木块内部阻力 f', unit: 'N', min: 0, max: 30, step: 2, defaultValue: 10 },
  { key: 'blockLength', kind: 'number', label: '木块 / 船长 L', unit: 'm', min: 1, max: 4, step: 0.2, defaultValue: 2 }
];


const px:TelemetryChannelSpec={key:'px',label:'总动量 p_x',unit:'kg·m/s',color:'#38bdf8'};
const py:TelemetryChannelSpec={key:'py',label:'总动量 p_y',unit:'kg·m/s',color:'#f472b6'};
const ek:TelemetryChannelSpec={key:'ek',label:'总动能 K',unit:'J',color:'#4ade80'};
const heat:TelemetryChannelSpec={key:'heatLostJ',label:'内能损耗 Q',unit:'J',color:'#fbbf24'};
const relPos:TelemetryChannelSpec={key:'relativePosition',label:'人相对船位置',unit:'m',color:'#38bdf8'};
const relSpeed:TelemetryChannelSpec={key:'relativeSpeed',label:'沿 x 相对速度',unit:'m/s',color:'#a78bfa'};
const cm:TelemetryChannelSpec={key:'xCm',label:'系统质心 x_cm',unit:'m',color:'#f472b6'};
const depth:TelemetryChannelSpec={key:'penetrationDist',label:'实际穿行深度',unit:'m',color:'#38bdf8'};
const vx1:TelemetryChannelSpec={key:'vx1',label:'物体1 x速度',unit:'m/s',color:'#38bdf8'};
const vx2:TelemetryChannelSpec={key:'vx2',label:'物体2 x速度',unit:'m/s',color:'#f472b6'};
const all=[px,py,ek,heat,relPos,relSpeed,cm,depth,vx1,vx2];
export const mechCollisionRecoilPlugin=Object.assign(defineSimulationPlugin<CollisionRecoilParams,CollisionRecoilState>({
  meta:{id:'mech-collision-recoil',title:'碰撞、斜碰与反冲动量模型 (M09)',textbookRef:'人教版 选择性必修一 第一章',curriculumTags:['物理观念','科学思维','科学探究'],difficulty:'压轴专题',version:'2.0.0'},
  defaultView:{minScale:.00001,scale:(p,v)=>collisionInitialView(createInitialState(p),p,v).scale,offsetRatioX:(p,v)=>collisionInitialView(createInitialState(p),p,v).offsetRatioX,offsetRatioY:(p,v)=>collisionInitialView(createInitialState(p),p,v).offsetRatioY},
  paramSchema,presets:collisionRecoilPresets,engine:{createInitialState,step:stepCollisionRecoil,computeObservables,checkInvariants},
  getParamFields:p=>paramSchema.filter(f=>['mode','mass1','mass2','v10'].includes(f.key)||p.mode==='boat-recoil'&&f.key==='blockLength'||p.mode==='bullet-block'&&['dragForceF','blockLength'].includes(f.key)||p.mode==='collision-1d'&&['v20','radius1','radius2','restitutionE'].includes(f.key)||p.mode==='collision-2d-oblique'&&['impactParamB','radius1','radius2','restitutionE'].includes(f.key)),
  layers:[{id:'bodies',label:'真实物体与平面几何',defaultVisible:true},{id:'momentumTriangle',label:'同标尺动量矢量图',defaultVisible:true},{id:'cmLine',label:'真实质心轨迹 / 轴线',defaultVisible:true},{id:'construction',label:'速度与碰撞法向',defaultVisible:true},{id:'forces',label:'穿行阶段内力对',defaultVisible:false}],
  telemetryChannels:all,
  getTelemetryChannels:p=>p.mode==='boat-recoil'?[relPos,relSpeed,cm,px,vx1,vx2,ek]:p.mode==='bullet-block'?[depth,heat,relSpeed,px,ek,vx1,vx2]:[px,py,ek,heat,vx1,vx2,cm],
  getForceVectors:collisionForceVectors,
  referenceFrames:[{id:'cm',label:'质心平移参考系',description:'真实二维质心平移；动量矢量图仍标明地面惯性系。',getOrigin:(s,p)=>({x:(p.mass1*s.x1+p.mass2*s.x2)/(p.mass1+p.mass2),y:(p.mass1*s.y1+p.mass2*s.y2)/(p.mass1+p.mass2)}),getVelocity:(s,p)=>({x:s.pInitX/(p.mass1+p.mass2),y:s.pInitY/(p.mass1+p.mass2)})}],
  getControlHandles:(s,p)=>p.mode==='collision-2d-oblique'&&s.t===0?[{id:'impact-b',label:'b='+p.impactParamB.toFixed(2)+'m',position:{x:s.x1,y:s.y1},handleKind:'point',color:'#4ade80',onDrag:wp=>({impactParamB:Number(Math.max(-1.2,Math.min(1.2,wp.y)).toFixed(2))})}]:[],
  sceneSerializer:{exportScene:(_s,params)=>({schemaVersion:'2.0',modelId:'mech-collision-recoil',title:'碰撞与反冲',params}),importScene:dsl=>dsl.params as Partial<CollisionRecoilParams>},
  exportDiagramIR:(s,p,opts)=>{const d=collisionDiagram(s,p,opts);return {width:960,height:600,viewBox:d.bounds,title:'实际几何与动量矢量图',primitives:d.items.map(i=>i.primitive)};},
  formatFormulas:(s,p)=>{
    const o=computeObservables(s,p);
    const common={id:'momentum',label:'地面系总动量',latex:'\\mathbf p=\\mathbf p_1+\\mathbf p_2',substitutedLatex:'p_x='+o.px!.toFixed(3)+',\\quad p_y='+o.py!.toFixed(3)+'\\,\\mathrm{kg\\cdot m/s}'};
    if(p.mode==='boat-recoil')return [common,{id:'boat',label:'平滑相对行走 · 固定质心',latex:p.v10===0?'v_{\\max}=0,\\quad v_{\\rm rel}=0':'v_{\\rm rel}=v_{\\max}\\sin^2(\\pi t/T),\\quad T=2S/v_{\\max}',substitutedLatex:'x_{\\rm cm}='+o.xCm!.toFixed(3)+'\\,\\mathrm m,\\quad v_{\\rm rel}='+o.relativeSpeed!.toFixed(3)+'\\,\\mathrm{m/s}'},{id:'boat-energy',label:'内部驱动（机械动能不守恒）',latex:'K=\\tfrac12\\mu v_{\\rm rel}^2',substitutedLatex:'K='+o.ek!.toFixed(3)+'\\,\\mathrm J'}];
    if(p.mode==='bullet-block')return [common,{id:'penetration',label:'理想质点 · 实际内能损耗',latex:'Q=f d,\\quad K+Q=K_0',substitutedLatex:'d='+s.penetrationDist.toFixed(3)+'\\,\\mathrm m,\\quad Q='+s.heatLostJ.toFixed(3)+'\\,\\mathrm J'}];
    return [common,{id:'impulse',label:s.impact?'真实法向瞬时冲量':'接近条件与法向冲量',latex:'J_n=(1+e)\\mu(\\mathbf v_1-\\mathbf v_2)\\cdot\\hat{\\mathbf n}',...(s.impact?{substitutedLatex:'J_n='+s.impact.impulse.toFixed(3)+'\\,\\mathrm{N\\cdot s}'}:{})},
      {id:'loss',label:'动能与内能损耗',latex:'K+Q=K_0',substitutedLatex:'K='+o.ek!.toFixed(3)+',\\quad Q='+s.heatLostJ.toFixed(3)+'\\,\\mathrm J'},
      ...(s.impact&&p.mode==='collision-2d-oblique'?[{id:'dot',label:'碰后速度内积（非零速度正交条件）',latex:'\\mathbf v_1\\cdot\\mathbf v_2',substitutedLatex:o.vDotProduct!.toFixed(6)+'\\,\\mathrm{m^2/s^2}'}]:[])];
  },
  renderCanvas:(ctx,s,p,vp,layers)=>{
    const m=createWorldMapper(vp),d=collisionDiagram(s,p),paper=vp.theme==='projector';
    const palette:Record<CollisionRole,string>=paper?{track:'#64748b',body1:'#0369a1',body2:'#be185d',block:'#92400e',boat:'#0369a1',person:'#be185d',velocity1:'#0369a1',velocity2:'#be185d',p1:'#0369a1',p2:'#be185d',total:'#166534',axis:'#475569',ink:'#0f172a',guide:'#64748b',event:'#b45309',ghost:'#94a3b8',force:'#9d174d',heat:'#b45309',cm:'#be185d'}:{track:'#64748b',body1:'#38bdf8',body2:'#f472b6',block:'#d97706',boat:'#38bdf8',person:'#f472b6',velocity1:'#38bdf8',velocity2:'#f472b6',p1:'#38bdf8',p2:'#f472b6',total:'#4ade80',axis:'#cbd5e1',ink:'#e2e8f0',guide:'#94a3b8',event:'#fbbf24',ghost:'#64748b',force:'#c4b5fd',heat:'#fbbf24',cm:'#fb7185'};
    const labels:Array<{id:string;x:number;y:number;text:string;color:string;font:string}>=[];
    for(const [i,{primitive:q,role,layer}] of d.items.entries()){
      if(layer!=='always'&&!layers.has(layer))continue;
      const color=palette[role];ctx.save();ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=role==='heat'?3.3:role==='person'?2.4:1.7;
      if(q.kind==='line'||q.kind==='arrow'){
        const a=m.toScreen(q.x1,q.y1),b=m.toScreen(q.x2,q.y2);ctx.setLineDash(q.dashed?[5,5]:[]);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.setLineDash([]);
        if(q.kind==='arrow'){const ang=Math.atan2(b.y-a.y,b.x-a.x);if(Math.hypot(b.x-a.x,b.y-a.y)>2){ctx.beginPath();ctx.moveTo(b.x,b.y);ctx.lineTo(b.x-8*Math.cos(ang-.4),b.y-8*Math.sin(ang-.4));ctx.lineTo(b.x-8*Math.cos(ang+.4),b.y-8*Math.sin(ang+.4));ctx.closePath();ctx.fill();}if(q.label)labels.push({id:'arrow-'+i,x:(a.x+b.x)/2+Math.sin(ang)*14,y:(a.y+b.y)/2-Math.cos(ang)*14,text:q.label,color,font:'bold 13px sans-serif'});}
      }else if(q.kind==='circle'){
        const c=m.toScreen(q.cx,q.cy),r=m.len(q.r),rr=q.fill?Math.max(role==='body1'&&p.mode==='bullet-block'?3:1,r):r;
        ctx.setLineDash(q.dashed?[5,4]:[]);
        if(q.fill&&!paper&&(role==='body1'||role==='body2')&&r>3){const grad=ctx.createRadialGradient(c.x-.3*r,c.y-.34*r,.04*r,c.x,c.y,r);grad.addColorStop(0,'#e2e8f0');grad.addColorStop(.35,color);grad.addColorStop(1,role==='body1'?'#075985':'#9d174d');ctx.fillStyle=grad;ctx.shadowBlur=10;ctx.shadowColor=color;}
        ctx.beginPath();ctx.arc(c.x,c.y,rr,0,2*Math.PI);if(q.fill)ctx.fill();else ctx.stroke();
      }else if(q.kind==='rect'){
        const a=m.toScreen(q.x,q.y+q.height),ww=m.len(q.width),hh=m.len(q.height);if(!paper){const grad=ctx.createLinearGradient(a.x,a.y,a.x,a.y+hh);grad.addColorStop(0,'#e5c090');grad.addColorStop(.32,color);grad.addColorStop(1,'#78350f');ctx.fillStyle=grad;}else ctx.fillStyle='#f5deb3';
        ctx.fillRect(a.x,a.y,ww,hh);ctx.strokeRect(a.x,a.y,ww,hh);
      }else if(q.kind==='polyline'){
        const pts=q.points.map(pt=>m.toScreen(pt.x,pt.y));ctx.beginPath();pts.forEach((a,j)=>j===0?ctx.moveTo(a.x,a.y):ctx.lineTo(a.x,a.y));if(q.closed)ctx.closePath();
        if(role==='boat'){ctx.fillStyle=paper?'#bfdbfe':'#075985';ctx.fill();}ctx.stroke();
      }else if(q.kind==='text'){const c=m.toScreen(q.x,q.y);labels.push({id:'text-'+i,x:c.x,y:c.y,text:q.text,color,font:'13px sans-serif'});}
      ctx.restore();
    }
    resolveAndDrawLabels(ctx,labels.filter(l=>l.x>=0&&l.x<=vp.width&&l.y>=0&&l.y<=vp.height),vp.width,vp.height);
  }
}),{fitCollisionViewport,collisionBoundsFit});
export default mechCollisionRecoilPlugin;
