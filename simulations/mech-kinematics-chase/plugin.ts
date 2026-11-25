import { createWorldMapper, defineSimulationPlugin, type DiagramPrimitive, type ParamFieldSpec } from '@physforge/sim-sdk';
import { kinematicsChasePresets } from './presets.js';
import {
  checkInvariants,
  computeObservables,
  createInitialState,
  stepKinematicsChase,
  type KinematicsChaseParams,
  type KinematicsChaseState
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<KinematicsChaseParams>[] = [
  {
    key: 'scenario',
    kind: 'select',
    label: '追及相遇情景',
    options: [
      { label: '刹车防撞临界（含反应时间）', value: 'brake-collision-avoid' },
      { label: '匀加速追及匀速（共速极值+相遇）', value: 'accelerate-chase' },
      { label: '双车制动单向锁止分析', value: 'two-stage-overtake' }
    ],
    defaultValue: 'accelerate-chase'
  },
  { key: 'vA0', kind: 'number', label: 'A车初速度 vA0', unit: 'm/s', min: 0, max: 35, step: 1, defaultValue: 0 },
  { key: 'aA', kind: 'number', label: 'A车加速度 aA', unit: 'm/s²', min: -10, max: 8, step: 0.5, defaultValue: 2 },
  { key: 'reactionTime', kind: 'number', label: 'A车反应时间 t反', unit: 's', min: 0, max: 1.5, step: 0.1, defaultValue: 0 },
  { key: 'xB0', kind: 'number', label: '初始间距 xB0', unit: 'm', min: 5, max: 80, step: 1, defaultValue: 16 },
  { key: 'vB0', kind: 'number', label: 'B车初速度 vB0', unit: 'm/s', min: 0, max: 25, step: 1, defaultValue: 8 },
  { key: 'aB', kind: 'number', label: 'B车加速度 aB', unit: 'm/s²', min: -8, max: 6, step: 0.5, defaultValue: 0 }
];

/** View extent is an explicitly labelled ten-second teaching horizon, not a physics limit. */
function teachingExtent(p:KinematicsChaseParams):number {
  const q=stepKinematicsChase(createInitialState(p),p,10).nextState;
  return Math.max(30,q.xA,q.xB,p.xB0)*1.12;
}
function laneHalf(p:KinematicsChaseParams):number{return teachingExtent(p)*.065;}
function tickStep(span:number):number{
  const raw=span/8,pow=10**Math.floor(Math.log10(raw)),r=raw/pow;
  return (r<=1?1:r<=2?2:r<=5?5:10)*pow;
}
export const mechKinematicsChasePlugin=defineSimulationPlugin<KinematicsChaseParams,KinematicsChaseState>({
  meta:{id:'mech-kinematics-chase',title:'运动学追及相遇与多过程图像 (M01)',textbookRef:'人教版 必修第一册 第二章 第4节',curriculumTags:['物理观念','科学思维','科学探究'],difficulty:'高三一轮',version:'2.0.0'},
  defaultView:{minScale:.001,scale:(p,{width,height})=>.58*width/(teachingExtent(p)*.24*Math.min(width,height)),offsetRatioX:-.30,offsetRatioY:-.07},
  paramSchema,presets:kinematicsChasePresets,
  engine:{createInitialState,step:stepKinematicsChase,computeObservables,checkInvariants},
  layers:[{id:'cars',label:'A/B 质点示意',defaultVisible:true},{id:'eventPins',label:'精确临界事件',defaultVisible:true}],
  telemetryChannels:[
    {key:'vA',label:'A车速度 vA',unit:'m/s',color:'#38bdf8'},
    {key:'vB',label:'B车速度 vB',unit:'m/s',color:'#f472b6'},
    {key:'xA',label:'A车位置 xA',unit:'m',color:'#38bdf8'},
    {key:'xB',label:'B车位置 xB',unit:'m',color:'#f472b6'},
    {key:'deltaX',label:'有向位置差 xB−xA',unit:'m',color:'#4ade80'},
    {key:'minGap',label:'历史最小间距',unit:'m',color:'#fbbf24'},
    {key:'aA',label:'A车加速度',unit:'m/s²',color:'#38bdf8'},
    {key:'aB',label:'B车加速度',unit:'m/s²',color:'#f472b6'}
  ],
  // Kinematics alone does not supply masses or a force decomposition.
  getControlHandles:(s,p)=>s.t===0?[{id:'initial-gap',label:'初始间距',position:{x:s.xB,y:-laneHalf(p)},handleKind:'point',color:'#f472b6',onDrag:wp=>({xB0:Math.max(5,Math.min(80,Math.round(wp.x)))})}]:[],
  referenceFrames:[{id:'car-a',label:'A车随动坐标（平移）',description:'仅平移原点；A 加速时为非惯性参考系。',getOrigin:s=>({x:s.xA,y:0}),getVelocity:s=>({x:s.vA,y:0})}],
  sceneSerializer:{exportScene:(_s,params)=>({schemaVersion:'2.0',modelId:'mech-kinematics-chase',title:'追及相遇多过程',params}),importScene:dsl=>dsl.params as Partial<KinematicsChaseParams>},
  exportDiagramIR:(s,p,options)=>{
    const span=Math.max(teachingExtent(p),s.xA,s.xB),lane=laneHalf(p),w=teachingExtent(p)*.035,h=w*.56,margin=span*.10;
    const primitives:DiagramPrimitive[]=[
      {kind:'line',x1:-margin,y1:0,x2:span+margin,y2:0},
      {kind:'line',x1:s.xA,y1:-lane,x2:s.xA,y2:lane,dashed:true},
      {kind:'line',x1:s.xB,y1:-lane,x2:s.xB,y2:lane,dashed:true},
      {kind:'block',cx:s.xA,cy:lane,width:w,height:h,label:'A'},
      {kind:'block',cx:s.xB,cy:-lane,width:w,height:h,label:'B'},
      {kind:'mathLabel',x:s.xA,y:lane+h*1.4,text:'x_A='+s.xA.toFixed(2)+' m',align:'middle'},
      {kind:'mathLabel',x:s.xB,y:-lane-h*1.4,text:'x_B='+s.xB.toFixed(2)+' m',align:'middle'},
      {kind:'mathLabel',x:span*.5,y:lane*2.3,text:'|\\Delta x|='+Math.abs(s.xB-s.xA).toFixed(2)+' m',align:'middle'}
    ];
    if(options?.showVelocityVectors!==false){
      if(s.vA>0)primitives.push({kind:'arrow',x1:s.xA,y1:lane+h,x2:s.xA+s.vA*.5,y2:lane+h,label:'v_A'});
      if(s.vB>0)primitives.push({kind:'arrow',x1:s.xB,y1:-lane+h,x2:s.xB+s.vB*.5,y2:-lane+h,label:'v_B'});
    }
    return {width:900,height:440,viewBox:{minX:-margin,maxX:span+margin+Math.max(s.vA,s.vB)*.5,minY:-lane*2.9,maxY:lane*2.9},title:'一维质点追及相遇（分行仅为示意）',primitives};
  },
  formatFormulas:(s,p)=>[
    {id:'chase-eq',label:'有向位置差与相对速度',latex:String.raw`\Delta x=x_B-x_A,\quad\dot{\Delta x}=v_B-v_A`,substitutedLatex:`\\Delta x=${(s.xB-s.xA).toFixed(3)}\\,\\mathrm m`},
    {id:'chase-kinematics',label:'每个恒加速度段独立求解；停止后 a=0',latex:String.raw`x=x_s+v_s\tau+\tfrac12a\tau^2`,substitutedLatex:`v_A=${s.vA.toFixed(2)},\\;v_B=${s.vB.toFixed(2)}\\,\\mathrm{m/s}`},
    {id:'chase-gap',label:'实际间距与历史最小间距',latex:String.raw`d=|\Delta x|,\quad d_{\min}=\min_{0\le u\le t}d(u)`,substitutedLatex:`d_{\\min}=${s.minGap.toFixed(3)}\\,\\mathrm m`}
  ],
  renderCanvas:(ctx,s,p,vp,layers)=>{
    const m=createWorldMapper(vp),paper=vp.theme==='projector',extent=teachingExtent(p),lane=laneHalf(p),span=Math.max(extent,s.xA,s.xB)*1.04;
    const axis=paper?'#64748b':'#64748b',ink=paper?'#1e293b':'#e2e8f0',blue=paper?'#0369a1':'#38bdf8',pink=paper?'#be185d':'#f472b6',amber=paper?'#92400e':'#fbbf24';
    const line=(x1:number,y1:number,x2:number,y2:number,color:string,width=1,dashed=false)=>{const a=m.toScreen(x1,y1),b=m.toScreen(x2,y2);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.setLineDash(dashed?[5,5]:[]);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.setLineDash([]);};
    const text=(x:number,y:number,label:string,color:string,align:CanvasTextAlign='center')=>{const q=m.toScreen(x,y);ctx.fillStyle=color;ctx.font='12px system-ui';ctx.textAlign=align;ctx.fillText(label,q.x,q.y);};
    ctx.save();
    line(-extent*.08,0,span,0,axis,1.5);
    line(-extent*.08,lane,span,lane,axis,1,true);
    line(-extent*.08,-lane,span,-lane,axis,1,true);
    const tick=tickStep(span);
    for(let x=0;x<=span;x+=tick){line(x,-lane*.10,x,lane*.10,axis,1);text(x,-lane*.27,String(Number(x.toPrecision(5))),ink);}
    text(span,0,'x / m',ink,'left');
    text(-extent*.055,lane*1.55,'A',blue,'left');text(-extent*.055,-lane*1.55,'B',pink,'left');
    if(layers.has('cars')){
      const size=Math.max(10,Math.min(30,m.len(extent*.035))),height=size*.62;
      for(const car of [{name:'A',x:s.xA,v:s.vA,a:s.aACurrent,y:lane,c:blue},{name:'B',x:s.xB,v:s.vB,a:s.aBCurrent,y:-lane,c:pink}]){
        const q=m.toScreen(car.x,car.y);
        line(car.x,0,car.x,car.y,car.c,1,true);
        ctx.fillStyle=car.c;ctx.beginPath();ctx.roundRect(q.x-size*.5,q.y-height*.5,size,height,Math.min(4,height*.2));ctx.fill();
        ctx.fillStyle=paper?'#fff':'#0f172a';ctx.font='bold 11px system-ui';ctx.textAlign='center';ctx.fillText(car.name,q.x,q.y+4);
        ctx.fillStyle=car.c;ctx.font='12px ui-monospace,monospace';ctx.fillText(`x=${car.x.toFixed(2)} m · v=${car.v.toFixed(2)} m/s`,q.x,q.y+(car.name==='A'?-height*.5-10:height*.5+16));
      }
      if(Math.abs(s.xB-s.xA)>0)line(Math.min(s.xA,s.xB),lane*2,Math.max(s.xA,s.xB),lane*2,amber,2);
      text((s.xA+s.xB)/2,lane*2.25,`d = ${Math.abs(s.xB-s.xA).toFixed(2)} m`,amber);
    }
    if(layers.has('eventPins')){
      // Same-instant events are distinct records; combine their labels into one readable pin.
      const groups=new Map<number,typeof s.events[number][]>();
      for(const ev of s.events){const a=groups.get(ev.time)??[];a.push(ev);groups.set(ev.time,a);}
      for(const [t,evs] of groups){
        // Stop positions belong to their own car, not always A.
        for(const ev of evs){if(!ev.position)continue;const q=m.toScreen(ev.position.x,0);ctx.fillStyle=amber;ctx.beginPath();ctx.arc(q.x,q.y,4,0,Math.PI*2);ctx.fill();}
        const ev=evs[0]!,x=ev.position?.x??s.xA,q=m.toScreen(x,-lane*2);
        ctx.fillStyle=amber;ctx.textAlign='center';ctx.font='11px system-ui';
        const names=evs.map(e=>e.id.startsWith('stop-a')?'A停':e.id.startsWith('stop-b')?'B停':e.id.startsWith('co-vel')?'共速':'相遇').join(' / ');
        ctx.fillText(names+' '+t.toFixed(3)+'s',q.x,q.y);
      }
    }
    ctx.restore();
  }
});
export default mechKinematicsChasePlugin;
