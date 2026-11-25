import { createWorldMapper, defineSimulationPlugin, resolveAndDrawLabels, type DiagramPrimitive, type ParamFieldSpec, type ForceVectorItem } from '@physforge/sim-sdk';
import { equilibriumPresets } from './presets.js';
import {
  angleRange, boundedAngle, checkInvariants, computeObservables, createInitialState, stepEquilibrium,
  type EquilibriumParams, type EquilibriumState, type Point, type Force
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<EquilibriumParams>[] = [
  { key: 'mode', kind: 'select', label: '动态平衡模型', options: [
    { label: '死结 · 固定左绳', value: 'dead-knot-rotate' },
    { label: '活结 · 对称轻滑轮', value: 'active-pulley-knot' },
    { label: '光滑斜面 · 水平拉力', value: 'hemisphere-similar' },
    { label: '光滑半球 · 顶部悬绳', value: 'hemisphere-suspension' }
  ], defaultValue: 'dead-knot-rotate' },
  { key: 'mass', kind: 'number', label: '重物质量 m', unit: 'kg', min: 0.5, max: 10, step: 0.5, defaultValue: 2 },
  { key: 'baseAngleDeg', kind: 'number', label: '左绳与竖直夹角 α', unit: '°', min: 15, max: 75, step: 1, defaultValue: 37 },
  { key: 'sweepAngleDeg', kind: 'number', label: '初始角 β/θ', unit: '°', min: -30, max: 85, step: 1, defaultValue: 37 },
  { key: 'radiusM', kind: 'number', label: '半球半径 R', unit: 'm', min: 0.5, max: 1.5, step: 0.1, defaultValue: 1 },
  { key: 'anchorHeightM', kind: 'number', label: '悬点高出球顶 h', unit: 'm', min: 0.2, max: 1.2, step: 0.1, defaultValue: 0.6 },
  { key: 'autoSweep', kind: 'boolean', label: '连续准静态扫描', defaultValue: true }
];
const O: Point = { x: 0, y: 0 };
const shift = (p: Point, d: Point, scale: number): Point => ({ x: p.x + d.x * scale, y: p.y + d.y * scale });
const isSupport = (s: EquilibriumState) => s.mode === 'hemisphere-similar' || s.mode === 'hemisphere-suspension';
const name1 = (s: EquilibriumState) => isSupport(s) ? 'N' : 'T₁';
const name2 = (s: EquilibriumState) => s.mode === 'hemisphere-similar' ? 'F' : 'T₂';
const statusLabel = (s: EquilibriumState) => s.status === 'infeasible' ? '无平衡解：绳不可受压' :
  s.status === 'singular' ? '奇异构型：无有限解' : '近奇异：无法可靠求解';
type ColoredArrow = { from: Point; to: Point; force: Force; color: string; label: string; id: string };
export function equilibriumGeometry(s: EquilibriumState) {
  const structure: DiagramPrimitive[] = [];
  const p = s.point;
  const line = (a: Point, b: Point, dashed = false) => structure.push({kind:'line',x1:a.x,y1:a.y,x2:b.x,y2:b.y,dashed});
  const label = (a: Point, text: string) => structure.push({kind:'text',x:a.x,y:a.y,text,align:'middle'});
  if (s.sphere) {
    const { radius: r, anchor, height, ropeLength } = s.sphere;
    const points = Array.from({length:65},(_,i)=>({x:r*Math.cos(i*Math.PI/64),y:r*Math.sin(i*Math.PI/64)}));
    structure.push({kind:'polyline',points});
    line({x:-r,y:0},{x:r,y:0}); line(O,anchor,true); line(O,p,true); line(p,anchor);
    structure.push({kind:'circle',cx:anchor.x,cy:anchor.y,r:0.035,fill:true});
    label({x:0.25,y:anchor.y+0.06},'S');
    label({x:-0.13,y:-0.12},'O');
    label({x:p.x*.48-0.12,y:p.y*.48},'R='+r.toFixed(1)+'m');
    label({x:0.31,y:r+height*.5},'h='+height.toFixed(1)+'m');
    label({x:p.x*.5-0.22,y:(p.y+anchor.y)*.5},'L='+ropeLength.toFixed(2)+'m');
  } else if (s.mode === 'hemisphere-similar') {
    const tangent = {x:s.direction1.y,y:-s.direction1.x};
    line(shift(p,tangent,-1.45),shift(p,tangent,1.45));
    line(p,shift(p,s.direction2,1.4),true);
    line(p,shift(p,s.direction1,1.4),true);
  } else {
    for (const d of [s.direction1,s.direction2]) {
      const end=shift(p,d,1.48); line(p,end);
      structure.push({kind:'circle',cx:end.x,cy:end.y,r:0.035,fill:true});
    }
  }
  structure.push({kind:'circle',cx:p.x,cy:p.y,r:0.06,fill:true});
  const scale=1.12/Math.max(s.gravity.mag,s.force1.mag,s.force2.mag,1e-9);
  const vectors: {force:Force;color:string;label:string;id:string}[] = [
    ...(s.status==='balanced' ? [
      {force:s.force1,color:'#38bdf8',label:name1(s),id:'f1'},
      {force:s.force2,color:'#f472b6',label:name2(s),id:'f2'}
    ] : []), {force:s.gravity,color:'#fbbf24',label:'mg',id:'mg'}
  ];
  const arrows: ColoredArrow[]=vectors.map(v=>({...v,from:p,to:shift(p,v.force,scale)}));
  const triangle: ColoredArrow[]=[];
  if(s.status==='balanced'){
    let from:Point={x:2.25,y:.55};
    for(const v of [vectors[2]!,vectors[0]!,vectors[1]!]){
      const to=shift(from,v.force,scale);
      triangle.push({...v,id:'tri-'+v.id,from,to}); from=to;
    }
  }
  return {structure,arrows,triangle,scale};
}

export const mechDynamicEquilibriumPlugin = defineSimulationPlugin<EquilibriumParams,EquilibriumState>({
  meta: { id:'mech-dynamic-equilibrium',title:'动态平衡几何图解（活结/死结/矢量三角形）(M02)',
    textbookRef:'人教版 必修第一册 第三章 第4节',curriculumTags:['物理观念','科学思维'],difficulty:'高三一轮',version:'2.1.0' },
  defaultView: {scale:p=>p.mode==='hemisphere-suspension'?Math.min(.78,1.76/((p.radiusM??1)+(p.anchorHeightM??.6))):.85,offsetRatioX:-.13},
  paramSchema,
  getParamFields: p => paramSchema.filter(f => f.key==='baseAngleDeg'?p.mode==='dead-knot-rotate':
    f.key==='radiusM'||f.key==='anchorHeightM'?p.mode==='hemisphere-suspension':true).map(f=>{
      if(f.key!=='sweepAngleDeg'||f.kind!=='number')return f;
      const [min,max]=angleRange(p.mode);
      return {...f,min,max,label:p.mode==='dead-knot-rotate'?'右绳与水平夹角 β':p.mode==='active-pulley-knot'?'绳与水平夹角 θ':'法线与竖直夹角 θ'};
    }),
  presets:equilibriumPresets,
  engine:{createInitialState,step:stepEquilibrium,computeObservables,checkInvariants},
  layers:[{id:'ropes',label:'结构与受力',defaultVisible:true},{id:'triangle',label:'真实力矢量三角形',defaultVisible:true}],
  telemetryChannels:[{key:'force1',label:'F₁ 张力/支持力',unit:'N',color:'#38bdf8'},
    {key:'force2',label:'F₂ 拉力/张力',unit:'N',color:'#f472b6'},{key:'angleDeg',label:'扫描角度',unit:'°',color:'#fbbf24'}],
  getControlHandles:s=>[{
    id:'pull-angle',label:(s.mode==='dead-knot-rotate'?'β=':'θ=')+s.activeAngleDeg.toFixed(0)+'°',
    position:s.sphere?s.point:shift(O,isSupport(s)?s.direction1:s.direction2,1.48),origin:O,handleKind:'angle',color:'#f472b6',
    onDrag:wp=>({sweepAngleDeg:boundedAngle(s.mode,Math.round(Math.atan2(isSupport(s)?-wp.x:wp.y,isSupport(s)?wp.y:wp.x)*180/Math.PI)),autoSweep:false})
  }],
  getForceVectors:s=>{
    const result:ForceVectorItem[]=[{id:'mg',label:'mg',origin:s.point,force:s.gravity,color:'#fbbf24',category:'gravity',unit:'N'}];
    if(s.status==='balanced')result.unshift(
      {id:'f1',label:name1(s),origin:s.point,force:s.force1,color:'#38bdf8',category:isSupport(s)?'normal':'tension',unit:'N'},
      {id:'f2',label:name2(s),origin:s.point,force:s.force2,color:'#f472b6',category:'tension',unit:'N'});
    return result;
  },
  sceneSerializer:{exportScene:(_s,params)=>({schemaVersion:'2.0',modelId:'mech-dynamic-equilibrium',title:'动态平衡图解',params}),
    importScene:dsl=>dsl.params as Partial<EquilibriumParams>},
  exportDiagramIR:s=>{
    const g=equilibriumGeometry(s);
    const primitives:DiagramPrimitive[]=[...g.structure,...[...g.arrows,...g.triangle].map((a):DiagramPrimitive=>({
      kind:'arrow',x1:a.from.x,y1:a.from.y,x2:a.to.x,y2:a.to.y,label:a.label+'='+a.force.mag.toFixed(2)+'N'
    }))];
    primitives.push({kind:'text',x:2.25,y:1.15,text:s.status==='balanced'?'力矢量三角形':statusLabel(s),align:'middle'});
    return {width:900,height:560,viewBox:{minX:-2.2,minY:-1.6,maxX:3.5,maxY:Math.max(1.9,(s.sphere?.anchor.y??0)+.35)},title:'准静态动态平衡',primitives};
  },
  formatFormulas:s=>{
    const angle=(s.mode==='dead-knot-rotate'?'\\beta':'\\theta')+'='+s.activeAngleDeg.toFixed(1)+'^\\circ';
    const law=s.mode==='dead-knot-rotate'?'T_1=\\frac{mg\\cos\\beta}{\\cos(\\alpha-\\beta)},\\quad T_2=\\frac{mg\\sin\\alpha}{\\cos(\\alpha-\\beta)}':
      s.mode==='active-pulley-knot'?'T_1=T_2=\\frac{mg}{2\\sin\\theta}':
      s.sphere?'N=\\frac{mgR}{R+h},\\quad T=\\frac{mgL}{R+h}':'N=\\frac{mg}{\\cos\\theta},\\quad F=mg\\tan\\theta';
    return [
      {id:'eq-forces',label:'准静态平衡条件（非运动轨迹）',latex:'\\vec{F}_1+\\vec{F}_2+m\\vec g=\\mathbf 0',substitutedLatex:angle},
      {id:'eq-law',label:s.status==='balanced'?'解析力值':statusLabel(s),latex:law,substitutedLatex:s.status==='balanced'?
        'F_1='+s.force1.mag.toFixed(2)+'\\,\\mathrm N,\\quad F_2='+s.force2.mag.toFixed(2)+'\\,\\mathrm N':
        '\\text{无可靠有限平衡解}'},
      {id:'eq-bound',label:'理论拉力下界'+(s.mode==='active-pulley-knot'?'（水平极限不在滑块范围内）':''),latex:'F_{2,\\min}='+s.minPullForceN.toFixed(2)+'\\,\\mathrm N'}
    ];
  },
  renderCanvas:(ctx,s,_p,vp,layers)=>{
    const m=createWorldMapper(vp),paper=vp.theme==='projector',g=equilibriumGeometry(s);
    const ink=paper?'#334155':'#cbd5e1';
    const color=(c:string)=>paper?({'#38bdf8':'#0369a1','#f472b6':'#9d174d','#fbbf24':'#92400e'}[c]??c):c;
    const labels:Array<{id:string;x:number;y:number;text:string;color:string;font:string}>=[];
    const label=(p:Point,text:string,id:string,c=ink)=>{
      const q=m.toScreen(p.x,p.y);labels.push({id,x:q.x+6,y:q.y-6,text,color:c,font:'bold 13px sans-serif'});
    };
    const segment=(a:Point,b:Point,dashed=false)=>{
      const p=m.toScreen(a.x,a.y),q=m.toScreen(b.x,b.y);
      ctx.save();ctx.strokeStyle=ink;ctx.lineWidth=1.8;ctx.setLineDash(dashed?[5,5]:[]);ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.stroke();ctx.restore();
    };
    const arrow=(a:ColoredArrow)=>{
      const p=m.toScreen(a.from.x,a.from.y),q=m.toScreen(a.to.x,a.to.y),ang=Math.atan2(q.y-p.y,q.x-p.x);
      ctx.save();ctx.strokeStyle=color(a.color);ctx.fillStyle=color(a.color);ctx.lineWidth=2.6;
      ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.stroke();
      if(Math.hypot(q.x-p.x,q.y-p.y)>2){
        ctx.beginPath();ctx.moveTo(q.x,q.y);ctx.lineTo(q.x-9*Math.cos(ang-.4),q.y-9*Math.sin(ang-.4));ctx.lineTo(q.x-9*Math.cos(ang+.4),q.y-9*Math.sin(ang+.4));ctx.closePath();ctx.fill();
      }ctx.restore();label(a.to,a.label+'='+a.force.mag.toFixed(1)+' N',a.id,color(a.color));
    };
    if(layers.has('ropes')){
      for(const [i,d] of g.structure.entries()){
        if(d.kind==='line')segment({x:d.x1,y:d.y1},{x:d.x2,y:d.y2},d.dashed);
        else if(d.kind==='polyline'){
          ctx.save();ctx.strokeStyle=ink;ctx.lineWidth=2;ctx.beginPath();
          d.points.forEach((p,j)=>{const q=m.toScreen(p.x,p.y);if(j===0)ctx.moveTo(q.x,q.y);else ctx.lineTo(q.x,q.y)});ctx.stroke();ctx.restore();
        }else if(d.kind==='circle'){
          const q=m.toScreen(d.cx,d.cy);ctx.save();ctx.fillStyle=ink;ctx.beginPath();ctx.arc(q.x,q.y,m.len(d.r),0,Math.PI*2);ctx.fill();ctx.restore();
        }else if(d.kind==='text')label({x:d.x,y:d.y},d.text,'structure-'+i);
      }
      g.arrows.forEach(arrow);
    }
    if(layers.has('triangle')){
      label({x:2.05,y:1.15},s.status==='balanced'?'力矢量三角形':statusLabel(s),'triangle-title',s.status==='balanced'?ink:color('#f472b6'));
      g.triangle.forEach(arrow);
    }
    label({x:-1.5,y:-1.45},'准静态构型 · 力箭头同比例自适应','scale-note');
    resolveAndDrawLabels(ctx,labels,vp.width,vp.height);
  }
});
export default mechDynamicEquilibriumPlugin;
