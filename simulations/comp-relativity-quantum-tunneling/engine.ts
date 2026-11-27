import type { InvariantReport, StepResult } from '@physforge/sim-sdk';

export type RelativityQuantumMode = 'tdse-tunneling' | 'minkowski-relativity';
export type PotentialShape = 'single-barrier' | 'double-barrier' | 'potential-well';

export const TDSE_GRID_N = 512;
export const TDSE_X_MIN = -50;
export const TDSE_X_MAX = 50;
export const TDSE_DX = (TDSE_X_MAX - TDSE_X_MIN) / (TDSE_GRID_N - 1);

export type RelativityQuantumParams = {
  mode: RelativityQuantumMode;
  potentialShape: PotentialShape;
  barrierHeightV0: number;
  barrierWidth: number;
  waveMomentumK0: number;
  packetSigma: number;
  lorentzBeta: number;
  eventX: number;
  eventCt: number;
};

export interface RelativityQuantumState {
  readonly t: number;
  readonly mode: RelativityQuantumMode;
  readonly inputKey: string;
  readonly psiRe: Float64Array;
  readonly psiIm: Float64Array;
  readonly potential: Float64Array;
  readonly totalNorm: number;
  readonly normDrift: number;
  readonly reflectionProb: number;
  /** Compatibility aliases: occupation probabilities, NOT asymptotic reflection/transmission coefficients. */
  readonly transmissionProb: number;
  readonly middleProb: number;
  readonly energyExpectation: number;
  readonly initialEnergy: number;
  readonly boundaryProb: number;
  readonly maxBoundaryProb: number;
  readonly eventXPrime: number;
  readonly eventCtPrime: number;
  readonly gammaFactor: number;
  readonly intervalS2: number;
  readonly intervalPrimeS2: number;
  readonly intervalError: number;
  readonly twinStayProperTime: number;
  readonly twinTravelerProperTime: number;
}

export function buildPotentialArray(params: RelativityQuantumParams): Float64Array {
  const V = new Float64Array(TDSE_GRID_N);
  const v0 = params.barrierHeightV0;
  const w = Math.max(0.4, params.barrierWidth);
  for (let j = 0; j < TDSE_GRID_N; j++) {
    const x = TDSE_X_MIN + j * TDSE_DX;
    if (params.potentialShape === 'single-barrier') {
      if (Math.abs(x) <= 0.5 * w) V[j] = v0;
    } else if (params.potentialShape === 'double-barrier') {
      if (Math.abs(x + 2.5) <= 0.4 * w || Math.abs(x - 2.5) <= 0.4 * w) V[j] = v0;
    } else {
      if (Math.abs(x) <= 0.8 * w) V[j] = -Math.abs(v0);
    }
  }
  return V;
}

export function solveLorentzInterval(betaRaw: number, x: number, ct: number): {
  gamma: number;
  xPrime: number;
  ctPrime: number;
  s2: number;
  s2Prime: number;
  err: number;
} {
  const beta = Math.max(-0.98, Math.min(0.98, betaRaw));
  const gamma = 1 / Math.sqrt(1 - beta * beta);
  const xPrime = gamma * (x - beta * ct);
  const ctPrime = gamma * (ct - beta * x);
  const s2 = ct * ct - x * x;
  const s2Prime = ctPrime * ctPrime - xPrime * xPrime;
  return {
    gamma,
    xPrime,
    ctPrime,
    s2,
    s2Prime,
    err: Math.abs(s2Prime - s2)
  };
}

function inputKey(p:RelativityQuantumParams):string{
  return p.mode==='tdse-tunneling'?JSON.stringify([p.mode,p.potentialShape,p.barrierHeightV0,p.barrierWidth,p.waveMomentumK0,p.packetSigma]):
    JSON.stringify([p.mode,p.lorentzBeta,p.eventX,p.eventCt]);
}
export function potentialSupport(V:Float64Array):{first:number;last:number;left:number;right:number;empty:boolean}{
  const first=V.findIndex(v=>v!==0);
  if(first<0){const mid=Math.ceil(-TDSE_X_MIN/TDSE_DX);return {first:mid,last:mid-1,left:0,right:0,empty:true};}
  let last=V.length-1;while(last>first&&V[last]===0)last--;
  return {first,last,left:TDSE_X_MIN+(first-.5)*TDSE_DX,right:TDSE_X_MIN+(last+.5)*TDSE_DX,empty:false};
}
export function quantumQuantities(re:Float64Array,im:Float64Array,V:Float64Array){
  const support=potentialSupport(V);let total=0,left=0,middle=0,right=0,E=0,boundary=0;
  for(let j=0;j<TDSE_GRID_N;j++){
    const a=re[j]!,b=im[j]!,density=a*a+b*b,p=density*TDSE_DX;
    total+=p;if(j<support.first)left+=p;else if(j>support.last)right+=p;else middle+=p;
    const Ha=(2*a-(re[j-1]??0)-(re[j+1]??0))/(2*TDSE_DX**2)+V[j]!*a;
    const Hb=(2*b-(im[j-1]??0)-(im[j+1]??0))/(2*TDSE_DX**2)+V[j]!*b;
    E+=(a*Ha+b*Hb)*TDSE_DX;
    if(Math.abs(TDSE_X_MIN+j*TDSE_DX)>=45)boundary+=p;
  }
  return {total,left,middle,right,E,boundary,support};
}
export function createInitialState(params: RelativityQuantumParams): RelativityQuantumState {
  const psiRe = new Float64Array(TDSE_GRID_N);
  const psiIm = new Float64Array(TDSE_GRID_N);
  const sig = Math.max(1.2, params.packetSigma);
  const k0 = params.waveMomentumK0;
  const x0 = -18;

  let normSum = 0;
  for (let j = 0; j < TDSE_GRID_N; j++) {
    const x = TDSE_X_MIN + j * TDSE_DX;
    const env = Math.exp(-((x - x0) * (x - x0)) / (4 * sig * sig));
    const re = env * Math.cos(k0 * x);
    const im = env * Math.sin(k0 * x);
    psiRe[j] = re;
    psiIm[j] = im;
    normSum += (re * re + im * im) * TDSE_DX;
  }
  const invSqrt = 1 / Math.sqrt(Math.max(1e-18, normSum));
  for(let j=0;j<TDSE_GRID_N;j++){psiRe[j]=psiRe[j]!*invSqrt;psiIm[j]=psiIm[j]!*invSqrt;}
  const potential=buildPotentialArray(params),q=quantumQuantities(psiRe,psiIm,potential);

  const lor = solveLorentzInterval(params.lorentzBeta, params.eventX, params.eventCt);
  const stayTau = 10;
  const travelTau = stayTau / lor.gamma;

  return {
    t: 0,
    mode:params.mode,inputKey:inputKey(params),
    psiRe,
    psiIm,
    potential,
    totalNorm:q.total,normDrift:Math.abs(q.total-1),
    reflectionProb:q.left,transmissionProb:q.right,middleProb:q.middle,
    energyExpectation:q.E,initialEnergy:q.E,boundaryProb:q.boundary,maxBoundaryProb:q.boundary,
    eventXPrime:lor.xPrime,eventCtPrime:lor.ctPrime,
    gammaFactor: lor.gamma,
    intervalS2: lor.s2,
    intervalPrimeS2: lor.s2Prime,
    intervalError: lor.err,
    twinStayProperTime: stayTau,
    twinTravelerProperTime: travelTau
  };
}

/**
 * 1D TDSE Crank-Nicolson single-step solver with complex Thomas tridiagonal elimination (m=1, hbar=1).
 * Cayley operator is unitary for the discrete Hermitian H with zero ghost cells; floating-point drift is audited. Finite-box boundaries reflect.
 */
function advanceCrankNicolsonStep(
  psiReIn: Float64Array,
  psiImIn: Float64Array,
  V: Float64Array,
  dt: number
): { nextRe: Float64Array; nextIm: Float64Array } {
  const N = TDSE_GRID_N;
  // alphaIm = dt / (4 * dx^2), off-diag A = -i * alphaIm
  const alphaIm = dt / (4 * TDSE_DX * TDSE_DX);
  const halfDt = 0.5 * dt;

  // Build RHS d = (I - i*halfDt*H) psi and solve tridiagonal A * next = d
  const cPrimeRe = new Float64Array(N);
  const cPrimeIm = new Float64Array(N);
  const dPrimeRe = new Float64Array(N);
  const dPrimeIm = new Float64Array(N);

  for (let j = 0; j < N; j++) {
    const pRe = psiReIn[j]!;
    const pIm = psiImIn[j]!;
    const pmRe = j > 0 ? psiReIn[j - 1]! : 0;
    const pmIm = j > 0 ? psiImIn[j - 1]! : 0;
    const ppRe = j + 1 < N ? psiReIn[j + 1]! : 0;
    const ppIm = j + 1 < N ? psiImIn[j + 1]! : 0;

    // B_diag = 1 - i*(2*alphaIm + halfDt*V[j])
    const bDiagIm = -(2 * alphaIm + halfDt * V[j]!);
    // d_j = (1 + i*bDiagIm)*p + (i*alphaIm)*(pm + pp)
    const sumSideRe = pmRe + ppRe;
    const sumSideIm = pmIm + ppIm;
    const rhsRe = pRe - bDiagIm * pIm - alphaIm * sumSideIm;
    const rhsIm = pIm + bDiagIm * pRe + alphaIm * sumSideRe;

    // A_j diagonal: 1 + i*(2*alphaIm + halfDt*V[j]) = (1, diagIm)
    // lower off-diag a = (0, -alphaIm), upper off-diag c = (0, -alphaIm)
    const diagIm = 2 * alphaIm + halfDt * V[j]!;
    let denomRe = 1;
    let denomIm = diagIm;
    if (j > 0) {
      // denom -= a * cPrime[j-1], where a = (0, -alphaIm)
      // (0, -alphaIm) * (cpRe, cpIm) = (alphaIm*cpIm, -alphaIm*cpRe)
      denomRe -= alphaIm * cPrimeIm[j - 1]!;
      denomIm -= -alphaIm * cPrimeRe[j - 1]!;
    }
    const denMag2 = denomRe * denomRe + denomIm * denomIm;

    if (j + 1 < N) {
      // cPrime[j] = (0, -alphaIm) / (denomRe + i*denomIm)
      const cRe = 0;
      const cIm = -alphaIm;
      cPrimeRe[j] = (cRe * denomRe + cIm * denomIm) / denMag2;
      cPrimeIm[j] = (cIm * denomRe - cRe * denomIm) / denMag2;
    }

    let numRe = rhsRe;
    let numIm = rhsIm;
    if (j > 0) {
      // num -= a * dPrime[j-1], a = (0, -alphaIm)
      numRe -= alphaIm * dPrimeIm[j - 1]!;
      numIm -= -alphaIm * dPrimeRe[j - 1]!;
    }
    dPrimeRe[j] = (numRe * denomRe + numIm * denomIm) / denMag2;
    dPrimeIm[j] = (numIm * denomRe - numRe * denomIm) / denMag2;
  }

  const nextRe = new Float64Array(N);
  const nextIm = new Float64Array(N);
  nextRe[N - 1] = dPrimeRe[N - 1]!;
  nextIm[N - 1] = dPrimeIm[N - 1]!;
  for (let j = N - 2; j >= 0; j--) {
    const xNextRe = nextRe[j + 1]!;
    const xNextIm = nextIm[j + 1]!;
    const cpRe = cPrimeRe[j]!;
    const cpIm = cPrimeIm[j]!;
    nextRe[j] = dPrimeRe[j]! - (cpRe * xNextRe - cpIm * xNextIm);
    nextIm[j] = dPrimeIm[j]! - (cpRe * xNextIm + cpIm * xNextRe);
  }
  return { nextRe, nextIm };
}

export function stepRelativityQuantum(
  state: RelativityQuantumState,
  params: RelativityQuantumParams,
  dt: number
): StepResult<RelativityQuantumState> {
  if(!Number.isFinite(dt)||dt<0)throw Error('Invalid dt: '+dt);
  if(state.inputKey!==inputKey(params))return {nextState:createInitialState(params),events:[],advancedTime:0,halt:true};
  if(params.mode==='minkowski-relativity')return {nextState:state,events:[],advancedTime:0,halt:true};
  if(dt===0)return {nextState:state,events:[]};
  const V=state.potential,n=Math.max(1,Math.ceil(dt/.05)),h=dt/n;
  let re=state.psiRe,im=state.psiIm,maxBoundary=state.maxBoundaryProb;
  for(let j=0;j<n;j++){
    const a=advanceCrankNicolsonStep(re,im,V,h);re=a.nextRe;im=a.nextIm;
    let b=0;for(let k=0;k<TDSE_GRID_N;k++)if(Math.abs(TDSE_X_MIN+k*TDSE_DX)>=45)b+=(re[k]!**2+im[k]!**2)*TDSE_DX;
    maxBoundary=Math.max(maxBoundary,b);
  }
  const q=quantumQuantities(re,im,V);
  return {nextState:{...state,t:state.t+dt,psiRe:re,psiIm:im,
    totalNorm:q.total,normDrift:Math.abs(q.total-1),
    reflectionProb:q.left,transmissionProb:q.right,middleProb:q.middle,
    energyExpectation:q.E,boundaryProb:q.boundary,maxBoundaryProb:maxBoundary},events:[]};
}
export function computeObservables(s:RelativityQuantumState):Record<string,number>{
  if(s.mode==='minkowski-relativity')return {t:s.t,gammaFactor:s.gammaFactor,eventXPrime:s.eventXPrime,eventCtPrime:s.eventCtPrime,
    intervalS2:s.intervalS2,intervalPrimeS2:s.intervalPrimeS2,intervalError:s.intervalError,
    twinStayProperTime:s.twinStayProperTime,twinTravelerProperTime:s.twinTravelerProperTime};
  return {t:s.t,totalNorm:s.totalNorm,normDrift:s.normDrift,reflectionProb:s.reflectionProb,transmissionProb:s.transmissionProb,
    middleProb:s.middleProb,energyExpectation:s.energyExpectation,energyDrift:Math.abs(s.energyExpectation-s.initialEnergy),
    boundaryProb:s.boundaryProb,maxBoundaryProb:s.maxBoundaryProb};
}
export function checkInvariants(s:RelativityQuantumState,initial:RelativityQuantumState,p:RelativityQuantumParams):InvariantReport[]{
  const report=(name:string,e:number,tolerance:number):InvariantReport=>({name,measuredError:e,tolerance,passed:Number.isFinite(e)&&e<tolerance});
  if(p.mode==='minkowski-relativity'){
    const a=solveLorentzInterval(p.lorentzBeta,p.eventX,p.eventCt),b=solveLorentzInterval(-p.lorentzBeta,s.eventXPrime,s.eventCtPrime);
    return [report('洛伦兹时空间隔绝对误差',Math.abs(s.intervalPrimeS2-s.intervalS2),1e-10),
      report('洛伦兹正反变换坐标误差',Math.max(Math.abs(s.eventXPrime-a.xPrime),Math.abs(s.eventCtPrime-a.ctPrime),Math.abs(b.xPrime-p.eventX),Math.abs(b.ctPrime-p.eventCt)),1e-10)];
  }
  const q=quantumQuantities(s.psiRe,s.psiIm,s.potential),a=quantumQuantities(initial.psiRe,initial.psiIm,initial.potential);
  return [report('离散 TDSE 总概率归一化误差',Math.abs(q.total-1),1e-10),
    report('静态 Hamiltonian 能量期望漂移',Math.abs(q.E-a.E)/Math.max(1,Math.abs(a.E)),1e-9),
    report('左中右占据概率闭合及读数误差',Math.max(Math.abs(q.left+q.middle+q.right-q.total),Math.abs(q.left-s.reflectionProb),Math.abs(q.right-s.transmissionProb),Math.abs(q.middle-s.middleProb)),1e-10)];
}
