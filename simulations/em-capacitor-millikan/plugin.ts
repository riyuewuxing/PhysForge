import type { LiveFormulaSpec } from '@physforge/sim-sdk';
import { createWorldMapper, defineSimulationPlugin, resolveAndDrawLabels, type CanvasLabel, type DiagramPrimitive, type ParamFieldSpec, type TelemetryChannelSpec } from '@physforge/sim-sdk';
import { capacitorMillikanPresets } from './presets.js';
import {
  checkInvariants,
  capacitorGeometry,
  DISPLAY_LENGTH_PER_M,
  computeCapacitorMetrics,
  computeObservables,
  createInitialState,
  stepCapacitorMillikan,
  type CapacitorMillikanParams,
  type CapacitorMillikanState
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<CapacitorMillikanParams>[] = [
  {
    key: 'switchMode',
    kind: 'select',
    label: '比较实验模式',
    defaultValue: 'open-const-q',
    options: [
      { value: 'open-const-q', label: '断开后（参考 Q 恒定）' },
      { value: 'closed-const-u', label: '闭合开关（U 恒定）' }
    ]
  },
  {
    key: 'groundMode',
    kind: 'select',
    label: '极板接地位置',
    defaultValue: 'bottom',
    options: [
      { value: 'bottom', label: '下极板接地 (φ下=0)' },
      { value: 'top', label: '上极板接地 (φ上=0)' },
      { value: 'none', label: '中心对称电势参考' }
    ]
  },
  { key: 'sourceVoltageU0', kind: 'number', label: '电压 U₀', unit: 'V', min: -400, max: 400, step: 10, defaultValue: 200 },
  { key: 'distanceMm', kind: 'number', label: '极板间距 d', unit: 'mm', min: 8, max: 40, step: 1, defaultValue: 20 },
  { key: 'refDistanceMm', kind: 'number', label: '断开前参考间距 d₀', unit: 'mm', min: 8, max: 40, step: 1, defaultValue: 20 },
  { key: 'areaRatioS', kind: 'number', label: '正对面积比 S/S₀', unit: '', min: 0.3, max: 1, step: 0.05, defaultValue: 1 },
  { key: 'refAreaRatioS', kind: 'number', label: '断开前参考面积比', unit: '', min: 0.3, max: 1, step: 0.05, defaultValue: 1 },
  { key: 'dielectricEr', kind: 'number', label: '相对介电常数 εr', unit: '', min: 1, max: 6, step: 0.5, defaultValue: 1 },
  { key: 'refDielectricEr', kind: 'number', label: '断开前参考 εr0', unit: '', min: 1, max: 6, step: 0.5, defaultValue: 1 },
  { key: 'probeFracP', kind: 'number', label: '探针点 P 高度比', unit: '', min: 0.1, max: 0.9, step: 0.05, defaultValue: 0.4 },
  { key: 'oilDropEnabled', kind: 'boolean', label: '开启密立根油滴', defaultValue: false },
  { key: 'dropChargeSteps', kind: 'number', label: '油滴多余电子数 n（q=−ne）', unit: '', min: 0, max: 5, step: 1, defaultValue: 2 },
  { key: 'dropMassScale', kind: 'number', label: '油滴质量比 m/m₀', unit: '', min: 0.5, max: 2.5, step: 0.1, defaultValue: 1 },
  { key: 'stokesDrag', kind: 'number', label: '线性阻尼率 β', unit: 's⁻¹', min: 0, max: 12, step: 1, defaultValue: 6 }
];


const liveFormulas: readonly LiveFormulaSpec[] = [{
  "id": "parallel-capacitance",
  "title": "平行板电容（σ=S/S₀，忽略边缘效应）",
  "latex": "C=\\frac{\\varepsilon_0\\htmlClass{pf-live-var}{\\htmlData{param=dielectricEr}{\\varepsilon_r}}S_0\\htmlClass{pf-live-var}{\\htmlData{param=areaRatioS}{\\sigma}}}{\\htmlClass{pf-live-var}{\\htmlData{param=distanceMm}{d}}}",
  "bindings": [
    {
      "tokenKey": "dielectricEr",
      "paramKey": "dielectricEr",
      "label": "相对介电常数 εr",
      "unit": "",
      "min": 1,
      "max": 6,
      "step": 0.5,
      "precision": 2
    },
    {
      "tokenKey": "areaRatioS",
      "paramKey": "areaRatioS",
      "label": "正对面积比 S/S₀",
      "unit": "",
      "min": 0.3,
      "max": 1,
      "step": 0.05,
      "precision": 3
    },
    {
      "tokenKey": "distanceMm",
      "paramKey": "distanceMm",
      "label": "极板间距 d",
      "unit": "mm",
      "min": 8,
      "max": 40,
      "step": 1,
      "precision": 1
    }
  ]
}];
const channels:readonly TelemetryChannelSpec[]=[
  {key:'capacitancePF',label:'电容 C',unit:'pF',color:'#38bdf8'},
  {key:'voltageV',label:'上板相对下板电压 U',unit:'V',color:'#fbbf24'},
  {key:'chargeNC',label:'上板电荷 Q',unit:'nC',color:'#fb7185'},
  {key:'fieldEy',label:'有向场强 Eᵧ',unit:'V/m',color:'#4ade80'},
  {key:'phiPV',label:'探针 P 电势 φP',unit:'V',color:'#f472b6'},
  {key:'storedEnergyUJ',label:'电容储能',unit:'μJ',color:'#a78bfa'},
  {key:'dropHeightMm',label:'油滴实际高度',unit:'mm',color:'#38bdf8'},
  {key:'dropVyMmS',label:'油滴有向速度',unit:'mm/s',color:'#fbbf24'},
  {key:'dropAcceleration',label:'油滴有向加速度',unit:'m/s²',color:'#4ade80'}
];
export const emCapacitorMillikanPlugin = Object.assign(defineSimulationPlugin<CapacitorMillikanParams, CapacitorMillikanState>({
  meta: {
    id: 'em-capacitor-millikan',
    title: '平行板电容器动态分析与密立根油滴 (E02)',
    textbookRef: '人教版 必修第三册 第十章 第4节',
    curriculumTags: ['物理观念', '科学思维', '科学探究'],
    difficulty: '高三一轮',
    version: '2.0.0'
  },
  defaultView: { scale: 1.0, offsetRatioX: -0.06, offsetRatioY: -0.09 },
  paramSchema,
  getParamFields:p=>{
    const keys=['switchMode','sourceVoltageU0','distanceMm','areaRatioS','dielectricEr','groundMode','probeFracP','oilDropEnabled',
      ...(p.switchMode==='open-const-q'?['refDistanceMm','refAreaRatioS','refDielectricEr']:[]),
      ...(p.oilDropEnabled?['dropChargeSteps','dropMassScale','stokesDrag']:[])];
    return keys.flatMap(key=>paramSchema.filter(f=>f.key===key).map(f=>f.key==='sourceVoltageU0'?{...f,label:p.switchMode==='open-const-q'?'断开前参考电压 Uref':'恒压电源 U₀'}:f));
  },
  presets: capacitorMillikanPresets,
  engine: {
    createInitialState,
    step: stepCapacitorMillikan,
    computeObservables,
    checkInvariants
  },
  layers: [
    { id: 'plates', label: '可拖动平行极板与电介质', defaultVisible: true },
    { id: 'electrometer', label: '电压读数与示意静电计', defaultVisible: true },
    { id: 'oilDrop', label: '密立根油滴与 P 点电势探针', defaultVisible: true }
  ],
  telemetryChannels:channels,
  getTelemetryChannels:p=>p.oilDropEnabled?
    [...channels.filter(c=>c.key==='dropHeightMm'||c.key==='dropVyMmS'),...channels.filter(c=>c.key!=='dropHeightMm'&&c.key!=='dropVyMmS')]:
    channels.filter(c=>!c.key.startsWith('drop')),
  getForceVectors:(state,p)=>{
    if(!p.oilDropEnabled)return [];
    const o=computeObservables(state,p),g=capacitorGeometry(p),origin={x:g.dropX,y:-g.halfD+2*g.halfD*state.dropYFrac};
    return [
      {id:'drop-mg',label:'mg',origin,force:{x:0,y:-o.dropWeightN!},category:'gravity',color:'#f59e0b',unit:'N'},
      {id:'drop-qe',label:'qE',origin,force:{x:0,y:o.dropElectricForceN!},category:'electric',color:'#38bdf8',unit:'N'},
      {id:'drop-drag',label:'F阻',origin,force:{x:0,y:o.dropDragForceN!},category:'friction',color:'#4ade80',unit:'N'}
    ];
  },
  referenceFrames:[{
    id:'oil-droplet',label:'油滴随动参考系（绘图尺度）',
    getOrigin:(s,p)=>{const g=capacitorGeometry(p);return {x:g.dropX,y:-g.halfD+2*g.halfD*s.dropYFrac};},
    getVelocity:s=>({x:0,y:s.dropVy*DISPLAY_LENGTH_PER_M})
  }],
  getControlHandles:(_s,p)=>{
    const g=capacitorGeometry(p);
    return [
      {id:'top-plate-dist',label:'d='+p.distanceMm+'mm',position:{x:g.topRight-.2,y:g.halfD},handleKind:'point',color:'#38bdf8',
        showWhenIdle:false,onDrag:wp=>({distanceMm:Math.round(Math.max(8,Math.min(40,Math.abs(wp.y)*2000/DISPLAY_LENGTH_PER_M)))})},
      {id:'top-plate-area',label:'S/S₀='+p.areaRatioS.toFixed(2),position:{x:g.topLeft,y:g.halfD},handleKind:'point',color:'#38bdf8',
        showWhenIdle:false,onDrag:wp=>({areaRatioS:Number(Math.max(.3,Math.min(1,(1.5-wp.x)/3)).toFixed(2))})},
      {id:'probe-p',label:'P ('+(p.probeFracP*100).toFixed(0)+'%)',position:{x:g.probeX,y:-g.halfD+p.probeFracP*2*g.halfD},
        handleKind:'point',showWhenIdle:false,color:'#f472b6',onDrag:wp=>({probeFracP:Number(Math.max(.1,Math.min(.9,(wp.y+g.halfD)/(2*g.halfD))).toFixed(2))})}
    ];
  },
  sceneSerializer: {
    exportScene: (_s, params) => ({
      schemaVersion: '2.0',
      modelId: 'em-capacitor-millikan',
      title: '平行板电容器与密立根油滴',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<CapacitorMillikanParams>
  },
  exportDiagramIR:(state,p)=>{
    const m=computeCapacitorMetrics(p),g=capacitorGeometry(p),d=g.halfD;
    const primitives:DiagramPrimitive[]=[
      {kind:'line',x1:g.topLeft,y1:d,x2:g.topRight,y2:d,strokeWidth:3},
      {kind:'line',x1:-1.5,y1:-d,x2:1.5,y2:-d,strokeWidth:3},
      {kind:'text',x:g.topRight,y:d+.17,text:'上板 '+m.phiTopV.toFixed(1)+' V',align:'end'},
      {kind:'text',x:-1.5,y:-d-.22,text:'下板 '+m.phiBottomV.toFixed(1)+' V'},
      {kind:'circle',cx:g.probeX,cy:-d+p.probeFracP*2*d,r:.035,fill:true},
      {kind:'text',x:g.probeX-.1,y:-d+p.probeFracP*2*d+.15,text:'P '+m.phiPV.toFixed(1)+' V',align:'end'},
      {kind:'text',x:0,y:d+.45,text:'d='+p.distanceMm+' mm · S/S₀='+p.areaRatioS.toFixed(2),align:'middle'}
    ];
    if(p.dielectricEr>1)primitives.push({kind:'rect',x:g.left,y:-d,width:g.right-g.left,height:2*d,hatch:true});
    if(m.fieldEy!==0)for(let k=0;k<5;k++){
      const x=g.left+(k+1)*(g.right-g.left)/6,sign=Math.sign(m.fieldEy);
      primitives.push({kind:'arrow',x1:x,y1:-.68*d*sign,x2:x,y2:.68*d*sign});
    }
    if(p.oilDropEnabled)primitives.push({kind:'circle',cx:g.dropX,cy:-d+2*d*state.dropYFrac,r:.055,fill:true},
      {kind:'text',x:g.dropX+.1,y:-d+2*d*state.dropYFrac+.14,text:'q=−'+p.dropChargeSteps+'e'});
    return {width:820,height:500,viewBox:{minX:-2.2,maxX:Math.max(2.5,g.topRight+.3),minY:-Math.max(1.6,d+.4),maxY:Math.max(1.6,d+.65)},title:'平行板电容器：有向电场与正对面积',primitives};
  },
  renderCanvas:(ctx,state,p,viewport,activeLayers)=>{
    const m=computeCapacitorMetrics(p),g=capacitorGeometry(p),d=g.halfD,mapper=createWorldMapper(viewport);
    const labels:CanvasLabel[]=[],paper=viewport.theme==='projector';
    const ink=paper?'#0f172a':'#e2e8f0',muted=paper?'#475569':'#94a3b8';
    const blue=paper?'#0369a1':'#38bdf8',gold=paper?'#92400e':'#fbbf24',rose=paper?'#be123c':'#fb7185',green=paper?'#166534':'#4ade80';
    const label=(id:string,x:number,y:number,text:string,color=ink,font='13px sans-serif')=>{
      const s=mapper.toScreen(x,y);labels.push({id,x:s.x,y:s.y,text,color,font});
    };
    const line=(x1:number,y1:number,x2:number,y2:number,color:string,width=1.5)=>{
      const a=mapper.toScreen(x1,y1),b=mapper.toScreen(x2,y2);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
    };
    const arrow=(x1:number,y1:number,x2:number,y2:number,color:string)=>{
      const a=mapper.toScreen(x1,y1),b=mapper.toScreen(x2,y2),dx=b.x-a.x,dy=b.y-a.y,n=Math.hypot(dx,dy);if(n<1e-8)return;
      line(x1,y1,x2,y2,color,1.5);const u=dx/n,v=dy/n,h=Math.min(8,n*.25);ctx.fillStyle=color;ctx.beginPath();ctx.moveTo(b.x,b.y);ctx.lineTo(b.x-h*u+h*.44*v,b.y-h*v-h*.44*u);ctx.lineTo(b.x-h*u-h*.44*v,b.y-h*v+h*.44*u);ctx.closePath();ctx.fill();
    };
    const plate=(left:number,right:number,y:number,polarity:number,top:boolean)=>{
      const a=mapper.toScreen(left,y),b=mapper.toScreen(right,y),h=Math.max(7,mapper.len(.065));
      const c=polarity>0?rose:polarity<0?blue:muted;
      const yy=a.y+(top?-h:0);
      const grad=ctx.createLinearGradient(0,yy,0,yy+h);
      grad.addColorStop(0,paper?'#e2e8f0':'#dbeafe');grad.addColorStop(.45,paper?'#64748b':'#64748b');grad.addColorStop(1,paper?'#94a3b8':'#334155');
      ctx.save();ctx.fillStyle=grad;ctx.strokeStyle=c;ctx.lineWidth=1.5;
      if(!paper&&polarity){ctx.shadowColor=c;ctx.shadowBlur=11;}
      ctx.beginPath();ctx.roundRect(a.x,yy,b.x-a.x,h,Math.min(3,h/2));ctx.fill();ctx.stroke();ctx.restore();
      if(polarity)for(let i=0;i<6;i++){
        const x=g.left+(i+1)*(g.right-g.left)/7,pt=mapper.toScreen(x,y+(top?-.09:.09));
        ctx.fillStyle=c;ctx.font='bold 12px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(polarity>0?'+':'−',pt.x,pt.y);
      }
    };
    ctx.save();
    if(activeLayers.has('plates')){
      const a=mapper.toScreen(g.left,d),b=mapper.toScreen(g.right,-d);
      const fieldGrad=ctx.createLinearGradient(a.x,a.y,b.x,b.y);
      fieldGrad.addColorStop(0,paper?'rgba(3,105,161,.04)':'rgba(56,189,248,.05)');
      fieldGrad.addColorStop(.55,p.dielectricEr>1?(paper?'rgba(3,105,161,.15)':'rgba(56,189,248,.23)'):(paper?'rgba(3,105,161,.06)':'rgba(56,189,248,.10)'));
      fieldGrad.addColorStop(1,paper?'rgba(3,105,161,.04)':'rgba(56,189,248,.05)');
      ctx.fillStyle=fieldGrad;ctx.fillRect(a.x,a.y,b.x-a.x,b.y-a.y);
      if(p.dielectricEr>1){ctx.strokeStyle=blue;ctx.setLineDash([4,4]);ctx.strokeRect(a.x,a.y,b.x-a.x,b.y-a.y);ctx.setLineDash([]);}
      if(m.fieldEy!==0)for(let k=0;k<6;k++){
        const x=g.left+(k+1)*(g.right-g.left)/7,sign=Math.sign(m.fieldEy);
        arrow(x,-.62*d*sign,x,.62*d*sign,green);
      }
      plate(g.topLeft,g.topRight,d,Math.sign(m.chargeC),true);
      plate(-1.5,1.5,-d,-Math.sign(m.chargeC),false);
      label('top-potential',(g.topLeft+g.topRight)/2,d+.26,'上板 φ='+m.phiTopV.toFixed(1)+' V',ink,'bold 13px sans-serif');
      label('bottom-potential',0,-d-.25,'下板 φ='+m.phiBottomV.toFixed(1)+' V',ink,'bold 13px sans-serif');
      label('overlap',(g.left+g.right)/2,d+.55,'正对面积 '+(m.area*1e4).toFixed(0)+' cm² · εr='+p.dielectricEr,muted);
      // Actual plate gap dimension, outside the left edge of overlap.
      const x=-1.74;line(x,-d,x,d,muted,1);line(x-.06,-d,x+.06,-d,muted);line(x-.06,d,x+.06,d,muted);
      label('gap',x-.18,0,'d='+p.distanceMm+' mm',muted);
      if(p.groundMode!=='none'){
        const top=p.groundMode==='top',x=top?g.topRight:1.5,y=top?d:-d,sign=top?1:-1;
        line(x,y,x+.2,y,gold);line(x+.2,y,x+.2,y+sign*.17,gold);
        for(let i=0;i<3;i++){const w=.10-i*.027,gy=y+sign*(.17+i*.055);line(x+.2-w,gy,x+.2+w,gy,gold);}
      }else label('gauge',-1.25,-d-.5,'中面零势（约定）',muted);
      label('field-label',(g.left+g.right)/2,-d-.53,m.fieldEy===0?'Eᵧ=0':'Eᵧ='+m.fieldEy.toExponential(2)+' V/m',green);
    }
    if(activeLayers.has('oilDrop')){
      const py=-d+p.probeFracP*2*d,probe=mapper.toScreen(g.probeX,py);
      ctx.fillStyle=rose;ctx.beginPath();ctx.arc(probe.x,probe.y,4.5,0,Math.PI*2);ctx.fill();
      label('probe',g.probeX-.15,py+.17,'P · '+m.phiPV.toFixed(1)+' V',rose,'bold 13px sans-serif');
      if(p.oilDropEnabled){
        const y=-d+2*d*state.dropYFrac,pt=mapper.toScreen(g.dropX,y),r=Math.max(5,mapper.len(.045));
        ctx.save();if(!paper){ctx.shadowColor=gold;ctx.shadowBlur=13;}
        ctx.fillStyle=gold;ctx.beginPath();ctx.arc(pt.x,pt.y,r,0,Math.PI*2);ctx.fill();ctx.restore();
        label('drop',g.dropX+.14,y-.12,state.terminal?'触板 · 停止':'q=−'+Math.round(p.dropChargeSteps)+'e',gold,'bold 13px sans-serif');
      }
    }
    if(activeLayers.has('electrometer')){
      const x=Math.max(2.35,g.topRight+.15),meter=mapper.toScreen(x,-.15),r=Math.max(27,mapper.len(.34));
      ctx.save();ctx.fillStyle=paper?'#f8fafc':'#0b172b';ctx.strokeStyle=muted;ctx.lineWidth=2;
      ctx.beginPath();ctx.arc(meter.x,meter.y,r,0,Math.PI*2);ctx.fill();ctx.stroke();
      for(let k=0;k<=8;k++){const angle=(-90+k*10)*Math.PI/180;ctx.strokeStyle=muted;ctx.beginPath();ctx.moveTo(meter.x+r*.76*Math.cos(angle),meter.y+r*.76*Math.sin(angle));ctx.lineTo(meter.x+r*.89*Math.cos(angle),meter.y+r*.89*Math.sin(angle));ctx.stroke();}
      const angle=(state.electrometerAngleDeg-90)*Math.PI/180;ctx.strokeStyle=rose;ctx.lineWidth=2.4;ctx.beginPath();ctx.moveTo(meter.x,meter.y);ctx.lineTo(meter.x+r*.72*Math.cos(angle),meter.y+r*.72*Math.sin(angle));ctx.stroke();
      ctx.fillStyle=ink;ctx.font='bold 12px monospace';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(m.voltageV.toFixed(0)+' V',meter.x,meter.y+r*.46);ctx.restore();
      label('meter-title',x,-.15-.58,'静电计 · 指针示意',muted);
      label('mode',x,-.15-.82,p.switchMode==='open-const-q'?'参考 Q 恒定':'电源 U 恒定',gold,'bold 13px sans-serif');
    }
    ctx.textBaseline='alphabetic';resolveAndDrawLabels(ctx,labels,viewport.width,viewport.height);ctx.restore();
  },
  formatFormulas:(state,p)=>{
    const m=computeCapacitorMetrics(p),o=computeObservables(state,p);
    const items=[
      {id:'cap-main',label:'平行板电容（忽略边缘）',latex:'C=\\frac{\\varepsilon_0\\varepsilon_r S}{d}',substitutedLatex:'C='+o.capacitancePF!.toFixed(3)+'\\,\\mathrm{pF}'},
      {id:'cap-mode',label:p.switchMode==='open-const-q'?'固定断开前参考电荷':'恒压电源',latex:p.switchMode==='open-const-q'?'Q=Q_{\\rm ref}=C_{\\rm ref}U_{\\rm ref},\\quad U=Q/C':'U=U_0,\\quad Q=CU_0',substitutedLatex:'Q='+o.chargeNC!.toFixed(3)+'\\,\\mathrm{nC},\\quad U='+m.voltageV.toFixed(2)+'\\,\\mathrm V'},
      {id:'cap-field',label:'向上为正；U=φ上−φ下',latex:'E_y=-\\frac{U}{d},\\quad\\varphi_P=\\varphi_{\\rm bot}+Uf_P',substitutedLatex:'E_y='+m.fieldEy.toFixed(1)+'\\,\\mathrm{V/m},\\quad\\varphi_P='+m.phiPV.toFixed(2)+'\\,\\mathrm V'}
    ];
    if(p.oilDropEnabled)items.push(
      {id:'drop-quantum',label:'真实元电荷 · 示教质量与线性阻尼',latex:'q=-ne,\\quad e=1.602176634\\times10^{-19}\\,\\mathrm C',substitutedLatex:'q=-'+o.dropChargeSteps+'e'},
      {id:'drop-dynamics',label:state.terminal?'首次触板，碰撞前终止':'有向油滴运动方程',latex:'\\dot v=qE_y/m-g-\\beta v',substitutedLatex:'v='+o.dropVyMmS!.toFixed(3)+'\\,\\mathrm{mm/s},\\quad a='+o.dropAcceleration!.toFixed(3)+'\\,\\mathrm{m/s^2}'});
    return items;
  }
}), { liveFormulas });

export default emCapacitorMillikanPlugin;
