import { resolvePluginParams } from '@physforge/sim-sdk';
import { describe, expect, it } from 'vitest';
import { stseEmDevicesSuitePlugin } from './plugin.js';
import { emDevicesPresets } from './presets.js';
import { BEAM_LENGTH_M,RIGHT_X,SELECTOR_HALF_GAP,beamScale,sampleBeamFlight } from './particleFlight.js';
import {
  computeCyclotronExitMetrics,
  computeHallVoltageV,
  computeMhdMetrics,
  createInitialState,
  stepEmDevices,
  checkInvariants,
  type EmDevicesParams
} from './engine.js';

function getPreset(idx: number): EmDevicesParams {
  return resolvePluginParams(stseEmDevicesSuitePlugin.paramSchema, emDevicesPresets[idx]!.params);
}

describe('stse-em-devices-suite physics invariants (S02)', () => {
  it('selects v=E/B exactly and locates exit once at the physical aperture',()=>{
    const p={...getPreset(3),device:'velocity-selector' as const};
    const init=createInitialState(p),out=stepEmDevices(init,p,100);
    expect(out.nextState.flight?.status).toBe('transmitted');
    expect(out.nextState.particlePos.x).toBeCloseTo(RIGHT_X,8);
    expect(out.nextState.particlePos.y).toBeCloseTo(0,12);
    expect(out.nextState.flight?.physicalTimeS).toBeCloseTo(3*BEAM_LENGTH_M/p.particleSpeedMps,14);
    expect(out.events).toHaveLength(1);
    expect(stepEmDevices(out.nextState,p,1).events).toHaveLength(0);
    expect(stepEmDevices(out.nextState,p,1).nextState.particlePos).toEqual(out.nextState.particlePos);
  });
  it('uses the actual Lorentz acceleration on both sides of the selected speed and conserves work-energy',()=>{
    const base={...getPreset(3),device:'velocity-selector' as const};
    for(const speed of [0.5*base.eFieldVPerM/base.bFieldT,1.5*base.eFieldVPerM/base.bFieldT]){
      const p={...base,particleSpeedMps:speed},omega=p.chargeC*p.bFieldT/p.massKg;
      const f=sampleBeamFlight(p,1e-3/omega);
      const accel=p.chargeC*(p.eFieldVPerM-speed*p.bFieldT)/p.massKg;
      expect(f.velocityMps.y/(1e-3/omega)/accel).toBeCloseTo(1,5);
      expect(Math.sign(f.position.y)).toBe(Math.sign(accel));
      const init=createInitialState(p),s=stepEmDevices(init,p,0.25).nextState;
      expect(checkInvariants(s,init,p)[0]?.passed).toBe(true);
      const terminal=stepEmDevices(init,p,100).nextState;
      expect(Math.abs(terminal.particlePos.y)).toBeLessThanOrEqual(SELECTOR_HALF_GAP+1e-8);
    }
  });
  it('maps a true half circle to the same spatial scale for different m, q and B2',()=>{
    const base={...getPreset(3),device:'mass-spectrometer' as const,massKg:1.67262192369e-27};
    for(const p of [base,{...base,massKg:base.massKg*2},{...base,bDeflectT:base.bDeflectT*2},{...base,chargeC:base.chargeC*2}]){
      const init=createInitialState(p),omega=p.chargeC*p.bDeflectT/p.massKg;
      const radius=p.massKg*p.particleSpeedMps/(p.chargeC*p.bDeflectT),entry=1.5*BEAM_LENGTH_M/p.particleSpeedMps;
      const f=sampleBeamFlight(p,entry+Math.PI/(2*omega));
      expect(f.position.x*BEAM_LENGTH_M).toBeCloseTo(radius,10);
      expect(f.position.y*BEAM_LENGTH_M).toBeCloseTo(-radius,10);
      expect(f.velocityMps.y).toBeCloseTo(-p.particleSpeedMps,5);
      const out=stepEmDevices(init,p,10),s=out.nextState;
      expect(s.flight?.status).toBe('detected');
      expect(s.particlePos.x).toBeCloseTo(0,10);
      expect(s.particlePos.y*BEAM_LENGTH_M).toBeCloseTo(-2*radius,10);
      expect(checkInvariants(s,init,p)[0]?.passed).toBe(true);
      expect(out.events).toHaveLength(1);
      expect(s.trail.length).toBeGreaterThan(100);
      expect(stseEmDevicesSuitePlugin.getForceVectors!(init,p,new Set(['main']))).toEqual([]);
      const mid=stepEmDevices(init,p,(entry+Math.PI/(2*omega))/beamScale(p).timeUnit).nextState;
      const force=stseEmDevicesSuitePlugin.getForceVectors!(mid,p,new Set(['main']))[0]!.force;
      expect(force.x).toBeLessThan(0);
      expect(Math.abs(force.y/force.x)).toBeLessThan(1e-8);
    }
  });
  it('stops at the finite analyzer wall when the orbit cannot fit, without inventing a detector hit',()=>{
    const p={...getPreset(3),device:'mass-spectrometer' as const,massKg:1e-25,bDeflectT:0.2};
    const out=stepEmDevices(createInitialState(p),p,10);
    expect(out.nextState.flight?.status).toBe('missed');
    expect(out.nextState.particlePos.x).toBeCloseTo(RIGHT_X,8);
    expect(out.events[0]?.id).toBe('beam-missed');
  });
  it('matches classic cyclotron exit kinetic energy (< 1e-5) and demonstrates relativistic detuning', () => {
    const classic = getPreset(0);
    const metrics = computeCyclotronExitMetrics(classic);
    expect(metrics.relError).toBeLessThan(1e-5);

    const rel = { ...classic, bFieldT: 3.5, cyclotronRadiusM: 1.0, relativisticDetune: true };
    const relMetrics = computeCyclotronExitMetrics(rel);
    expect(relMetrics.discreteMaxJ).toBeLessThanOrEqual(relMetrics.analyticalMaxJ);
  });

  it('flips Hall voltage sign between electron and hole (< 1e-8) and maximizes MHD power at R = r', () => {
    const pElec = getPreset(1);
    const uElec = computeHallVoltageV(pElec);
    const uHole = computeHallVoltageV({ ...pElec, carrierType: 'hole' });
    expect(uElec).toBeLessThan(0);
    expect(uHole).toBeGreaterThan(0);
    expect(Math.abs(uElec + uHole)).toBeLessThan(1e-8);

    const pMhd = getPreset(2);
    const mMatch = computeMhdMetrics(pMhd);
    const mAtExactR = computeMhdMetrics({ ...pMhd, mhdLoadOhm: mMatch.internalOhm });
    const mLowR = computeMhdMetrics({ ...pMhd, mhdLoadOhm: mMatch.internalOhm * 0.5 });
    const mHighR = computeMhdMetrics({ ...pMhd, mhdLoadOhm: mMatch.internalOhm * 2.0 });
    expect(Math.abs(mAtExactR.outputWatt - mAtExactR.maxPowerWatt)).toBeLessThan(1e-8);
    expect(mAtExactR.outputWatt).toBeGreaterThan(mLowR.outputWatt);
    expect(mAtExactR.outputWatt).toBeGreaterThan(mHighR.outputWatt);
  });

  it('handles dt=0 cleanly across all 6 devices without NaN', () => {
    for (const dev of ['velocity-selector', 'mass-spectrometer', 'cyclotron', 'hall-sensor', 'mhd-generator', 'em-flowmeter'] as const) {
      const p: EmDevicesParams = { ...getPreset(0), device: dev };
      const st = createInitialState(p);
      expect(stepEmDevices(st, p, 0).nextState.t).toBe(0);
      expect(Number.isFinite(st.selectedSpeed)).toBe(true);
    }
  });
});
