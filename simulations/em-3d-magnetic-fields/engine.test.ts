import { resolvePluginParams } from '@physforge/sim-sdk';
import { describe, expect, it } from 'vitest';
import { em3dMagneticFieldsPlugin } from './plugin.js';
import { magnetic3dPresets } from './presets.js';
import {
  MU_0,
  checkInvariants,
  createInitialState,
  evalBiotSavartB,
  stepMagnetic3d,
  type Magnetic3dParams
} from './engine.js';

function getPreset(idx: number): Magnetic3dParams {
  return resolvePluginParams(em3dMagneticFieldsPlugin.paramSchema, magnetic3dPresets[idx]!.params);
}

describe('em-3d-magnetic-fields Biot-Savart & 3D Boris invariants (E10)', () => {
  it('matches single circular loop on-axis Biot-Savart formula within < 1e-4 relative error', () => {
    const params = getPreset(1); // single-loop
    const R = params.radiusR;
    const I = params.currentI;
    for (const z of [0, 0.5, 1.2]) {
      const b = evalBiotSavartB({ x: 0, y: 0, z }, params);
      const expectedBz = (MU_0 * I * R * R) / (2 * Math.pow(R * R + z * z, 1.5));
      expect(Math.hypot(b.x, b.y)).toBeLessThan(1e-12);
      expect(Math.abs(b.z - expectedBz) / expectedBz).toBeLessThan(1e-4);
    }
  });

  it('matches 3D uniform helical pitch p = v_parallel * (2*pi*m)/(q*B) within < 1e-5 and conserves energy', () => {
    const helix = getPreset(3);
    const period = (2 * Math.PI) / (helix.qOverM * helix.uniformBz);
    const expectedPitch = helix.vParallel * period;
    let st = createInitialState(helix);
    const z0 = st.position.z;
    const nSteps = 200;
    const dt = period / nSteps;
    for (let i = 0; i < nSteps; i++) {
      st = stepMagnetic3d(st, helix, dt).nextState;
    }
    const dz = st.position.z - z0;
    expect(Math.abs(dz - expectedPitch) / expectedPitch).toBeLessThan(1e-5);
    expect(checkInvariants(st)[0]!.passed).toBe(true);
    expect(checkInvariants(st)[0]!.measuredError).toBeLessThan(1e-10);
  });

  it('handles I=0, qOverM=0, dt=0 boundaries cleanly without NaN', () => {
    const p0: Magnetic3dParams = { ...getPreset(0), currentI: 0, qOverM: 0 };
    const s0 = createInitialState(p0);
    expect(stepMagnetic3d(s0, p0, 0).nextState).toEqual(s0);
    const s1 = stepMagnetic3d(s0, p0, 0.1).nextState;
    expect(Number.isFinite(s1.position.x)).toBe(true);
  });
});
