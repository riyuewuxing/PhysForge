import { wavelengthToRgb } from '@physforge/physics-core';
import type { InvariantReport, StepResult } from '@physforge/sim-sdk';

export const H_PLANCK = 6.62607015e-34;
export const E_CHARGE = 1.602176634e-19;
export const C_LIGHT = 299792458;
export const M_ELECTRON = 9.1093837015e-31;
export const H_OVER_E = H_PLANCK / E_CHARGE;
export const COMPTON_WAVELENGTH_NM = (H_PLANCK / (M_ELECTRON * C_LIGHT)) * 1e9;
export const HC_EV_NM = ((H_PLANCK * C_LIGHT) / E_CHARGE) * 1e9;

export type QuantumLightMode = 'photoelectric' | 'compton';
export type CathodeMetal = 'Cs' | 'Na' | 'Zn' | 'Pt' | 'custom';

export const METAL_WORK_FUNCTIONS_EV: Record<Exclude<CathodeMetal, 'custom'>, number> = {
  Cs: 2.14,
  Na: 2.36,
  Zn: 4.31,
  Pt: 5.65
};

export type PhotoelectricComptonParams = {
  mode: QuantumLightMode;
  cathodeMetal: CathodeMetal;
  customWorkFunctionEv: number;
  wavelengthNm: number;
  intensityRel: number;
  anodeVoltageV: number;
  freezeRefEnabled: boolean;
  refWavelengthNm: number;
  refIntensityRel: number;
  xrayWavelengthNm: number;
  scatterAngleDeg: number;
};

export interface ComptonSolution {
  readonly incidentWavelengthNm: number;
  readonly scatteredWavelengthNm: number;
  readonly deltaLambdaNm: number;
  readonly incidentEnergyKev: number;
  readonly scatteredEnergyKev: number;
  readonly electronKineticKev: number;
  readonly pIncident: number;
  readonly pScattered: number;
  readonly pElectron: number;
  readonly recoilAngleDeg: number;
  readonly recoilAngleDefined: boolean;
  readonly pElectronX: number;
  readonly pElectronY: number;
  readonly massShellResidualRel: number;
  readonly pxResidualRel: number;
  readonly pyResidualRel: number;
  readonly energyResidualRel: number;
}

export interface PhotoelectricSolution {
  readonly workFunctionEv: number;
  readonly cutoffFreqHz: number;
  readonly cutoffWavelengthNm: number;
  readonly incidentFreqHz: number;
  readonly photonEnergyEv: number;
  readonly maxKineticEv: number;
  readonly stoppingVoltageV: number;
  readonly thresholdPassed: boolean;
  readonly emissionActive: boolean;
  readonly stoppingDefined: boolean;
  readonly saturationCurrentMa: number;
  readonly currentMa: number;
}

export interface PhotoelectricComptonState {
  readonly mode: QuantumLightMode;
  readonly anodeVoltageV: number;
  readonly intensityRel: number;
  readonly t: number;
  readonly photoelectric: PhotoelectricSolution;
  readonly compton: ComptonSolution;
  readonly beamHex: string;
  readonly phaseWave: number;
}

export function getWorkFunctionEv(params: PhotoelectricComptonParams): number {
  if (params.cathodeMetal === 'custom') {
    return Math.max(0.5, params.customWorkFunctionEv);
  }
  return METAL_WORK_FUNCTIONS_EV[params.cathodeMetal];
}

/** Empirical asymptote shared by the observable and plotted response. */
export function photoelectricSaturationCurrentMa(intensityRel: number, maxKineticEv: number): number {
  return 2.4 * Math.max(0, intensityRel) * (1 - 0.15 * Math.exp(-maxKineticEv));
}

export function computePhotocurrentMa(voltageV: number, pe: PhotoelectricSolution, intensityRel: number): number {
  if (!pe.thresholdPassed || intensityRel<=0) return 0;
  if (voltageV <= -pe.stoppingVoltageV) return 0;
  const iSat = photoelectricSaturationCurrentMa(intensityRel, pe.maxKineticEv);
  const vAboveStop = voltageV + pe.stoppingVoltageV;
  const scaleV = Math.max(0.6, 0.75 * pe.stoppingVoltageV + 0.5);
  return iSat * (1 - Math.exp((-2.8 * vAboveStop) / scaleV));
}

export function solvePhotoelectric(params: PhotoelectricComptonParams): PhotoelectricSolution {
  const workFunctionEv = getWorkFunctionEv(params);
  const lambdaNm = Math.max(100, params.wavelengthNm);
  const workJ = workFunctionEv * E_CHARGE;
  const cutoffFreqHz = workJ / H_PLANCK;
  const cutoffWavelengthNm = HC_EV_NM / workFunctionEv;
  const incidentFreqHz = C_LIGHT / (lambdaNm * 1e-9);
  // Use the same hc/e conversion as the threshold wavelength; the exact
  // threshold is not a spurious positive-energy result from roundoff.
  const photonEnergyEv = HC_EV_NM / lambdaNm;
  const excess=photonEnergyEv-workFunctionEv;
  const thresholdPassed=excess>8*Number.EPSILON*Math.max(photonEnergyEv,workFunctionEv);
  const emissionActive=thresholdPassed&&params.intensityRel>0;
  const stoppingDefined=emissionActive;
  const maxKineticEv = thresholdPassed ? photonEnergyEv - workFunctionEv : 0;
  const stoppingVoltageV = maxKineticEv; // E_km (eV) = e * U_c => numerical equality in V
  const saturationCurrentMa = thresholdPassed ? photoelectricSaturationCurrentMa(params.intensityRel, maxKineticEv) : 0;

  const baseSol: PhotoelectricSolution = {
    workFunctionEv,
    cutoffFreqHz,
    cutoffWavelengthNm,
    incidentFreqHz,
    photonEnergyEv,
    maxKineticEv,
    stoppingVoltageV,
    thresholdPassed,
    emissionActive,
    stoppingDefined,
    saturationCurrentMa,
    currentMa: 0
  };
  return {
    ...baseSol,
    currentMa: computePhotocurrentMa(params.anodeVoltageV, baseSol, params.intensityRel)
  };
}


export function solveComptonScattering(xrayWavelengthNm:number,scatterAngleDeg:number):ComptonSolution {
  if(!Number.isFinite(xrayWavelengthNm)||xrayWavelengthNm<=0||!Number.isFinite(scatterAngleDeg)||scatterAngleDeg<0||scatterAngleDeg>180)throw Error('Compton requires λ>0 and 0≤θ≤180°');
  const lamNm=xrayWavelengthNm,theta=scatterAngleDeg*Math.PI/180;
  // Stable even when 1-cos(theta) rounds to zero.
  const oneMinusCos=2*Math.sin(theta/2)**2;
  const sinTheta=scatterAngleDeg===0||scatterAngleDeg===180?0:Math.sin(theta);
  const deltaLambdaNm=COMPTON_WAVELENGTH_NM*oneMinusCos,lamPrimeNm=lamNm+deltaLambdaNm;
  const pIncident=H_PLANCK/(lamNm*1e-9),pScattered=H_PLANCK/(lamPrimeNm*1e-9);
  const eIncidentJ=pIncident*C_LIGHT,eScatteredJ=pScattered*C_LIGHT;
  // Avoid subtracting near-equal photon or total/rest energies.
  const eKineticJ=eIncidentJ*deltaLambdaNm/lamPrimeNm;
  const restEnergyJ=M_ELECTRON*C_LIGHT*C_LIGHT;
  const pElectron=Math.sqrt(eKineticJ*(eKineticJ+2*restEnergyJ))/C_LIGHT;
  // Independent momentum triangle; use stable longitudinal difference.
  const pElectronX=pIncident*deltaLambdaNm/lamPrimeNm+pScattered*oneMinusCos;
  const pElectronY=-pScattered*sinTheta;
  const recoilAngleDefined=scatterAngleDeg!==0&&pElectron>0;
  const phiRad=recoilAngleDefined?Math.atan2(pElectronY,pElectronX):0;
  const pxScatter=pScattered*(1-oneMinusCos),pyScatter=pScattered*sinTheta;
  const pxSum=pxScatter+pElectron*Math.cos(phiRad),pySum=pyScatter+pElectron*Math.sin(phiRad);
  const pc=Math.hypot(pElectronX,pElectronY)*C_LIGHT;
  const kineticFromMomentum=pc*pc/(Math.hypot(restEnergyJ,pc)+restEnergyJ);
  return {incidentWavelengthNm:lamNm,scatteredWavelengthNm:lamPrimeNm,deltaLambdaNm,
    incidentEnergyKev:eIncidentJ/E_CHARGE/1000,scatteredEnergyKev:eScatteredJ/E_CHARGE/1000,electronKineticKev:eKineticJ/E_CHARGE/1000,
    pIncident,pScattered,pElectron,pElectronX,pElectronY,recoilAngleDefined,recoilAngleDeg:phiRad*180/Math.PI,
    pxResidualRel:Math.abs(pxSum-pIncident)/pIncident,pyResidualRel:Math.abs(pySum)/pIncident,
    energyResidualRel:Math.abs(eScatteredJ+eKineticJ-eIncidentJ)/eIncidentJ,
    massShellResidualRel:Math.abs(kineticFromMomentum-eKineticJ)/eIncidentJ};
}

export function createInitialState(params: PhotoelectricComptonParams): PhotoelectricComptonState {
  const pe = solvePhotoelectric(params);
  const compton = solveComptonScattering(params.xrayWavelengthNm, params.scatterAngleDeg);
  const rgb = wavelengthToRgb(Math.max(380, Math.min(780, params.wavelengthNm)));
  return {
    t: 0,
    mode:params.mode,
    anodeVoltageV:params.anodeVoltageV,
    intensityRel:params.intensityRel,
    photoelectric: pe,
    compton,
    beamHex: params.wavelengthNm < 380 ? '#a855f7' : rgb.hex,
    phaseWave: 0
  };
}


export function stepPhotoelectricCompton(state:PhotoelectricComptonState,params:PhotoelectricComptonParams,dt:number):StepResult<PhotoelectricComptonState>{
  if(!Number.isFinite(dt)||dt<0)throw Error('Invalid dt: '+dt);
  return {nextState:dt===0?state:createInitialState(params),events:[],advancedTime:0,halt:true};
}
export function computeObservables(s:PhotoelectricComptonState):Record<string,number>{
  if(s.mode==='photoelectric'){
    const p=s.photoelectric;
    return {t:0,photonEnergyEv:p.photonEnergyEv,workFunctionEv:p.workFunctionEv,incidentFreqHz:p.incidentFreqHz,
      cutoffFreqHz:p.cutoffFreqHz,cutoffWavelengthNm:p.cutoffWavelengthNm,currentMa:p.currentMa,saturationCurrentMa:p.saturationCurrentMa,
      anodeVoltageV:s.anodeVoltageV,intensityRel:s.intensityRel,thresholdPassed:Number(p.thresholdPassed),emissionActive:Number(p.emissionActive),stoppingDefined:Number(p.stoppingDefined),
      ...(p.thresholdPassed?{maxKineticEv:p.maxKineticEv}:{}),...(p.stoppingDefined?{stoppingVoltageV:p.stoppingVoltageV}:{})};
  }
  const c=s.compton;
  return {t:0,incidentWavelengthNm:c.incidentWavelengthNm,scatteredWavelengthNm:c.scatteredWavelengthNm,deltaLambdaPm:c.deltaLambdaNm*1000,
    incidentEnergyKev:c.incidentEnergyKev,scatteredEnergyKev:c.scatteredEnergyKev,electronKineticKev:c.electronKineticKev,
    recoilAngleDefined:Number(c.recoilAngleDefined),...(c.recoilAngleDefined?{recoilAngleDeg:c.recoilAngleDeg}:{}),
    pIncident:c.pIncident,pScattered:c.pScattered,pElectron:c.pElectron,pElectronX:c.pElectronX,pElectronY:c.pElectronY,
    momentumResidualRel:Math.hypot(c.pxResidualRel,c.pyResidualRel),massShellResidualRel:c.massShellResidualRel,energyResidualRel:c.energyResidualRel};
}
export function checkInvariants(s:PhotoelectricComptonState):InvariantReport[]{
  const inv=(name:string,error:number,tolerance=1e-10,unit?:string):InvariantReport=>({name,measuredError:Math.abs(error),tolerance,passed:Number.isFinite(error)&&Math.abs(error)<=tolerance,...(unit?{unit}:{})});
  if(s.mode==='photoelectric'){
    const p=s.photoelectric,err=p.thresholdPassed?Math.abs(p.photonEnergyEv-p.workFunctionEv-p.maxKineticEv):Math.abs(p.maxKineticEv);
    return [inv('爱因斯坦能量方程残差',err,1e-10,'eV'),
      inv('经验电流边界',Math.max(0,-p.currentMa,p.currentMa-p.saturationCurrentMa)),
      inv('无光或未过阈时电流为零',p.emissionActive?0:p.currentMa),inv('静态解析比较无物理时间',s.t,0)];
  }
  const c=s.compton;
  return [inv('康普顿相对论动量闭合',Math.hypot(c.pxResidualRel,c.pyResidualRel)),inv('能量守恒',c.energyResidualRel),
    inv('独立动量分量的质壳关系',c.massShellResidualRel),inv('静态解析比较无物理时间',s.t,0)];
}
