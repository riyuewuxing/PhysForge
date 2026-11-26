import { degToRad, radToDeg } from '@physforge/physics-core';
import { createWorldMapper, defineSimulationPlugin, type DiagramPrimitive, type ForceVectorItem, type ParamFieldSpec } from '@physforge/sim-sdk';
import { shmResonancePresets } from './presets.js';
import {
  angularDriveAt,
  checkInvariants,
  computeLinearResponseAmplitude,
  computeReferenceCircle,
  effectiveDamping,
  computeNaturalOmega,
  computeObservables,
  computeTheoreticalResonanceOmega,
  createInitialState,
  stepShmResonance,
  type ShmResonanceParams,
  type ShmResonanceState
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<ShmResonanceParams>[] = [
  {
    key: 'mode',
    kind: 'select',
    label: '振动模式',
    defaultValue: 'pendulum-compare',
    options: [
      { value: 'pendulum-compare', label: '非线性摆 vs 简谐幽灵摆' },
      { value: 'damped-free', label: '阻尼自由衰减振动' },
      { value: 'forced-resonance', label: '受迫振动与共振峰' }
    ]
  },
  { key: 'lengthL', kind: 'number', label: '摆长 L', unit: 'm', min: 0.4, max: 3, step: 0.1, defaultValue: 1 },
  { key: 'gravityG', kind: 'number', label: '重力加速度 g', unit: 'm/s²', min: 1.6, max: 20, step: 0.2, defaultValue: 9.8 },
  { key: 'massM', kind: 'number', label: '摆球质量 m', unit: 'kg', min: 0.5, max: 5, step: 0.5, defaultValue: 1 },
  { key: 'initialAngleDeg', kind: 'number', label: '初始摆角 θ₀', unit: '°', min: 0, max: 90, step: 1, defaultValue: 20 },
  { key: 'dampingGamma', kind: 'number', label: '阻尼系数 γ', unit: 's⁻¹', min: 0, max: 1.2, step: 0.05, defaultValue: 0.45 },
  { key: 'driveAccelAmp', kind: 'number', label: '受迫驱动幅值 F₀/mL', unit: 's⁻²', min: 0, max: 3, step: 0.1, defaultValue: 0.8 },
  { key: 'driveOmega', kind: 'number', label: '驱动角频率 ωd', unit: 'rad/s', min: 0.5, max: 8, step: 0.05, defaultValue: 3.06 }
];

export const mechShmResonancePlugin = defineSimulationPlugin<ShmResonanceParams, ShmResonanceState>({
  meta: {
    id: 'mech-shm-resonance',
    title: '简谐振动、非线性单摆与受迫共振 (M11)',
    textbookRef: '人教版 选择性必修一 第二章',
    curriculumTags: ['物理观念', '科学探究', '科学思维'],
    difficulty: '压轴专题',
    version: '2.0.0'
  },
  defaultView: {
    scale: p => Math.min(1, (p.mode==='forced-resonance'?0.85:1.3)/p.lengthL),
    offsetRatioX: -0.01,
    offsetRatioY: p => p.mode==='forced-resonance' ? -0.04 : -0.29
  },
  paramSchema,
  getParamFields: p => paramSchema.filter(f =>
    f.key!=='dampingGamma' && f.key!=='driveAccelAmp' && f.key!=='driveOmega' ||
    f.key==='dampingGamma' && p.mode!=='pendulum-compare' ||
    (f.key==='driveAccelAmp' || f.key==='driveOmega') && p.mode==='forced-resonance'
  ),
  presets: shmResonancePresets,
  engine: {
    createInitialState,
    step: stepShmResonance,
    computeObservables,
    checkInvariants
  },
  layers: [
    { id: 'pendulum', label: '非线性摆与等时性幽灵摆', defaultVisible: true },
    { id: 'referenceCircle', label: '参考圆投影联动', defaultVisible: true },
    { id: 'resonanceCurve', label: '线性理论幅频响应', defaultVisible: true }
  ],
  telemetryChannels: [
    { key: 'thetaRad', label: '摆角 θ (x轴相图)', unit: 'rad', color: '#38bdf8' },
    { key: 'omega', label: '角速度 ω (y轴相图)', unit: 'rad/s', color: '#4ade80' },
    { key: 'thetaLinearRad', label: '简谐幽灵摆 θ_lin', unit: 'rad', color: '#f472b6' },
    { key: 'mechanicalEnergy', label: '机械能 E', unit: 'J', color: '#fbbf24' },
    { key: 'heatLostJ', label: '累计耗散 Q', unit: 'J', color: '#fb923c' },
    { key: 'driveWorkJ', label: '外驱有符号功 W', unit: 'J', color: '#a78bfa' }
  ],
  getForceVectors: (state, params) => {
    const L = params.lengthL;
    const bx = L * Math.sin(state.theta);
    const by = -L * Math.cos(state.theta);
    const tMag = params.massM * params.gravityG * Math.cos(state.theta) + params.massM * L * state.omega * state.omega;
    const forces: ForceVectorItem[] = [
      {
        id: 'mg',
        origin: { x: bx, y: by },
        force: { x: 0, y: -params.massM * params.gravityG },
        label: 'mg',
        category: 'gravity',
        color: '#f59e0b'
      },
      {
        id: 'tension',
        origin: { x: bx, y: by },
        force: { x: -tMag * Math.sin(state.theta), y: tMag * Math.cos(state.theta) },
        label: 'R',
        category: 'tension',
        color: '#38bdf8'
      }
    ];
    const tangent = {x: Math.cos(state.theta), y: Math.sin(state.theta)};
    const damping = -2*effectiveDamping(params)*params.massM*L*state.omega;
    const drive = params.massM*L*angularDriveAt(params,state.t);
    if (damping!==0) forces.push({id:'damping',origin:{x:bx,y:by},
      force:{x:damping*tangent.x,y:damping*tangent.y},label:'Fγ',category:'friction',color:'#fb923c'});
    if (drive!==0) forces.push({id:'drive',origin:{x:bx,y:by},
      force:{x:drive*tangent.x,y:drive*tangent.y},label:'Fd',category:'other',color:'#a78bfa'});
    return forces;
  },
  getControlHandles: (s, params) => {
    if(s.t!==0) return [];
    const L = params.lengthL;
    const rad = degToRad(params.initialAngleDeg);
    return [
      {
        id: 'initial-angle',
        label: `θ₀=${params.initialAngleDeg.toFixed(0)}°`,
        position: { x: L * Math.sin(rad), y: -L * Math.cos(rad) },
        handleKind: 'angle',
        color: '#38bdf8',
        onDrag: (wp) => {
          const deg = Math.abs(radToDeg(Math.atan2(wp.x, -wp.y)));
          return { initialAngleDeg: Number(Math.max(0, Math.min(90, deg)).toFixed(0)) };
        }
      }
    ];
  },
  referenceFrames: [
    {
      id: 'shm-bob',
      label: '摆球随动参考系',
      getOrigin: (s, p) => ({ x: p.lengthL * Math.sin(s.theta), y: -p.lengthL * Math.cos(s.theta) }),
      getVelocity: (s, p) => ({ x: p.lengthL * Math.cos(s.theta) * s.omega, y: p.lengthL * Math.sin(s.theta) * s.omega })
    }
  ],
  sceneSerializer: {
    exportScene: (_s, params) => ({
      schemaVersion: '2.0',
      modelId: 'mech-shm-resonance',
      title: '简谐与受迫共振模型',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<ShmResonanceParams>
  },
  exportDiagramIR: (state, params) => {
    const L = params.lengthL;
    const bx = L * Math.sin(state.theta);
    const by = -L * Math.cos(state.theta);
    const primitives: DiagramPrimitive[] = [
      { kind: 'line', x1: -0.6, y1: 0, x2: 0.6, y2: 0, strokeWidth: 2 },
      { kind: 'line', x1: 0, y1: 0, x2: 0, y2: -L - 0.2, dashed: true },
      { kind: 'line', x1: 0, y1: 0, x2: bx, y2: by },
      { kind: 'circle', cx: bx, cy: by, r: 0.1 },
      {
        kind: 'arcAngle',
        cx: 0,
        cy: 0,
        r: Math.min(0.35,0.35*L),
        startAngle: -90,
        endAngle: -90 + radToDeg(Math.atan2(Math.sin(state.theta),Math.cos(state.theta))),
        label: '\\theta'
      },
      {
        kind: 'mathLabel',
        x: Math.max(1.5,L+0.2),
        y: -0.3,
        text: `L=${L.toFixed(1)}\\text{m},\\; \\omega_0=${computeNaturalOmega(params).toFixed(2)}`,
        align: 'end'
      }
    ];
    if(params.mode==='pendulum-compare'){
      const gx=L*Math.sin(state.thetaLinear), gy=-L*Math.cos(state.thetaLinear);
      primitives.push({kind:'line',x1:0,y1:0,x2:gx,y2:gy,dashed:true},
        {kind:'circle',cx:gx,cy:gy,r:0.08,dashed:true});
    }
    const bound=Math.max(1.8,L+0.45);
    return {
      width: 640,
      height: 440,
      viewBox: { minX: -bound, minY: -Math.max(2.2,L+0.45), maxX: bound, maxY: Math.max(0.4,by+0.25,params.mode==='forced-resonance'?L+0.2:0.4) },
      title: '单摆与受迫振动配图',
      primitives
    };
  },
  renderCanvas: (ctx, state, params, viewport, activeLayers) => {
    const m = createWorldMapper(viewport);
    const pivot = m.toScreen(0, 0);
    const pivotX = pivot.x;
    const pivotY = pivot.y;
    const L = params.lengthL;

    const paper=viewport.theme==='projector';
    const ink=paper?'#0f172a':'#e2e8f0';
    const guide=paper?'#64748b':'#94a3b8';
    const blue=paper?'#0369a1':'#38bdf8';
    const pink=paper?'#be185d':'#f472b6';
    const green=paper?'#166534':'#4ade80';
    ctx.save();
    ctx.font='13px sans-serif';
    if (activeLayers.has('pendulum')) {
      ctx.strokeStyle=guide; ctx.lineWidth=3;
      ctx.beginPath();ctx.moveTo(m.toX(-0.324),pivotY);ctx.lineTo(m.toX(0.324),pivotY);ctx.stroke();
      ctx.fillStyle=ink;ctx.beginPath();ctx.arc(pivotX,pivotY,4,0,2*Math.PI);ctx.fill();
      const equilibrium=m.toScreen(0,-L-0.18);
      ctx.strokeStyle=guide;ctx.lineWidth=1;ctx.setLineDash([4,4]);
      ctx.beginPath();ctx.moveTo(pivotX,pivotY);ctx.lineTo(equilibrium.x,equilibrium.y);ctx.stroke();ctx.setLineDash([]);
      const ghost=m.toScreen(L*Math.sin(state.thetaLinear),-L*Math.cos(state.thetaLinear));
      ctx.strokeStyle=pink;ctx.lineWidth=1.6;ctx.setLineDash([5,4]);
      ctx.beginPath();ctx.moveTo(pivotX,pivotY);ctx.lineTo(ghost.x,ghost.y);ctx.stroke();
      ctx.beginPath();ctx.arc(ghost.x,ghost.y,Math.max(4,m.len(0.08)),0,2*Math.PI);ctx.stroke();ctx.setLineDash([]);
      const bob=m.toScreen(L*Math.sin(state.theta),-L*Math.cos(state.theta));
      ctx.strokeStyle=ink;ctx.lineWidth=2.2;
      ctx.beginPath();ctx.moveTo(pivotX,pivotY);ctx.lineTo(bob.x,bob.y);ctx.stroke();
      const radius=Math.max(4,m.len(0.06));
      ctx.save();
      if(!paper){
        const grad=ctx.createRadialGradient(bob.x-radius*.32,bob.y-radius*.35,radius*.04,bob.x,bob.y,radius);
        grad.addColorStop(0,'#e0f2fe');grad.addColorStop(.38,blue);grad.addColorStop(1,'#075985');
        ctx.fillStyle=grad;ctx.shadowColor=blue;ctx.shadowBlur=12;
      }else{ctx.fillStyle='#bae6fd';}
      ctx.beginPath();ctx.arc(bob.x,bob.y,radius,0,2*Math.PI);ctx.fill();
      ctx.strokeStyle=blue;ctx.lineWidth=1;ctx.stroke();ctx.restore();
      // Actual angle from vertical, with a principal-angle arc (unwrapped theta remains in telemetry).
      const theta=Math.atan2(Math.sin(state.theta),Math.cos(state.theta));
      if(Math.abs(theta)>0.03){
        ctx.strokeStyle=blue;ctx.lineWidth=1.5;ctx.beginPath();
        ctx.arc(pivotX,pivotY,Math.min(m.len(L*.25),60),Math.PI/2,Math.PI/2-theta,theta>0);ctx.stroke();
      }
      ctx.fillStyle=ink;ctx.textAlign='center';
      ctx.fillText('理想刚性杆 · '+(params.mode==='pendulum-compare'?'无阻尼自由摆':params.mode==='damped-free'?'阻尼自由摆':'受迫阻尼摆'),pivotX,pivotY-16);
    }
    // Independent diagrams use a world-anchored card, preserving manual pan and zoom.
    // The phase plot is explicitly normalized, not a second world-scale pendulum.
    const worldWidth=Math.max(1.05,1.05*L);
    ctx.save();
    ctx.translate(m.toX(-L-worldWidth-0.28),m.toY(0.35*L));
    const u=m.len(worldWidth)/238;
    ctx.scale(u,u);
    const cardW=238,cardH=184,left=0,top=0;
    const panel=()=>{
      ctx.fillStyle=paper?'rgba(248,250,252,.97)':'rgba(15,23,42,.9)';
      ctx.strokeStyle=paper?'#94a3b8':'rgba(148,163,184,.4)';ctx.lineWidth=1;
      ctx.beginPath();ctx.roundRect(left,top,cardW,cardH,9);ctx.fill();ctx.stroke();
      ctx.textAlign='left';ctx.font='bold 13px sans-serif';ctx.fillStyle=ink;
    };
    const phase=computeReferenceCircle(state,params);
    if(phase&&activeLayers.has('referenceCircle')&&cardW>=142&&viewport.height>=300){
      panel();ctx.fillText('线性参考圆（归一化）',left+10,top+20);
      const cx=left+cardW/2,cy=top+92,rr=Math.min(48,cardW*.25);
      ctx.strokeStyle=guide;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(cx-rr-9,cy);ctx.lineTo(cx+rr+9,cy);ctx.stroke();
      ctx.strokeStyle=green;ctx.fillStyle=green;
      if(phase.radius>0){
        const x=cx+rr*phase.x/phase.radius,y=cy-rr*phase.y/phase.radius;
        ctx.beginPath();ctx.arc(cx,cy,rr,0,2*Math.PI);ctx.stroke();
        ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(x,y);ctx.stroke();
        ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x,cy);ctx.stroke();ctx.setLineDash([]);
        ctx.beginPath();ctx.arc(x,y,4,0,2*Math.PI);ctx.fill();ctx.beginPath();ctx.arc(x,cy,3,0,2*Math.PI);ctx.fill();
      }else{ctx.beginPath();ctx.arc(cx,cy,4,0,2*Math.PI);ctx.fill();}
      ctx.fillStyle=ink;ctx.font='12px sans-serif';ctx.fillText('A = '+phase.radius.toFixed(3)+' m',left+10,top+151);
      ctx.fillText('X = Lθlin = '+phase.x.toFixed(3)+' m',left+10,top+169);
    }
    if(activeLayers.has('resonanceCurve')&&params.mode==='forced-resonance'&&cardW>=142&&viewport.height>=300){
      panel();ctx.fillText('线性理论幅频响应',left+10,top+20);
      ctx.font='12px sans-serif';ctx.fillStyle=ink;
      const w0=computeNaturalOmega(params), gamma=effectiveDamping(params);
      const peak=computeTheoreticalResonanceOmega(params);
      const amp=computeLinearResponseAmplitude(params,params.driveOmega);
      if(gamma===0){
        ctx.fillText('γ = 0：暂态不衰减',left+10,top+49);
        ctx.fillText('ωd = ω₀ 时非零驱动无有限峰',left+10,top+70);
        ctx.fillText(amp===null?'当前：无有限周期特解':'特解幅值 '+amp.toFixed(3)+' rad',left+10,top+93);
      }else{
        const x0=left+25,y0=top+135,ww=cardW-40,hh=92;
        const wMax=Math.max(w0*2,params.driveOmega*1.08,1);
        const maxAmp=computeLinearResponseAmplitude(params,peak)??0;
        const yScale=maxAmp>0?maxAmp:1;
        ctx.strokeStyle=guide;ctx.beginPath();ctx.moveTo(x0,y0-hh);ctx.lineTo(x0,y0);ctx.lineTo(x0+ww,y0);ctx.stroke();
        ctx.strokeStyle=blue;ctx.lineWidth=1.7;ctx.beginPath();
        const samples=Array.from({length:161},(_,i)=>i*wMax/160).concat([peak,params.driveOmega]).sort((a,b)=>a-b);
        samples.forEach((w,i)=>{
          const a=computeLinearResponseAmplitude(params,w)??0;
          const x=x0+w/wMax*ww,y=y0-a/yScale*hh;
          if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
        });ctx.stroke();
        if(amp!==null){ctx.fillStyle=paper?'#b45309':'#fbbf24';ctx.beginPath();ctx.arc(x0+params.driveOmega/wMax*ww,y0-amp/yScale*hh,3.5,0,2*Math.PI);ctx.fill();}
        ctx.fillStyle=ink;ctx.font='11px sans-serif';
        ctx.fillText('A/rad',left+5,top+37);ctx.fillText(maxAmp.toFixed(2),left+3,top+52);
        ctx.fillText('0',x0-4,y0+13);ctx.textAlign='right';ctx.fillText(wMax.toFixed(1)+' ω/(rad/s)',left+cardW-7,y0+13);ctx.textAlign='left';
        ctx.fillText(peak===0?'最大值在零频（无正频峰）':'ω峰='+peak.toFixed(3)+' rad/s',left+10,top+169);
      }
    }
    ctx.restore();
    ctx.restore();
  },
  formatFormulas: (state, params) => {
    const w0=computeNaturalOmega(params), peak=computeTheoreticalResonanceOmega(params);
    const obs=computeObservables(state,params);
    const base={id:'pendulum-freq',label:'小角固有频率与周期',
      latex:'\\omega_0=\\sqrt{g/L},\\quad T_0=2\\pi/\\omega_0',
      substitutedLatex:'\\omega_0='+w0.toFixed(3)+'\\,\\mathrm{rad/s},\\quad T_0='+((2*Math.PI)/w0).toFixed(4)+'\\,\\mathrm s'};
    const equation={id:'pendulum-equation',label:'真实非线性角运动',
      latex:params.mode==='pendulum-compare'?'\\ddot\\theta+\\omega_0^2\\sin\\theta=0':params.mode==='damped-free'?'\\ddot\\theta+2\\gamma\\dot\\theta+\\omega_0^2\\sin\\theta=0':'\\ddot\\theta+2\\gamma\\dot\\theta+\\omega_0^2\\sin\\theta=a_d\\cos(\\omega_dt)',
      substitutedLatex:'\\theta='+obs.thetaDeg!.toFixed(2)+'^\\circ,\\quad \\theta_{\\rm lin}='+obs.thetaLinearDeg!.toFixed(2)+'^\\circ'};
    const energy={id:'pendulum-energy',label:'机械能、耗散与外力功',
      latex:params.mode==='pendulum-compare'?'E=E_0':params.mode==='damped-free'?'E+Q=E_0':'E+Q-W=E_0',
      substitutedLatex:'E='+obs.mechanicalEnergy!.toFixed(3)+',\\quad Q='+state.heatLostJ.toFixed(3)+',\\quad W='+state.driveWorkJ.toFixed(3)+'\\,\\mathrm J'};
    if(params.mode!=='forced-resonance')return [base,equation,energy];
    return [base,equation,{id:'linear-response',label:'线性特解（非非线性稳态实测）',
      latex:'A(\\omega_d)=\\frac{a_d}{\\sqrt{(\\omega_0^2-\\omega_d^2)^2+(2\\gamma\\omega_d)^2}}',
      substitutedLatex:effectiveDamping(params)===0?'\\gamma=0\\colon\\ \\text{no attracting steady state}':peak===0?'\\omega_{\\rm peak}=0':'\\omega_{\\rm peak}='+peak.toFixed(3)+'\\,\\mathrm{rad/s}'},energy];
  }
});

export default mechShmResonancePlugin;
