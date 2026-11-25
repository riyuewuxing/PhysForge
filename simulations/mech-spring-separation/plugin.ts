import { degToRad } from '@physforge/physics-core';
import { createWorldMapper,defineSimulationPlugin,resolveAndDrawLabels,type ParamFieldSpec } from '@physforge/sim-sdk';
import { springSepPresets } from './presets.js';
import { checkInvariants,computeObservables,createInitialState,stepSpringSeparation,type SpringSepParams,type SpringSepState } from './engine.js';
import { springDiagram,springForceVectors,springCoordinates,springInitialView,fitSpringViewport,springBoundsFit,BLOCK_HEIGHT,type SpringRole } from './diagram.js';
const paramSchema: readonly ParamFieldSpec<SpringSepParams>[] = [
  { key: 'mass1', kind: 'number', label: '连簧物块 m₁', unit: 'kg', min: 0.5, max: 5, step: 0.5, defaultValue: 1 },
  { key: 'mass2', kind: 'number', label: '接触物块 m₂', unit: 'kg', min: 0.5, max: 5, step: 0.5, defaultValue: 2 },
  { key: 'springK', kind: 'number', label: '弹簧劲度系数 k', unit: 'N/m', min: 10, max: 80, step: 5, defaultValue: 30 },
  { key: 'inclineDeg', kind: 'number', label: '斜面倾角 θ', unit: '°', min: 0, max: 45, step: 5, defaultValue: 0 },
  { key: 'initialComp', kind: 'number', label: '初始压缩量 x₀', unit: 'm', min: 0, max: 1.8, step: 0.1, defaultValue: 1 },
  { key: 'externalForce', kind: 'number', label: '右侧拉 m₂ 恒力 F', unit: 'N', min: 0, max: 30, step: 2, defaultValue: 0 }
];


export const mechSpringSeparationPlugin=Object.assign(defineSimulationPlugin<SpringSepParams,SpringSepState>({
  meta:{id:'mech-spring-separation',title:'含弹簧连接体与临界分离模型 (M08)',textbookRef:'人教版 必修第一册 第四章 & 必修二',curriculumTags:['物理观念','科学思维','科学探究'],difficulty:'压轴专题',version:'2.0.0'},
  defaultView:{minScale:.00001,scale:(p,v)=>springInitialView(createInitialState(p),p,v).scale,offsetRatioX:(p,v)=>springInitialView(createInitialState(p),p,v).offsetRatioX,offsetRatioY:(p,v)=>springInitialView(createInitialState(p),p,v).offsetRatioY},
  paramSchema,presets:springSepPresets,engine:{createInitialState,step:stepSpringSeparation,computeObservables,checkInvariants},
  layers:[{id:'spring',label:'真实弹簧与光滑面',defaultVisible:true},{id:'eventPins',label:'分离时刻与位置',defaultVisible:true},{id:'construction',label:'位移、间隙与速度',defaultVisible:true},{id:'forces',label:'实际受力矢量（同力标尺）',defaultVisible:false}],
  telemetryChannels:[
    {key:'normalForceN',label:'两块间接触力 Fₙ',unit:'N',color:'#fbbf24'},
    {key:'a1',label:'m₁ 加速度 a₁',unit:'m/s²',color:'#38bdf8'},
    {key:'a2',label:'m₂ 加速度 a₂',unit:'m/s²',color:'#f472b6'},
    {key:'v1',label:'m₁ 速度 v₁',unit:'m/s',color:'#38bdf8'},
    {key:'v2',label:'m₂ 速度 v₂',unit:'m/s',color:'#f472b6'},
    {key:'gap',label:'实际间隙',unit:'m',color:'#4ade80'},
    {key:'energy',label:'实际机械能 E',unit:'J',color:'#38bdf8'},
    {key:'externalWork',label:'外力功 W',unit:'J',color:'#a78bfa'},
    {key:'s1',label:'m₁ 位移 s₁',unit:'m',color:'#4ade80'}
  ],
  getControlHandles:(s,p)=>{
    if(s.t>0)return [];
    const {point,t}=springCoordinates(p);
    return [{id:'initial-compression',label:'x₀='+p.initialComp.toFixed(1)+'m',position:point(s.s1,BLOCK_HEIGHT/2),handleKind:'point',color:'#38bdf8',onDrag:wp=>({initialComp:Number(Math.max(0,Math.min(1.8,-(wp.x*t.x+wp.y*t.y))).toFixed(1))})}];
  },
  getForceVectors:springForceVectors,
  referenceFrames: [
    {
      id: 'cm-frame',
      label: '两物块质心平移系',
      description:'只平移坐标，不宣称质心速度守恒。',
      getOrigin: (s, p) => {
        const theta = degToRad(p.inclineDeg);
        const tangent = { x: Math.cos(theta), y: Math.sin(theta) };
        const normal = { x: -Math.sin(theta), y: Math.cos(theta) };
        const totalMass = p.mass1 + p.mass2;
        const along = (p.mass1 * s.s1 + p.mass2 * (s.s2 + 0.34)) / totalMass;
        return { x: along * tangent.x + 0.12 * normal.x, y: along * tangent.y + 0.12 * normal.y };
      },
      getVelocity: (s, p) => {
        const theta = degToRad(p.inclineDeg);
        const vCm = (p.mass1 * s.v1 + p.mass2 * s.v2) / (p.mass1 + p.mass2);
        return { x: vCm * Math.cos(theta), y: vCm * Math.sin(theta) };
      }
    },
    {
      id: 'block1-frame',
      label: '物块 1 平移参考系',
      getOrigin: (s, p) => {
        const theta = degToRad(p.inclineDeg);
        return { x: s.s1 * Math.cos(theta) - 0.12 * Math.sin(theta), y: s.s1 * Math.sin(theta) + 0.12 * Math.cos(theta) };
      },
      getVelocity: (s, p) => ({ x: s.v1 * Math.cos(degToRad(p.inclineDeg)), y: s.v1 * Math.sin(degToRad(p.inclineDeg)) })
    }
  ],

  sceneSerializer:{exportScene:(_s,params)=>({schemaVersion:'2.0',modelId:'mech-spring-separation',title:'弹簧临界分离',params}),importScene:dsl=>dsl.params as Partial<SpringSepParams>},
  exportDiagramIR:(s,p,opts)=>{const d=springDiagram(s,p,opts);return {width:960,height:540,viewBox:d.bounds,title:'弹簧连接体 · 真实斜面与接触几何',primitives:d.items.map(i=>i.primitive)};},
  formatFormulas:(s,p)=>{
    const o=computeObservables(s,p),f=p.externalForce;
    return [
      {id:'contact',label:s.terminal?'首次再接触 · 碰撞前冻结':s.separated?'自由相 · 两体加速度独立':'共同运动 · 单边接触',latex:s.separated?'a_1=-ks_1/m_1-g\\sin\\theta,\\quad a_2=F/m_2-g\\sin\\theta':'F_N=\\frac{-m_2ks-m_1F}{m_1+m_2}',substitutedLatex:'F_N='+s.normalForceN.toFixed(3)+'\\,\\mathrm N,\\quad a_1='+o.a1!.toFixed(3)+',\\quad a_2='+o.a2!.toFixed(3)+'\\,\\mathrm{m/s^2}'},
      {id:'critical',label:'真正越界时的临界位置（不是必然分离）',latex:'s_c=-\\frac{m_1F}{m_2k}',substitutedLatex:'s_c='+(-p.mass1*f/(p.mass2*p.springK)).toFixed(3)+'\\,\\mathrm m'},
      {id:'energy',label:'实际机械能与外力功',latex:'E=K+U_s+U_g,\\quad E-E_0=W',substitutedLatex:'E-E_0='+(o.energy!-s.initialEnergy).toFixed(3)+',\\quad W='+s.externalWork.toFixed(3)+'\\,\\mathrm J'}
    ];
  },
  renderCanvas:(ctx,s,p,vp,layers)=>{
    const m=createWorldMapper(vp),d=springDiagram(s,p),paper=vp.theme==='projector';
    const palette:Record<SpringRole,string>=paper?{surface:'#64748b',anchor:'#334155',spring:'#92400e',block1:'#0369a1',block2:'#be185d',axis:'#475569',ink:'#0f172a',guide:'#64748b',event:'#9d174d',gravity:'#92400e',support:'#075985',contact:'#be185d',external:'#6d28d9',velocity:'#166534',gap:'#166534'}:{surface:'#6f8297',anchor:'#94a3b8',spring:'#fbbf24',block1:'#38bdf8',block2:'#f472b6',axis:'#cbd5e1',ink:'#e2e8f0',guide:'#94a3b8',event:'#fbbf24',gravity:'#fbbf24',support:'#38bdf8',contact:'#f472b6',external:'#a78bfa',velocity:'#4ade80',gap:'#4ade80'};
    const labels:Array<{id:string;x:number;y:number;text:string;color:string;font:string}>=[];
    for(const [i,{primitive:q,role,layer}] of d.items.entries()){
      if(layer!=='always'&&!layers.has(layer))continue;
      const color=palette[role];ctx.save();ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=role==='spring'?2.6:role==='surface'?1.8:1.6;
      if(q.kind==='line'||q.kind==='arrow'){
        const a=m.toScreen(q.x1,q.y1),b=m.toScreen(q.x2,q.y2);ctx.setLineDash(q.dashed?[5,5]:[]);
        ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.setLineDash([]);
        if(q.kind==='arrow'){
          const ang=Math.atan2(b.y-a.y,b.x-a.x);
          if(Math.hypot(b.x-a.x,b.y-a.y)>2){ctx.beginPath();ctx.moveTo(b.x,b.y);ctx.lineTo(b.x-8*Math.cos(ang-.4),b.y-8*Math.sin(ang-.4));ctx.lineTo(b.x-8*Math.cos(ang+.4),b.y-8*Math.sin(ang+.4));ctx.closePath();ctx.fill();}
          if(q.label)labels.push({id:'arrow-'+i,x:(a.x+b.x)/2+Math.sin(ang)*14,y:(a.y+b.y)/2-Math.cos(ang)*14,text:q.label,color,font:'bold 13px sans-serif'});
        }
      }else if(q.kind==='polyline'){
        const pts=q.points.map(pt=>m.toScreen(pt.x,pt.y));
        ctx.setLineDash(q.dashed?[5,5]:[]);ctx.beginPath();pts.forEach((a,j)=>j===0?ctx.moveTo(a.x,a.y):ctx.lineTo(a.x,a.y));
        if(q.closed)ctx.closePath();
        if(role==='block1'||role==='block2'){
          if(!paper&&pts.length>=3){const a=pts[0]!,b=pts[2]!,grad=ctx.createLinearGradient(a.x,a.y,b.x,b.y);grad.addColorStop(0,role==='block1'?'#075985':'#9d174d');grad.addColorStop(.68,color);grad.addColorStop(1,'#e2e8f0');ctx.fillStyle=grad;ctx.shadowBlur=9;ctx.shadowColor=color;}else ctx.fillStyle=role==='block1'?'#bfdbfe':'#fbcfe8';
          ctx.fill();ctx.shadowBlur=0;
        }
        ctx.stroke();
      }else if(q.kind==='arc'){
        const c=m.toScreen(q.cx,q.cy);ctx.beginPath();ctx.arc(c.x,c.y,m.len(q.r),-q.startAngle,-q.endAngle,true);ctx.stroke();
      }else if(q.kind==='text'){
        const c=m.toScreen(q.x,q.y);labels.push({id:'text-'+i,x:c.x,y:c.y,text:q.text,color,font:'13px sans-serif'});
      }
      ctx.restore();
    }
    resolveAndDrawLabels(ctx,labels.filter(l=>l.x>=0&&l.x<=vp.width&&l.y>=0&&l.y<=vp.height),vp.width,vp.height);
  }
}),{fitSpringViewport,springBoundsFit});
export default mechSpringSeparationPlugin;
