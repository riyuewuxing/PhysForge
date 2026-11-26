import {
  createWorldMapper,
  defineSimulationPlugin,
  resolveAndDrawLabels,
  type CanvasLabel,
  type DiagramPrimitive,
  type ParamFieldSpec,
  type Viewport,
  type TelemetryChannelSpec
} from '@physforge/sim-sdk';
import { transformerGridPresets } from './presets.js';
import {
  checkInvariants,
  computeObservables,
  createInitialState,
  stepTransformerGrid,
  trendSymbol,
  type TransformerGridParams,
  type TransformerGridState
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<TransformerGridParams>[] = [
  {
    key: 'mode',
    kind: 'select',
    label: '系统架构',
    defaultValue: 'multi-tap-transformer',
    options: [
      { value: 'multi-tap-transformer', label: '含原边电阻多副线圈变压器' },
      { value: 'long-distance-grid', label: '发电机→升压→线损→降压输电网' }
    ]
  },
  { key: 'sourceU0', kind: 'number', label: '电源/发电机电压 U₀', unit: 'V', min: 100, max: 500, step: 10, defaultValue: 220 },
  { key: 'primaryR0', kind: 'number', label: '原线圈串联电阻 R₀', unit: 'Ω', min: 0, max: 30, step: 2, defaultValue: 10 },
  { key: 'n1Ratio', kind: 'number', label: '原线圈匝比 n₁', unit: '', min: 1, max: 10, step: 1, defaultValue: 2 },
  { key: 'n2Ratio', kind: 'number', label: '副线圈1匝比 n₂', unit: '', min: 1, max: 10, step: 1, defaultValue: 1 },
  { key: 'n3Ratio', kind: 'number', label: '副线圈2匝比 n₃', unit: '', min: 1, max: 10, step: 1, defaultValue: 1 },
  { key: 'loadR2', kind: 'number', label: '单用户电阻 R₂', unit: 'Ω', min: 10, max: 100, step: 5, defaultValue: 50 },
  { key: 'loadR3', kind: 'number', label: '第2副路电阻 R₃', unit: 'Ω', min: 10, max: 100, step: 5, defaultValue: 40 },
  { key: 'branch3Closed', kind: 'boolean', label: '闭合第 2 副路开关', defaultValue: true },
  { key: 'baselineParallelUsers', kind: 'number', label: '基准并联用户数', unit: '户', min: 1, max: 5, step: 1, defaultValue: 1 },
  { key: 'parallelUsersCount', kind: 'number', label: '当前并联用户数', unit: '户', min: 0, max: 6, step: 1, defaultValue: 2 },
  { key: 'genPowerKw', kind: 'number', label: '发电机总功率 P发', unit: 'kW', min: 0, max: 200, step: 5, defaultValue: 100 },
  { key: 'stepUpRatioK1', kind: 'number', label: '升压变升压比 k₁', unit: '', min: 5, max: 40, step: 5, defaultValue: 20 },
  { key: 'lineResistanceR', kind: 'number', label: '输电线总电阻 R线', unit: 'Ω', min: 0, max: 50, step: 2, defaultValue: 20 }
];


type Point={x:number;y:number};
type Tone='ink'|'muted'|'source'|'load'|'heat'|'gold'|'core';
type Mark={primitive:DiagramPrimitive;tone:Tone;solid?:boolean};
type SafeRect={left:number;right:number;top:number;bottom:number};
const bounds={minX:-3.15,maxX:3.15,minY:-1.66,maxY:1.65};
const rail={left:-2.25,right:2.25,y:-1.38};
const pos=(p:TransformerGridParams)=>rail.left+(rail.right-rail.left)*(p.mode==='long-distance-grid'?(p.stepUpRatioK1-5)/35:p.primaryR0/30);
const power=(w:number,grid:boolean)=>grid?(w/1000).toFixed(2)+' kW':w.toFixed(1)+' W';
export function transformerDiagramBounds(){return bounds;}
export function fitTransformerViewport(v:Viewport,safe:SafeRect):Viewport|null{
  const w=safe.right-safe.left,h=safe.bottom-safe.top;
  if(w<160||h<140)return null;
  const ppm=Math.min((w-70)/(bounds.maxX-bounds.minX),(h-54)/(bounds.maxY-bounds.minY));
  if(!Number.isFinite(ppm)||ppm<=0)return null;
  return {...v,scale:ppm/(.24*Math.min(v.width,v.height)),offsetX:(safe.left+safe.right)/2-.45*v.width,
    offsetY:(safe.top+safe.bottom)/2-.5*v.height};
}
export function transformerBoundsFit(v:Viewport,safe:SafeRect){
  const m=createWorldMapper(v);
  return m.toX(bounds.minX)>=safe.left+18&&m.toX(bounds.maxX)<=safe.right-18&&m.toY(bounds.maxY)>=safe.top+12&&m.toY(bounds.minY)<=safe.bottom-12;
}
function initialView(v:{width:number;height:number}){
  const full={...v,dpr:1,scale:1,offsetX:0,offsetY:0},q=fitTransformerViewport(full,{left:30,right:v.width-30,top:24,bottom:v.height-24})??full;
  return {scale:q.scale,offsetRatioX:q.offsetX/v.width,offsetRatioY:q.offsetY/v.height};
}
export function transformerScene(s:TransformerGridState,p:TransformerGridParams,layers:ReadonlySet<string>):Mark[]{
  const c=s.current,b=s.baseline,grid=p.mode==='long-distance-grid',marks:Mark[]=[];
  const add=(primitive:DiagramPrimitive,tone:Tone='ink',solid=false)=>marks.push({primitive,tone,solid});
  const line=(x1:number,y1:number,x2:number,y2:number,tone:Tone='ink',dashed=false)=>add({kind:'line',x1,y1,x2,y2,dashed},tone);
  const poly=(points:Point[],tone:Tone='ink')=>add({kind:'polyline',points},tone);
  const label=(x:number,y:number,text:string,tone:Tone='ink')=>add({kind:'text',x,y,text,align:'middle'},tone);
  const rect=(x:number,y:number,width:number,height:number,tone:Tone,solid=false)=>add({kind:'rect',x,y,width,height,hatch:tone==='heat'},tone,solid);
  const dot=(x:number,y:number,tone:Tone)=>add({kind:'circle',cx:x,cy:y,r:.035,fill:true},tone);
  const arrow=(x1:number,y1:number,x2:number,y2:number,tone:Tone='source',dashed=false)=>add({kind:'arrow',x1,y1,x2,y2,dashed},tone);
  const coil=(x:number,top:number,bottom:number,n:number,sign:number,tone:Tone)=>{
    const turns=Math.max(1,Math.round(n)),points:Point[]=[];
    for(let j=0;j<=turns*16;j++)points.push({x:x+sign*.14*Math.abs(Math.sin(Math.PI*j/16)),y:top-(top-bottom)*j/(turns*16)});
    poly(points,tone);
  };
  const sine=(x:number,y:number,r:number,tone:Tone)=>{add({kind:'circle',cx:x,cy:y,r},tone);poly(Array.from({length:35},(_,i)=>({x:x-r*.7+r*1.4*i/34,y:y+r*.28*Math.sin(2*Math.PI*i/34)})),tone);};
  const trend=(now:number,ref:number)=>' '+(b.operatingPointValid===1?trendSymbol(now,ref):'基准无解');
  const value=(v:number,u:string,d=1)=>v.toFixed(d)+' '+u;
  if(layers.has('topology')){
    if(!grid){
      label(0,1.52,'理想多副线圈 · 有效值稳态','ink');
      // Three electrically isolated circuits; the core is not an electrical conductor between them.
      const top=.94,bot=-.64,left=-2.8,pri=-.66;
      sine(left,.15,.24,'source');
      line(left,.39,left,top,'source');line(left,top,-2.25,top,'source');
      rect(-2.25,top-.10,.58,.20,'heat');
      line(-1.67,top,pri,top,'source');coil(pri,top,bot,p.n1Ratio,-1,'source');
      line(pri,bot,left,bot,'source');line(left,bot,left,-.09,'source');
      rect(-.43,bot-.05,.10,top-bot+.10,'core',true);rect(-.25,bot-.05,.10,top-bot+.10,'core',true);
      label(-.28,1.17,'铁芯','muted');
      label(-1.96,1.13,'R₀='+p.primaryR0+' Ω','heat');
      label(-1.72,.55,'U₀='+value(c.uSourceV,'V'),'source');
      label(-1.72,.28,'U₁='+value(c.u1,'V')+trend(c.u1,b.u1),'source');
      label(-1.72,.02,'I₁='+value(c.i1,'A',2)+trend(c.i1,b.i1),'source');
      label(-1.72,-.25,'n₁='+p.n1Ratio+' · P₁='+power(c.pTransformerInW,false),'muted');
      const right=2.75,sx=.10,t2=.94,b2=.24,t3=-.06,b3=-.76;
      coil(sx,t2,b2,p.n2Ratio,1,'load');if(p.parallelUsersCount>0)line(sx,t2,right,t2,'load');else{line(sx,t2,1.16,t2,'load');dot(1.16,t2,'load');dot(1.66,t2,'load');line(1.16,t2,1.66,t2+.14,'gold');line(1.66,t2,right,t2,'load');}
      line(right,t2,right,.72,'load');rect(right-.09,.43,.18,.29,'load');line(right,.43,right,b2,'load');line(right,b2,sx,b2,'load');
      if(p.parallelUsersCount===0){ // represent the open load on the upper rail, not a short.
        label(1.62,.80,'副路2 · 无接入用户','muted');
      }else label(1.62,.80,'副路2 · '+p.parallelUsersCount+' 户并联','load');
      label(1.5,.57,'U₂='+value(c.u2,'V')+trend(c.u2,b.u2),'load');
      label(1.5,.35,'I₂='+value(c.i2,'A',2)+trend(c.i2,b.i2)+' · n₂='+p.n2Ratio,'load');
      label(1.45,1.16,'等效 R₂/N · '+(p.parallelUsersCount>0?(p.loadR2/p.parallelUsersCount).toFixed(1)+' Ω':'开路'),'muted');
      coil(sx,t3,b3,p.n3Ratio,1,'load');line(sx,t3,1.16,t3,'load');dot(1.16,t3,'load');dot(1.66,t3,'load');
      line(1.16,t3,1.66,t3+(p.branch3Closed?0:.20),p.branch3Closed?'load':'gold');
      line(1.66,t3,right,t3,'load');line(right,t3,right,-.25,'load');rect(right-.09,-.55,.18,.30,'load');line(right,-.55,right,b3,'load');line(right,b3,sx,b3,'load');
      label(1.41,.13,p.branch3Closed?'S 闭合':'S 断开','gold');
      label(1.52,-.29,'U₃='+value(c.u3,'V')+' · n₃='+p.n3Ratio,'load');
      label(1.52,-.55,'I₃='+value(c.i3,'A',2)+' · R₃='+p.loadR3+' Ω','load');
      label(-1.72,-.84,'基准：'+p.baselineParallelUsers+' 户，S 断开','muted');
    }else{
      const valid=c.operatingPointValid===1;
      label(0,1.52,'恒送端功率 · 理想升压 / 可调受端变压器','ink');
      const xs=[-2.58,-1.04,.66,2.52],y=.66;
      // Flow diagram, not a single wire crossing isolated transformer windings.
      sine(xs[0]!,y,.30,'source');
      for(const x of [xs[1]!,xs[3]!]){
        rect(x-.22,y-.28,.44,.56,'core',true);
        coil(x-.39,y+.28,y-.28,x<0?2:5,-1,'source');
        coil(x+.39,y+.28,y-.28,x<0?5:2,1,'load');
      }
      rect(xs[2]!-.27,y-.13,.54,.26,'heat');
      const tone:Tone=valid?'source':'muted';
      arrow(xs[0]!+.36,y,xs[1]!-.58,y,tone,!valid);
      arrow(xs[1]!+.58,y,xs[2]!-.36,y,tone,!valid);
      arrow(xs[2]!+.36,y,xs[3]!-.58,y,tone,!valid);
      label(xs[0]!,1.13,'发电机','source');label(xs[1]!,1.13,'升压 k='+p.stepUpRatioK1,'source');
      label(xs[2]!,1.13,'线路 '+p.lineResistanceR+' Ω','heat');label(xs[3]!,1.13,'受端可调变压器','load');
      label(xs[0]!,.17,'U₀='+value(c.uSourceV,'V'),'source');
      if(valid){
        label(xs[0]!,-.10,'P发='+power(c.pInW,true),'source');
        label(xs[1]!,.17,'U送='+value(c.lineVoltageV,'V',0),'source');
        label(xs[1]!,-.10,'I线='+value(c.lineCurrentA,'A',2),'source');
        label(xs[2]!,.17,'压降='+value(c.voltageDropV,'V',0),'heat');
        label(xs[2]!,-.10,'线损='+power(c.pLineLossW,true),'heat');
        label(xs[3]!,.17,'U受='+value(c.u2,'V',0),'load');
        label(xs[3]!,-.10,c.u3>0?'用户 '+value(c.u3,'V',0):'短路极限 · 无母线','load');
      }else{
        label(0,.06,'无无源受端工作点 · 请求功率超过可行域','heat');
        label(0,-.22,'请求 '+power(c.requestedPowerW,true)+'；上限 '+power(c.maxPowerW,true),'gold');
      }
    }
  }
  if(layers.has('powerWaterfall')){
    const y=grid?-.76:-1.12,barLeft=-2.8,barWidth=5.6,barH=.16;
    if(c.operatingPointValid!==1){
      label(0,y,'未建立工作点，不显示伪造的功率分配','heat');
    }else if(c.pInW>0){
      const lossW=barWidth*c.pLineLossW/c.pInW,userW=barWidth*c.pUserW/c.pInW;
      if(userW>0)rect(barLeft,y,userW,barH,'load',true);
      if(lossW>0)rect(barLeft+userW,y,lossW,barH,'heat',true);
      rect(barLeft,y,barWidth,barH,'muted');
      label(0,y+.31,'电源 '+power(c.pInW,grid)+' = 用户 '+power(c.pUserW,grid)+' + 损耗 '+power(c.pLineLossW,grid),'ink');
      label(0,y-.14,'效率 '+(c.efficiency*100).toFixed(2)+'%'+(grid&&b.operatingPointValid===1?' · k=10 基准线损 '+power(b.pLineLossW,true):''),'gold');
    }else{
      rect(barLeft,y,barWidth,barH,'muted');label(0,y+.27,'零输入功率 · 效率未定义','muted');
    }
  }
  if(grid||!layers.has('powerWaterfall')){
    line(rail.left,rail.y,rail.right,rail.y,'gold');for(let j=0;j<=5;j++){const x=rail.left+(rail.right-rail.left)*j/5;line(x,rail.y-.04,x,rail.y+.04,'gold');}
    dot(pos(p),rail.y,'gold');label(pos(p),rail.y+.14,grid?'k='+p.stepUpRatioK1:'R₀='+p.primaryR0+' Ω','gold');
  }else{
    // Multi-mode handle remains separate from the power bar and its label.
    line(rail.left,rail.y,rail.right,rail.y,'gold');dot(pos(p),rail.y,'gold');
  }
  return marks;
}

const channels:readonly TelemetryChannelSpec[]=[
  {key:'u1',label:'原边有效电压',unit:'V',color:'#38bdf8'},
  {key:'u2',label:'副边2 / 受端有效电压',unit:'V',color:'#4ade80'},
  {key:'u3',label:'副边3 / 用户电压',unit:'V',color:'#a78bfa'},
  {key:'pInW',label:'电源总功率',unit:'W',color:'#38bdf8'},
  {key:'pUserW',label:'用户功率',unit:'W',color:'#4ade80'},
  {key:'pLineLossW',label:'串联电阻损耗',unit:'W',color:'#f43f5e'}
];
export const emTransformerGridPlugin=Object.assign(defineSimulationPlugin<TransformerGridParams,TransformerGridState>({
  meta:{id:'em-transformer-grid',title:'理想变压器动态分析与高压输电网 (E08)',textbookRef:'人教版 选择性必修二 第三章 第3–4节',
    curriculumTags:['物理观念','科学思维','科学探究'],difficulty:'高三一轮',version:'2.0.0'},
  defaultView:{minScale:.0001,scale:(_p,v)=>initialView(v).scale,offsetRatioX:(_p,v)=>initialView(v).offsetRatioX,offsetRatioY:(_p,v)=>initialView(v).offsetRatioY},
  paramSchema,presets:transformerGridPresets,
  getParamFields:p=>(p.mode==='long-distance-grid'?['mode','stepUpRatioK1','genPowerKw','sourceU0','lineResistanceR']:
    ['mode','branch3Closed','primaryR0','parallelUsersCount','sourceU0','n1Ratio','n2Ratio','n3Ratio','loadR2','loadR3','baselineParallelUsers']).flatMap(k=>paramSchema.filter(f=>f.key===k)),
  engine:{createInitialState,step:stepTransformerGrid,computeObservables,checkInvariants},
  layers:[{id:'topology',label:'实际场景拓扑',defaultVisible:true},{id:'powerWaterfall',label:'电源功率分配',defaultVisible:true}],
  telemetryChannels:channels,
  getControlHandles:(_s,p)=>[{id:'transformer-adjust',label:p.mode==='long-distance-grid'?'k='+p.stepUpRatioK1:'R₀='+p.primaryR0+' Ω',
    position:{x:pos(p),y:rail.y},handleKind:'point',showWhenIdle:false,color:'#fbbf24',
    onDrag:wp=>{const f=Math.max(0,Math.min(1,(wp.x-rail.left)/(rail.right-rail.left)));return p.mode==='long-distance-grid'?{stepUpRatioK1:5+5*Math.round(7*f)}:{primaryR0:2*Math.round(15*f)};}}],
  sceneSerializer:{exportScene:(_s,p)=>({schemaVersion:'2.0',modelId:'em-transformer-grid',title:'理想变压器与高压输电',params:p}),importScene:dsl=>dsl.params as Partial<TransformerGridParams>},
  exportDiagramIR:(s,p)=>({width:940,height:510,viewBox:bounds,title:p.mode==='long-distance-grid'?'高压输电稳态功率流':'一原双副线圈稳态电路',
    primitives:transformerScene(s,p,new Set(['topology','powerWaterfall'])).map(m=>m.primitive)}),
  renderCanvas:(ctx,s,p,v,layers)=>{
    const m=createWorldMapper(v),paper=v.theme==='projector',
      colors:Record<Tone,string>=paper?{ink:'#0f172a',muted:'#475569',source:'#0369a1',load:'#166534',heat:'#be123c',gold:'#92400e',core:'#64748b'}:
        {ink:'#e2e8f0',muted:'#94a3b8',source:'#38bdf8',load:'#4ade80',heat:'#fb7185',gold:'#fbbf24',core:'#64748b'};
    const labels:CanvasLabel[]=[];
    const path=(points:readonly Point[])=>{if(!points.length)return;const q=m.toScreen(points[0]!.x,points[0]!.y);ctx.beginPath();ctx.moveTo(q.x,q.y);for(const point of points.slice(1)){const a=m.toScreen(point.x,point.y);ctx.lineTo(a.x,a.y);}};
    ctx.save();
    transformerScene(s,p,layers).forEach(({primitive:q,tone,solid},index)=>{
      const color=colors[tone];ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=tone==='core'?3:2;
      if(q.kind==='text'){const a=m.toScreen(q.x,q.y);labels.push({id:'e08-'+index,x:a.x,y:a.y,text:q.text,color,font:tone==='ink'?'bold 13px sans-serif':'12px sans-serif'});return;}
      if(q.kind==='line'||q.kind==='arrow'){
        const a=m.toScreen(q.x1,q.y1),b=m.toScreen(q.x2,q.y2);ctx.setLineDash(q.dashed?[5,4]:[]);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.setLineDash([]);
        if(q.kind==='arrow'){const dx=b.x-a.x,dy=b.y-a.y,n=Math.hypot(dx,dy);if(n>1){const u=dx/n,w=dy/n;ctx.beginPath();ctx.moveTo(b.x,b.y);ctx.lineTo(b.x-8*u+4*w,b.y-8*w-4*u);ctx.lineTo(b.x-8*u-4*w,b.y-8*w+4*u);ctx.closePath();ctx.fill();}}
      }else if(q.kind==='polyline'){path(q.points);ctx.stroke();}
      else if(q.kind==='circle'){const a=m.toScreen(q.cx,q.cy);ctx.beginPath();ctx.arc(a.x,a.y,m.len(q.r),0,2*Math.PI);if(q.fill)ctx.fill();else ctx.stroke();}
      else if(q.kind==='rect'){
        const a=m.toScreen(q.x,q.y+q.height),b=m.toScreen(q.x+q.width,q.y);
        if(solid){const g=ctx.createLinearGradient(a.x,a.y,a.x,b.y);g.addColorStop(0,color);g.addColorStop(1,paper?'#e2e8f0':tone==='core'?'#1e293b':color);ctx.fillStyle=g;ctx.fillRect(a.x,a.y,b.x-a.x,b.y-a.y);}
        ctx.strokeRect(a.x,a.y,b.x-a.x,b.y-a.y);
      }
    });
    resolveAndDrawLabels(ctx,labels,v.width,v.height);ctx.restore();
  },
  formatFormulas:(s,p)=>{
    const c=s.current,grid=p.mode==='long-distance-grid';
    if(c.operatingPointValid!==1)return [{id:'grid-domain',label:'请求不满足无源受端条件 · 无工作点',
      latex:'P_{\\rm req}\\leq U_{\\rm send}^2/R',
      substitutedLatex:(c.requestedPowerW/1000).toFixed(2)+'>'+ (c.maxPowerW/1000).toFixed(2)+'\\;\\mathrm{kW}'}];
    return grid?[
      {id:'grid-line',label:'恒功率送端与线损',latex:'U_s=kU_0,\\quad I=P/U_s,\\quad \\Delta P=I^2 R',substitutedLatex:'I='+c.lineCurrentA.toFixed(2)+'\\,\\mathrm A,\\;\\Delta P='+c.pLineLossW.toFixed(1)+'\\,\\mathrm W'},
      {id:'grid-recv',label:'无源受端 · 理想可调变压器',latex:'U_r=U_s-IR,\\quad P_r=U_r I',substitutedLatex:'U_r='+c.u2.toFixed(1)+'\\,\\mathrm V'},
      {id:'grid-power',label:'电源功率账本',latex:'P=P_r+\\Delta P',substitutedLatex:c.pInW.toFixed(1)+'='+c.pUserW.toFixed(1)+'+'+c.pLineLossW.toFixed(1)+'\\;\\mathrm W'}
    ]:[
      {id:'grid-ratio',label:'理想多副线圈 · 有效值',latex:'U_1/n_1=U_2/n_2=U_3/n_3',substitutedLatex:'U_1='+c.u1.toFixed(1)+'\\,\\mathrm V,\\;U_2='+c.u2.toFixed(1)+'\\,\\mathrm V'},
      {id:'grid-kvl',label:'原边串联电阻',latex:'U_0=U_1+I_1R_0',substitutedLatex:c.uSourceV.toFixed(1)+'='+c.u1.toFixed(1)+'+'+c.voltageDropV.toFixed(1)+'\\;\\mathrm V'},
      {id:'grid-power',label:'电源功率与理想变压器功率分开',latex:'P_0=I_1^2R_0+P_1,\\quad P_1=P_2+P_3',substitutedLatex:c.pInW.toFixed(1)+'='+c.pLineLossW.toFixed(1)+'+'+c.pTransformerInW.toFixed(1)+'\\;\\mathrm W'}
    ];
  }
}),{transformerDiagramBounds,fitTransformerViewport,transformerBoundsFit});
export default emTransformerGridPlugin;
