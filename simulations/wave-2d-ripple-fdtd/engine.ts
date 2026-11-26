import {WaveFDTD2D} from '@physforge/physics-core';
import type {InvariantReport,StepResult} from '@physforge/sim-sdk';
export type FdtdRippleMode='double-slit'|'single-slit'|'obstacle-diffraction'|'refraction-prism';
export type WaveFdtdParams={mode:FdtdRippleMode;wavelengthCells:number;waveSpeed:number;amplitude:number;slitSepCells:number;slitWidthCells:number;refractiveIndexN:number;};
export const GRID_NX=200,GRID_NY=150,DX=.05,SPONGE_CELLS=16,WALL_I=68,SCREEN_I=178,SOURCE_I=22,CENTER_J=75,OUTER_TICK=1/240;
export type Aperture={firstJ:number;lastJ:number;centerJ:number;widthCells:number;};
export interface RippleGeometry{
  readonly valid:boolean;readonly apertures:readonly Aperture[];readonly blockedRuns:readonly {firstJ:number;lastJ:number}[];
  readonly sourceFirstJ:number;readonly sourceLastJ:number;readonly boundaryI:readonly number[];
  readonly requestedWidth:number;readonly requestedSeparation:number;readonly separationCells:number;readonly widthCells:number;
}
export interface WaveFdtdState{
  readonly t:number;readonly timeCompensation:number;readonly fieldTime:number;readonly stepsRun:number;readonly courantNumber:number;readonly nx:number;readonly ny:number;
  readonly wallI:number;readonly screenI:number;readonly geometry:RippleGeometry;
  readonly fieldSnapshot:Float32Array;readonly speedSnapshot:Float32Array;readonly screenIntensity:Float32Array;
  readonly screenAverageSamples:number;readonly averageStartTime:number;readonly averageFirstTime?:number;
  readonly maxAmplitude:number;readonly allFinite:boolean;
  // Immutable continuation, not a mutable shared solver. Scratch solver is private.
  readonly fdtdRef:Readonly<{dt:number;uCurr:Float32Array;uPrev:Float32Array}>;
}
export function rippleGeometry(p:WaveFdtdParams):RippleGeometry{
  const width=Math.max(1,Math.round(p.slitWidthCells)),sep=Math.max(1,Math.round(p.slitSepCells));
  const aperture=(firstJ:number):Aperture=>({firstJ,lastJ:firstJ+width-1,centerJ:firstJ+(width-1)/2,widthCells:width});
  const first=Math.round(CENTER_J-(width-1)/2-sep/2);
  const apertures=p.mode==='double-slit'?[aperture(first),aperture(first+sep)]:p.mode==='single-slit'?[aperture(Math.round(CENTER_J-(width-1)/2))]:[];
  const valid=p.mode!=='double-slit'||(sep>width&&apertures.every(a=>a.firstJ>=SPONGE_CELLS&&a.lastJ<GRID_NY-SPONGE_CELLS));
  const boundaryI=Array.from({length:GRID_NY},(_,j)=>WALL_I+Math.round((j-CENTER_J)*.35));
  const blocked=(j:number)=>p.mode==='refraction-prism'?false:p.mode==='obstacle-diffraction'?Math.abs(j-CENTER_J)<=width:valid&&!apertures.some(a=>j>=a.firstJ&&j<=a.lastJ);
  const blockedRuns:{firstJ:number;lastJ:number}[]=[];
  for(let j=0;j<GRID_NY;j++){
    if(!blocked(j))continue;const firstJ=j;while(j+1<GRID_NY&&blocked(j+1))j++;
    blockedRuns.push({firstJ,lastJ:j});
  }
  return {valid,apertures:valid?apertures:[],blockedRuns,sourceFirstJ:p.mode==='refraction-prism'?CENTER_J-30:SPONGE_CELLS+2,sourceLastJ:p.mode==='refraction-prism'?CENTER_J+30:GRID_NY-SPONGE_CELLS-3,boundaryI,requestedWidth:width,requestedSeparation:sep,separationCells:p.mode==='double-slit'&&valid?sep:0,widthCells:valid?(p.mode==='obstacle-diffraction'?2*width+1:p.mode==='refraction-prism'?0:width):0};
}
function config(p:WaveFdtdParams,g:RippleGeometry){
  const c=Math.max(.2,p.waveSpeed),h=OUTER_TICK/Math.max(1,Math.ceil(c*OUTER_TICK/(.45*DX)));
  const solver=new WaveFDTD2D({nx:GRID_NX,ny:GRID_NY,dx:DX,dt:h,maxWaveSpeed:c,spongeWidth:SPONGE_CELLS,spongeRatePerSecond:24*c});
  solver.setObstacleMask((i,j)=>i>=WALL_I-1&&i<=WALL_I+1&&g.blockedRuns.some(r=>j>=r.firstJ&&j<=r.lastJ));
  if(p.mode==='refraction-prism')for(let j=0;j<GRID_NY;j++)for(let i=g.boundaryI[j]!;i<GRID_NX;i++)solver.speedGrid[j*GRID_NX+i]=c/Math.max(1,p.refractiveIndexN);
  return solver;
}
const scratch=new WeakMap<Float32Array,WaveFDTD2D>();
export function createInitialState(p:WaveFdtdParams):WaveFdtdState{
  const geometry=rippleGeometry(p),solver=config(p,geometry),speedSnapshot=new Float32Array(solver.speedGrid),fieldSnapshot=new Float32Array(solver.uCurr),prev=new Float32Array(solver.uPrev);
  scratch.set(speedSnapshot,solver);
  const c=Math.max(.2,p.waveSpeed),lambda=Math.max(4,p.wavelengthCells)*DX,period=lambda/c;
  // Conservative nominal straight-path settling gate, not an exact FDTD causal arrival.
  const flight=Math.hypot((SCREEN_I-SOURCE_I)*DX,(GRID_NY/2-SPONGE_CELLS)*DX)/c*(p.mode==='refraction-prism'?Math.max(1,p.refractiveIndexN):1);
  return {t:0,timeCompensation:0,fieldTime:0,stepsRun:0,courantNumber:solver.courantNumber,nx:GRID_NX,ny:GRID_NY,wallI:WALL_I,screenI:SCREEN_I,geometry,fieldSnapshot,speedSnapshot,screenIntensity:new Float32Array(GRID_NY),screenAverageSamples:0,averageStartTime:flight+2*period,maxAmplitude:0,allFinite:true,fdtdRef:{dt:solver.dt,uCurr:fieldSnapshot,uPrev:prev}};
}
export function stepWaveFdtd(s:WaveFdtdState,p:WaveFdtdParams,dt:number):StepResult<WaveFdtdState>{
  if(!Number.isFinite(dt)||dt<0)throw Error('Invalid dt: '+dt);
  if(dt===0)return {nextState:s,events:[]};
  if(!s.geometry.valid||!s.allFinite)return {nextState:s,events:[],advancedTime:0,halt:true};
  // Compensated elapsed-time sum prevents cumulative floating-point tick loss
  // (naive summation misses a grid step around tick 1549 at 240 Hz).
  const corrected=dt-s.timeCompensation,t=s.t+corrected,timeCompensation=(t-s.t)-corrected;
  const h=s.fdtdRef.dt,n=Math.floor(t/h+32*Number.EPSILON*Math.max(1,t/h));
  if(!Number.isSafeInteger(n))throw Error('FDTD requested time exceeds representable step count');
  if(n===s.stepsRun)return {nextState:{...s,t,timeCompensation},events:[]};
  let solver=scratch.get(s.speedSnapshot);
  if(!solver){solver=config(p,s.geometry);solver.speedGrid.set(s.speedSnapshot);scratch.set(s.speedSnapshot,solver);}
  solver.uCurr.set(s.fieldSnapshot);solver.uPrev.set(s.fdtdRef.uPrev);solver.uNext.fill(0);
  const c=Math.max(.2,p.waveSpeed),omega=2*Math.PI*c/(Math.max(4,p.wavelengthCells)*DX),intensity=new Float32Array(s.screenIntensity);
  let count=s.screenAverageSamples,first=s.averageFirstTime;
  const impose=(time:number)=>{const val=p.amplitude*Math.sin(omega*time);for(let j=s.geometry.sourceFirstJ;j<=s.geometry.sourceLastJ;j++)solver!.injectSource(SOURCE_I,j,val);};
  for(let k=s.stepsRun+1;k<=n;k++){
    impose((k-1)*h);solver.step();impose(k*h);
    if(k*h>=s.averageStartTime){
      count++;if(first===undefined)first=k*h;
      for(let j=0;j<GRID_NY;j++){const u=solver.uCurr[j*GRID_NX+SCREEN_I]!;intensity[j]=intensity[j]!+(u*u-intensity[j]!)/count;}
    }
  }
  let maxAmplitude=0,allFinite=true;
  for(const u of solver.uCurr){if(!Number.isFinite(u)){allFinite=false;break;}maxAmplitude=Math.max(maxAmplitude,Math.abs(u));}
  for(const value of intensity)if(!Number.isFinite(value)||value<0)allFinite=false;
  const fieldSnapshot=new Float32Array(solver.uCurr),prev=new Float32Array(solver.uPrev);
  return {nextState:{...s,t,timeCompensation,fieldTime:n*h,stepsRun:n,fieldSnapshot,fdtdRef:{dt:h,uCurr:fieldSnapshot,uPrev:prev},screenIntensity:intensity,screenAverageSamples:count,...(first===undefined?{}:{averageFirstTime:first}),maxAmplitude,allFinite},events:[],...(allFinite?{}:{halt:true,advancedTime:dt})};
}
export function computeObservables(s:WaveFdtdState,p?:WaveFdtdParams):Record<string,number>{
  const h=s.fdtdRef.dt,g=s.geometry,obs:Record<string,number>={t:s.t,fieldTime:s.fieldTime,fieldLag:s.t-s.fieldTime,stepsRun:s.stepsRun,solverDt:h,courantNumber:s.courantNumber,geometryValid:Number(g.valid),screenAverageSamples:s.screenAverageSamples,averageStartTime:s.averageStartTime,screenDistance:(SCREEN_I-WALL_I)*DX};
  if(!g.valid||!s.allFinite)return obs;
  obs.maxAmplitude=s.maxAmplitude;obs.widthMeters=g.widthCells*DX;
  if(g.apertures.length===2)obs.separationMeters=g.separationCells*DX;
  if(p){const c=Math.max(.2,p.waveSpeed),lambda=Math.max(4,p.wavelengthCells)*DX;obs.incidentWavelength=lambda;obs.frequency=c/lambda;if(p.mode==='refraction-prism'){obs.transmittedWavelength=lambda/Math.max(1,p.refractiveIndexN);obs.transmittedSpeed=c/Math.max(1,p.refractiveIndexN);}}
  obs.centerScreenDisplacement=s.fieldSnapshot[CENTER_J*GRID_NX+SCREEN_I]!;
  if(s.screenAverageSamples>0&&s.averageFirstTime!==undefined){obs.centerScreenIntensity=s.screenIntensity[CENTER_J]!;obs.screenAverageDuration=s.fieldTime-s.averageFirstTime+h;let peak=0;for(let j=SPONGE_CELLS;j<GRID_NY-SPONGE_CELLS;j++)peak=Math.max(peak,s.screenIntensity[j]!);obs.peakScreenIntensity=peak;}
  return obs;
}
export function checkInvariants(s:WaveFdtdState):InvariantReport[]{
  const report=(name:string,error:number,tolerance:number):InvariantReport=>({name,measuredError:Number.isFinite(error)?error:Number.MAX_VALUE,tolerance,passed:Number.isFinite(error)&&error<=tolerance});
  let max=0,blocked=0,finite=s.allFinite;
  for(let j=0;j<GRID_NY;j++)for(let i=0;i<GRID_NX;i++){
    const k=j*GRID_NX+i,u=s.fieldSnapshot[k]!;if(!Number.isFinite(u)||!Number.isFinite(s.fdtdRef.uPrev[k]!))finite=false;max=Math.max(max,Math.abs(u));
    if(s.speedSnapshot[k]===0)blocked=Math.max(blocked,Math.abs(u));
  }
  const lag=s.t-s.fieldTime;
  const expectedFirstStep=Math.ceil(s.averageStartTime/s.fdtdRef.dt);
  const expectedCount=Math.max(0,s.stepsRun-expectedFirstStep+1);
  return [
    report('FDTD CFL < 0.5 与全场有限性',finite&&s.courantNumber<.5?s.courantNumber:1,.5),
    report('真实内部步数与场时钟',Math.max(Math.abs(s.fieldTime-s.stepsRun*s.fdtdRef.dt),Math.max(0,-lag,lag-s.fdtdRef.dt)),1e-10),
    report('障碍物固定零位移',blocked,1e-12),
    report('全场峰值与实际网格',Math.abs(max-s.maxAmplitude),1e-7),
    report('接收屏实际平均样本数',Math.abs(s.screenAverageSamples-expectedCount),0)
  ];
}
