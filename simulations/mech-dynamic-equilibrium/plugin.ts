import { createWorldMapper, defineSimulationPlugin, resolveAndDrawLabels, type DiagramPrimitive, type ParamFieldSpec, type ForceVectorItem } from '@physforge/sim-sdk';
import { equilibriumPresets } from './presets.js';
import { auxiliaryItems, anglePlotItems, shiftedAnalysis, type AnalysisRole } from './analysis.js';
import {
  angleRange, boundedAngle, checkInvariants, computeObservables, createInitialState, stepEquilibrium, isRodMode,
  type EquilibriumParams, type EquilibriumState, type Point, type Force
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<EquilibriumParams>[] = [
  { key: 'mode', kind: 'select', label: '动态平衡模型', options: [
    { label: '死结 · 固定左绳', value: 'dead-knot-rotate' },
    { label: '活结 · 对称轻滑轮', value: 'active-pulley-knot' },
    { label: '光滑斜面 · 水平拉力', value: 'hemisphere-similar' },
    { label: '光滑半球 · 顶部悬绳', value: 'hemisphere-suspension' },
    { label: '动杆 · 理想铰接二力杆', value: 'hinged-rod' },
    { label: '定杆 · 固定支座与力矩', value: 'fixed-rod' }
  ], defaultValue: 'dead-knot-rotate' },
  { key: 'mass', kind: 'number', label: '重物质量 m', unit: 'kg', min: 0.5, max: 10, step: 0.5, defaultValue: 2 },
  { key: 'baseAngleDeg', kind: 'number', label: '左绳与竖直夹角 α', unit: '°', min: 15, max: 75, step: 1, defaultValue: 37 },
  { key: 'sweepAngleDeg', kind: 'number', label: '初始角 β/θ', unit: '°', min: -30, max: 150, step: 1, defaultValue: 37 },
  { key: 'radiusM', kind: 'number', label: '半球半径 R', unit: 'm', min: 0.5, max: 1.5, step: 0.1, defaultValue: 1 },
  { key: 'anchorHeightM', kind: 'number', label: '悬点高出球顶 h', unit: 'm', min: 0.2, max: 1.2, step: 0.1, defaultValue: 0.6 },
  { key: 'rodLengthM', kind: 'number', label: '杆长 L', unit: 'm', min: .6, max: 1.5, step: .1, defaultValue: 1.2 },
  { key: 'pullForceN', kind: 'number', label: '指定绳张力 T₀', unit: 'N', min: 0, max: 40, step: .5, defaultValue: 8 },
  { key: 'autoSweep', kind: 'boolean', label: '连续准静态扫描', defaultValue: true }
];
const O: Point = { x: 0, y: 0 };
const shift = (p: Point, d: Point, scale: number): Point => ({ x: p.x + d.x * scale, y: p.y + d.y * scale });
const isSupport = (s: EquilibriumState) => s.mode === 'hemisphere-similar' || s.mode === 'hemisphere-suspension';
const name1 = (s: EquilibriumState) => isSupport(s) ? 'N' : s.mode==='hinged-rod'?'|C|':s.mode==='fixed-rod'?'R':'T₁';
const name2 = (s: EquilibriumState) => s.mode === 'hemisphere-similar' ? 'F' : s.rod||s.sphere?'T':'T₂';
const statusLabel = (s: EquilibriumState) => s.status === 'infeasible' ? '无平衡解：绳不可受压' :
  s.status === 'singular' ? '奇异构型：无有限解' : '近奇异：无法可靠求解';
type ColoredArrow = { from: Point; to: Point; force: Force; color: string; label: string; id: string };
export function equilibriumGeometry(s: EquilibriumState) {
  const structure: DiagramPrimitive[] = [];
  const p = s.point;
  const line = (a: Point, b: Point, dashed = false) => structure.push({kind:'line',x1:a.x,y1:a.y,x2:b.x,y2:b.y,dashed});
  const label = (a: Point, text: string) => structure.push({kind:'text',x:a.x,y:a.y,text,align:'middle'});
  if(s.rod){
    const r=s.rod,o=r.pivot,ropeEnd=shift(p,s.direction2,1.48);
    structure.push({kind:'line',x1:o.x,y1:o.y,x2:p.x,y2:p.y,strokeWidth:3});
    line(p,ropeEnd,s.status!=='balanced'||s.force2.mag===0);
    structure.push({kind:'circle',cx:ropeEnd.x,cy:ropeEnd.y,r:.035,fill:true});
    if(s.mode==='hinged-rod'){
      structure.push({kind:'circle',cx:o.x,cy:o.y,r:.07,fill:false});
      line({x:o.x-.16,y:o.y-.13},o);line(o,{x:o.x+.16,y:o.y-.13});
      line({x:o.x-.24,y:o.y-.13},{x:o.x+.24,y:o.y-.13});
      label({x:o.x-.18,y:o.y-.28},'铰支 O');
      if(r.axialForceN!==undefined)label({x:(o.x+p.x)/2,y:(o.y+p.y)/2-.16},r.axialForceN>1e-10?'受压':r.axialForceN< -1e-10?'受拉':'零轴力');
    }else{
      line({x:o.x,y:o.y-.25},{x:o.x,y:o.y+.25});
      for(let i=0;i<6;i++)line({x:o.x,y:o.y-.25+i*.1},{x:o.x-.13,y:o.y-.32+i*.1});
      label({x:o.x,y:o.y-.37},'固支 O');
      if(r.supportMomentNm!==undefined){
        const moment=r.supportMomentNm,sign=Math.sign(moment);
        if(Math.abs(moment)>1e-10){
          // A couple is a free moment: locate its symbol beside the support,
          // with a dashed association leader, rather than crossing the rod/hatching.
          const center={x:o.x-.47,y:o.y+.35},radius=.17,start=.2,end=start+sign*4.6;
          line({x:o.x-.14,y:o.y+.15},{x:center.x+.14,y:center.y-.1},true);
          const points=Array.from({length:33},(_,i)=>{const a=start+(end-start)*i/32;return {x:center.x+radius*Math.cos(a),y:center.y+radius*Math.sin(a)};});
          structure.push({kind:'polyline',points});
          const tip=points.at(-1)!,tangent={x:-sign*Math.sin(end),y:sign*Math.cos(end)},normal={x:-tangent.y,y:tangent.x};
          line(tip,shift(shift(tip,tangent,-.075),normal,.035));line(tip,shift(shift(tip,tangent,-.075),normal,-.035));
        }
        label({x:o.x-.47,y:o.y+.63},'Mₒ='+moment.toFixed(2)+' N·m');
      }
    }
    label({x:(o.x+p.x)/2+r.axis.y*.16,y:(o.y+p.y)/2-r.axis.x*.16},'L='+r.lengthM.toFixed(1)+'m');
    label({x:p.x+.14,y:p.y-.15},'P');
  } else if (s.sphere) {
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
  meta: { id:'mech-dynamic-equilibrium',title:'动态平衡几何图解（绳结·杆·半球）(M02)',
    textbookRef:'人教版 必修第一册 第三章 第4节',curriculumTags:['物理观念','科学思维'],difficulty:'高三一轮',version:'2.2.0' },
  defaultView: {scale:p=>p.mode==='hemisphere-suspension'?Math.min(.78,1.76/((p.radiusM??1)+(p.anchorHeightM??.6))):isRodMode(p.mode)?.76:.80,offsetRatioX:-.14},
  paramSchema,
  getParamFields: p => paramSchema.filter(f => f.key==='baseAngleDeg'?p.mode==='dead-knot-rotate'||isRodMode(p.mode):
    f.key==='rodLengthM'?isRodMode(p.mode):f.key==='pullForceN'?p.mode==='fixed-rod':
    f.key==='radiusM'||f.key==='anchorHeightM'?p.mode==='hemisphere-suspension':true).map(f=>{
      if(f.key==='baseAngleDeg'&&isRodMode(p.mode))return {...f,label:'杆与水平夹角 α'};
      if(f.key!=='sweepAngleDeg'||f.kind!=='number')return f;
      const [min,max]=angleRange(p.mode,p);
      return {...f,min,max,label:isRodMode(p.mode)?'初始请求角 β（从左水平向上）':p.mode==='dead-knot-rotate'?'初始请求角 β（右绳与水平）':p.mode==='active-pulley-knot'?'初始请求角 θ（绳与水平）':'初始请求角 θ（法线与竖直）'};
    }),
  presets:equilibriumPresets,
  engine:{createInitialState,step:stepEquilibrium,computeObservables,checkInvariants},
  layers:[{id:'ropes',label:'结构与受力',defaultVisible:true},{id:'triangle',label:'真实力矢量三角形',defaultVisible:true},
    {id:'aux-circle',label:'辅助圆（死结/动杆，替代三角形）',defaultVisible:false},
    {id:'angle-curve',label:'力—角度函数（优先于辅助圆）',defaultVisible:false}],
  telemetryChannels:[{key:'force1',label:'F₁ 张力/支持力',unit:'N',color:'#38bdf8'},
    {key:'force2',label:'F₂ 拉力/张力',unit:'N',color:'#f472b6'},{key:'angleDeg',label:'扫描角度',unit:'°',color:'#fbbf24'}],
  getControlHandles:(s,p)=>[{
    id:'pull-angle',label:(s.mode==='dead-knot-rotate'||s.rod?'β=':'θ=')+s.activeAngleDeg.toFixed(0)+'°',
    position:s.sphere?s.point:shift(s.point,isSupport(s)?s.direction1:s.direction2,1.48),origin:s.sphere?O:s.point,handleKind:'angle',showWhenIdle:!s.sphere,color:'#f472b6',
    onDrag:wp=>({sweepAngleDeg:boundedAngle(s.mode,Math.round(Math.atan2(isSupport(s)?-wp.x:wp.y,isSupport(s)?wp.y:s.rod?-wp.x:wp.x)*180/Math.PI),p),autoSweep:false})
  }],
  getForceVectors:s=>{
    const result:ForceVectorItem[]=[{id:'mg',label:'mg',origin:s.point,force:s.gravity,color:'#fbbf24',category:'gravity',unit:'N'}];
    if(s.status==='balanced')result.unshift(
      {id:'f1',label:name1(s),origin:s.point,force:s.force1,color:'#38bdf8',category:isSupport(s)?'normal':s.rod?'other':'tension',unit:'N'},
      {id:'f2',label:name2(s),origin:s.point,force:s.force2,color:'#f472b6',category:s.mode==='hemisphere-similar'?'other':'tension',unit:'N'});
    return result;
  },
  referenceFrames:[{id:'support-origin',label:'支点原点（仅平移）',description:'准静态几何参照，不表示动力学随动系',getOrigin:s=>s.rod?.pivot??O}],
  sceneSerializer:{exportScene:(_s,params)=>({schemaVersion:'2.0',modelId:'mech-dynamic-equilibrium',title:'动态平衡图解',params}),
    importScene:dsl=>dsl.params as Partial<EquilibriumParams>},
  exportDiagramIR:(s,p)=>{
    const g=equilibriumGeometry(s);
    const primitives:DiagramPrimitive[]=[...g.structure,...[...g.arrows,...g.triangle].map((a):DiagramPrimitive=>({
      kind:'arrow',x1:a.from.x,y1:a.from.y,x2:a.to.x,y2:a.to.y,label:a.label+'='+a.force.mag.toFixed(2)+'N'
    }))];
    primitives.push({kind:'text',x:2.25,y:1.15,text:s.status==='balanced'?'力矢量三角形':statusLabel(s),align:'middle'});
    // Include the exact auxiliary/angle constructions in the monochrome
    // teaching sheet without pretending that they are extra forces.
    const aux=auxiliaryItems(s),curve=anglePlotItems(s,p);
    if(s.mode==='dead-knot-rotate'||s.mode==='hinged-rod')primitives.push(...shiftedAnalysis(aux,-3.25));
    primitives.push(...shiftedAnalysis(curve,-3.25).map((d):DiagramPrimitive=>{
      // Put the function plot on the left, the auxiliary circle on the right.
      if(d.kind==='line')return {...d,x1:d.x1-3.55,x2:d.x2-3.55};
      if(d.kind==='circle')return {...d,cx:d.cx-3.55};
      if(d.kind==='text')return {...d,x:d.x-3.55};
      return d;
    }));
    return {width:900,height:860,viewBox:{minX:-2.7,minY:-4.8,maxX:3.9,maxY:Math.max(1.9,(s.sphere?.anchor.y??0)+.35)},title:'准静态动态平衡 · 构型与解析图解',primitives};
  },
  formatFormulas:s=>{
    const angle=(s.mode==='dead-knot-rotate'||s.rod?'\\beta':'\\theta')+'='+s.activeAngleDeg.toFixed(1)+'^\\circ';
    // Explicit stacked equations avoid relying on horizontal scrolling or
    // shrinking an entire formula in the 272 px classroom inspector.
    const pair=(a:string,b:string)=>'\\begin{gathered}'+a+'\\\\'+b+'\\end{gathered}';
    const law=s.mode==='dead-knot-rotate'?pair('T_1=\\frac{mg\\cos\\beta}{\\cos(\\alpha-\\beta)}','T_2=\\frac{mg\\sin\\alpha}{\\cos(\\alpha-\\beta)}'):
      s.mode==='active-pulley-knot'?'T_1=T_2=\\frac{mg}{2\\sin\\theta}':
      s.mode==='hinged-rod'?pair('C=\\frac{mg\\cos\\beta}{\\sin(\\alpha+\\beta)}','T=\\frac{mg\\cos\\alpha}{\\sin(\\alpha+\\beta)}'):
      s.mode==='fixed-rod'?pair('R_x=T_0\\cos\\beta','R_y=mg-T_0\\sin\\beta'):
      s.sphere?pair('N=\\frac{mgR}{R+h}','T=\\frac{mgL}{R+h}'):pair('N=\\frac{mg}{\\cos\\theta}','F=mg\\tan\\theta');
    const n=(value:number)=>value.toFixed(2)+'\\,\\mathrm N';
    const first=s.rod?.axialForceN!==undefined?'C='+n(s.rod.axialForceN):s.mode==='fixed-rod'?'|R|='+n(s.force1.mag):isSupport(s)?'N='+n(s.force1.mag):'T_1='+n(s.force1.mag);
    const second=(s.mode==='hemisphere-similar'?'F=':s.rod||s.sphere?'T=':'T_2=')+n(s.force2.mag);
    return [
      {id:'eq-forces',label:'准静态平衡条件（非运动轨迹）',latex:'\\vec{F}_1+\\vec{F}_2+m\\vec g=\\mathbf 0',substitutedLatex:angle},
      {id:'eq-law',label:s.status==='balanced'?'解析力值':statusLabel(s),latex:law,substitutedLatex:s.status==='balanced'?
        pair(first,second):
        '\\text{无可靠有限平衡解}'},
      ...(s.minPullForceN!==undefined?[{id:'eq-bound',label:'理论拉力下界'+(s.mode==='active-pulley-knot'?'（竖直绳极限不在滑块范围内）':s.sphere?'（球顶连续极限）':''),latex:'F_{2,\\min}='+s.minPullForceN.toFixed(2)+'\\,\\mathrm N'}]:[]),
      ...(s.mode==='fixed-rod'?[{id:'eq-moment',label:'固定支座力矩（逆时针为正）',latex:'M_O=L(R_y\\cos\\alpha-R_x\\sin\\alpha)',...(s.rod?.supportMomentNm!==undefined?{substitutedLatex:'M_O='+s.rod.supportMomentNm.toFixed(3)+'\\,\\mathrm{N\\cdot m}'}:{})}]:[])
    ];
  },
  renderCanvas:(ctx,s,p,vp,layers)=>{
    const m=createWorldMapper(vp),paper=vp.theme==='projector',g=equilibriumGeometry(s);
    const ink=paper?'#334155':'#cbd5e1';
    const color=(c:string)=>paper?({'#38bdf8':'#0369a1','#f472b6':'#9d174d','#fbbf24':'#92400e'}[c]??c):c;
    const labels:Array<{id:string;x:number;y:number;text:string;color:string;font:string}>=[];
    const label=(p:Point,text:string,id:string,c=ink)=>{
      const q=m.toScreen(p.x,p.y);labels.push({id,x:q.x+6,y:q.y-6,text,color:c,font:'bold 13px sans-serif'});
    };
    const segment=(a:Point,b:Point,dashed=false,c=ink,width=1.8)=>{
      const p=m.toScreen(a.x,a.y),q=m.toScreen(b.x,b.y);
      ctx.save();ctx.strokeStyle=c;ctx.lineWidth=width;ctx.setLineDash(dashed?[5,5]:[]);ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.stroke();ctx.restore();
    };
    const arrow=(a:ColoredArrow)=>{
      const p=m.toScreen(a.from.x,a.from.y),q=m.toScreen(a.to.x,a.to.y),ang=Math.atan2(q.y-p.y,q.x-p.x);
      ctx.save();ctx.strokeStyle=color(a.color);ctx.fillStyle=color(a.color);ctx.lineWidth=2.6;
      ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.stroke();
      if(Math.hypot(q.x-p.x,q.y-p.y)>2){
        ctx.beginPath();ctx.moveTo(q.x,q.y);ctx.lineTo(q.x-9*Math.cos(ang-.4),q.y-9*Math.sin(ang-.4));ctx.lineTo(q.x-9*Math.cos(ang+.4),q.y-9*Math.sin(ang+.4));ctx.closePath();ctx.fill();
      }ctx.restore();
      const value=a.label+'='+a.force.mag.toFixed(1)+' N';
      // Keep the text beside, rather than centered on, the vector line.
      const dx=q.x-p.x,dy=q.y-p.y,len=Math.hypot(dx,dy),nx=len>1?dy/len:1,ny=len>1?-dx/len:0;
      ctx.font='bold 13px sans-serif';
      const clearance=Math.abs(nx)*(ctx.measureText(value).width/2+4)+Math.abs(ny)*10+6;
      const pos={x:(p.x+q.x)/2+nx*clearance,y:(p.y+q.y)/2+ny*clearance};
      labels.push({id:a.id,x:pos.x,y:pos.y,text:value,color:color(a.color),font:'bold 13px sans-serif'});

    };
    if(layers.has('ropes')){
      for(const [i,d] of g.structure.entries()){
        if(d.kind==='line')segment({x:d.x1,y:d.y1},{x:d.x2,y:d.y2},d.dashed,ink,d.strokeWidth??1.8);
        else if(d.kind==='polyline'){
          ctx.save();ctx.strokeStyle=ink;ctx.lineWidth=2;ctx.beginPath();
          d.points.forEach((p,j)=>{const q=m.toScreen(p.x,p.y);if(j===0)ctx.moveTo(q.x,q.y);else ctx.lineTo(q.x,q.y)});ctx.stroke();ctx.restore();
        }else if(d.kind==='circle'){
          const q=m.toScreen(d.cx,d.cy);ctx.save();ctx.fillStyle=ink;ctx.strokeStyle=ink;ctx.lineWidth=1.8;ctx.beginPath();ctx.arc(q.x,q.y,m.len(d.r),0,Math.PI*2);if(d.fill)ctx.fill();else ctx.stroke();ctx.restore();
        }else if(d.kind==='text')label({x:d.x,y:d.y},d.text,'structure-'+i);
      }
      g.arrows.forEach(arrow);
    }
    const analysis=layers.has('angle-curve')?anglePlotItems(s,p):layers.has('aux-circle')?auxiliaryItems(s):null;
    if(analysis){
      const palette:Record<AnalysisRole,string>={ink,force1:color('#38bdf8'),force2:color('#f472b6'),gravity:color('#fbbf24')};
      for(const {primitive:d,role} of analysis){
        const c=palette[role];
        if(d.kind==='line')segment({x:d.x1,y:d.y1},{x:d.x2,y:d.y2},d.dashed,c,role==='ink'?1:2.2);
        else if(d.kind==='circle'){
          const q=m.toScreen(d.cx,d.cy);ctx.save();ctx.fillStyle=c;ctx.strokeStyle=c;ctx.lineWidth=1.6;ctx.setLineDash(d.dashed?[4,4]:[]);ctx.beginPath();ctx.arc(q.x,q.y,m.len(d.r),0,Math.PI*2);if(d.fill)ctx.fill();else ctx.stroke();ctx.restore();
        }else if(d.kind==='text'){
          const q=m.toScreen(d.x,d.y);ctx.save();ctx.fillStyle=c;ctx.font='12px system-ui';ctx.textAlign=d.align==='start'?'left':d.align==='end'?'right':'center';ctx.textBaseline='middle';ctx.fillText(d.text,q.x,q.y);ctx.restore();
        }
      }
    }else if(layers.has('triangle')){
      label({x:2.05,y:1.15},s.status==='balanced'?'力矢量三角形':statusLabel(s),'triangle-title',s.status==='balanced'?ink:color('#f472b6'));
      g.triangle.forEach(arrow);
    }
    label({x:-1.5,y:-1.65},'准静态 · 力箭头同比例自适应','scale-note');
    resolveAndDrawLabels(ctx,labels,vp.width,vp.height);
  }
});
export default mechDynamicEquilibriumPlugin;
