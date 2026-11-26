import type { InvariantReport, PhysicsEvent, StepResult } from '@physforge/sim-sdk';

export type TransformerGridMode = 'multi-tap-transformer' | 'long-distance-grid';

export type TransformerGridParams = {
  mode: TransformerGridMode;
  sourceU0: number;
  primaryR0: number;
  n1Ratio: number;
  n2Ratio: number;
  n3Ratio: number;
  loadR2: number;
  loadR3: number;
  branch3Closed: boolean;
  baselineParallelUsers: number;
  parallelUsersCount: number;
  genPowerKw: number;
  stepUpRatioK1: number;
  lineResistanceR: number;
};


export interface TransformerMetrics {
  readonly operatingPointValid: number;
  readonly efficiencyDefined: number;
  readonly uSourceV: number;
  readonly u1: number;
  readonly i1: number;
  readonly u2: number;
  readonly i2: number;
  readonly u3: number;
  readonly i3: number;
  /** Entire source supply, including primary series loss. */
  readonly pInW: number;
  readonly pTransformerInW: number;
  readonly pOutW: number;
  readonly p2W: number;
  readonly p3W: number;
  readonly pLineLossW: number;
  readonly pUserW: number;
  readonly lineVoltageV: number;
  readonly lineCurrentA: number;
  readonly voltageDropV: number;
  readonly efficiency: number;
  /** Requested, not measured, grid values; zero in multi-secondary mode. */
  readonly requestedPowerW: number;
  readonly requestedCurrentA: number;
  readonly requestedLossW: number;
  readonly maxPowerW: number;
  readonly powerLimitDefined: number;
}
export interface TransformerGridState {
  readonly t: number;
  readonly phase: number;
  readonly current: TransformerMetrics;
  readonly baseline: TransformerMetrics;
  readonly events: readonly PhysicsEvent[];
}
const demandKeys={requestedPowerW:0,requestedCurrentA:0,requestedLossW:0,maxPowerW:0,powerLimitDefined:0};
export function solveTransformerMetrics(p:TransformerGridParams):TransformerMetrics{
  const n1=Math.max(.1,p.n1Ratio),n2=Math.max(.1,p.n2Ratio),n3=Math.max(.1,p.n3Ratio);
  const U=Math.max(0,p.sourceU0);
  if(p.mode==='multi-tap-transformer'){
    const R=Math.max(0,p.primaryR0),G2=Math.max(0,p.parallelUsersCount)/Math.max(.1,p.loadR2),
      G3=p.branch3Closed?1/Math.max(.1,p.loadR3):0;
    const G=(n2/n1)**2*G2+(n3/n1)**2*G3,u1=U/(1+R*G),i1=u1*G;
    const u2=u1*n2/n1,u3=u1*n3/n1,i2=u2*G2,i3=u3*G3;
    const pInW=U*i1,pTransformerInW=u1*i1,p2W=u2*i2,p3W=u3*i3,pOutW=p2W+p3W;
    return {...demandKeys,operatingPointValid:1,efficiencyDefined:pInW>0?1:0,uSourceV:U,u1,i1,u2,i2,u3,i3,
      pInW,pTransformerInW,pOutW,p2W,p3W,pLineLossW:i1*i1*R,pUserW:pOutW,
      lineVoltageV:0,lineCurrentA:0,voltageDropV:i1*R,efficiency:pInW>0?pOutW/pInW:0};
  }
  // Fixed sending power, fixed source voltage and unity power factor; not fixed receiving load.
  const k=Math.max(.5,p.stepUpRatioK1),R=Math.max(0,p.lineResistanceR),send=U*k,
    requestedPowerW=Math.max(0,p.genPowerKw*1000),requestedCurrentA=send>0?requestedPowerW/send:0,
    requestedLossW=requestedCurrentA**2*R,maxPowerW=R>0?send**2/R:0,powerLimitDefined=R>0?1:0;
  const common={requestedPowerW,requestedCurrentA,requestedLossW,maxPowerW,powerLimitDefined,uSourceV:U};
  // No passive receiving operating point for negative receiving voltage. Numeric zeros
  // are sentinels, and must never be presented as measurements in this state.
  if((send===0&&requestedPowerW>0)||(R>0&&requestedPowerW>maxPowerW)){
    return {...common,operatingPointValid:0,efficiencyDefined:0,u1:0,i1:0,u2:0,i2:0,u3:0,i3:0,
      pInW:0,pTransformerInW:0,pOutW:0,p2W:0,p3W:0,pLineLossW:0,pUserW:0,
      lineVoltageV:0,lineCurrentA:0,voltageDropV:0,efficiency:0};
  }
  const I=requestedCurrentA,drop=I*R,recv=Math.max(0,send-drop),loss=I*I*R,delivered=recv*I;
  // The ideal receiving transformer is adjustable: 220 V when positive input
  // voltage exists; the boundary recv=0 is the short-circuit limit, not a 220 V bus.
  const userV=recv>0?220:0,userI=userV>0?delivered/userV:0;
  return {...common,operatingPointValid:1,efficiencyDefined:requestedPowerW>0?1:0,
    u1:U,i1:U>0?requestedPowerW/U:0,u2:recv,i2:I,u3:userV,i3:userI,pInW:requestedPowerW,
    pTransformerInW:requestedPowerW,pOutW:delivered,p2W:delivered,p3W:0,
    pLineLossW:loss,pUserW:delivered,lineVoltageV:send,lineCurrentA:I,voltageDropV:drop,
    efficiency:requestedPowerW>0?delivered/requestedPowerW:0};
}

export function trendSymbol(now:number,ref:number,tol=1e-6):'↑'|'↓'|'—'{
  return now>ref+tol?'↑':now<ref-tol?'↓':'—';
}
export function createInitialState(p:TransformerGridParams):TransformerGridState{
  const baseline={...p,branch3Closed:false,parallelUsersCount:p.baselineParallelUsers,stepUpRatioK1:10};
  return {t:0,phase:0,current:solveTransformerMetrics(p),baseline:solveTransformerMetrics(baseline),events:[]};
}
export function stepTransformerGrid(s:TransformerGridState,p:TransformerGridParams,dt:number):StepResult<TransformerGridState>{
  if(!Number.isFinite(dt)||dt<0)throw Error(`Invalid dt: ${dt}`);
  if(dt===0)return {nextState:s,events:[]};
  // Quasistatic RMS model. Time only drives a schematic marker, not circuit transients.
  return {nextState:{...s,t:s.t+dt,phase:(s.phase+dt*2.5)%1,current:solveTransformerMetrics(p)},events:[]};
}
export function computeObservables(s:TransformerGridState):Record<string,number>{
  const m=s.current;return {t:s.t,...m,efficiencyPct:m.efficiency*100};
}
export function checkInvariants(s:TransformerGridState,_initial:TransformerGridState,p:TransformerGridParams):InvariantReport[]{
  const m=s.current;
  const report=(name:string,a:number,b:number):InvariantReport=>{
    const e=Math.abs(a-b)/Math.max(1e-9,Math.abs(a),Math.abs(b));
    return {name,measuredError:e,tolerance:1e-10,passed:Number.isFinite(e)&&e<=1e-10};
  };
  if(m.operatingPointValid!==1)return [{name:'请求超出无源受端可行域（无工作点）',measuredError:1,tolerance:0,passed:false}];
  const shared=[report('电源总功率 U₀I₁',m.pInW,m.uSourceV*m.i1),
    report('电源功率 = 用户功率 + 串联损耗',m.pInW,m.pUserW+m.pLineLossW),
    report('用户功率账本',m.pUserW,m.pOutW),
    report('实际效率',m.efficiency,m.pInW>0?m.pUserW/m.pInW:0)];
  if(p.mode==='multi-tap-transformer'){
    const n1=Math.max(.1,p.n1Ratio),R=Math.max(0,p.primaryR0);
    return [...shared,report('原边电压方程',m.uSourceV,m.u1+R*m.i1),
      report('理想原边功率',m.pTransformerInW,m.u1*m.i1),
      report('双副边功率和',m.pTransformerInW,m.u2*m.i2+m.u3*m.i3),
      report('各副边功率账本',m.pOutW,m.p2W+m.p3W),
      report('原边电阻热功率',m.pLineLossW,m.i1**2*R),
      report('匝数比 U₂/U₁',m.u2*n1,m.u1*Math.max(.1,p.n2Ratio)),
      report('匝数比 U₃/U₁',m.u3*n1,m.u1*Math.max(.1,p.n3Ratio)),
      report('副边 2 欧姆定律',m.i2,m.u2*Math.max(0,p.parallelUsersCount)/Math.max(.1,p.loadR2)),
      report('副边 3 开关与欧姆定律',m.i3,p.branch3Closed?m.u3/Math.max(.1,p.loadR3):0)];
  }
  return [...shared,report('送端功率 U送I线',m.pInW,m.lineVoltageV*m.lineCurrentA),
    report('输电电压方程',m.lineVoltageV,m.u2+m.lineCurrentA*Math.max(0,p.lineResistanceR)),
    report('实际线路热功率',m.pLineLossW,m.lineCurrentA**2*Math.max(0,p.lineResistanceR)),
    report('受端功率',m.pUserW,m.u2*m.lineCurrentA),
    report('理想受端变压器功率',m.pUserW,m.u3*m.i3),
    report('恒功率请求',m.pInW,Math.max(0,p.genPowerKw*1000))];
}
