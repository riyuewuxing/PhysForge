import { resolvePluginParams } from '@physforge/sim-sdk';
import { describe, expect, it } from 'vitest';
import { emTransformerGridPlugin } from './plugin.js';
import { transformerGridPresets } from './presets.js';
import {
  createInitialState,
  solveTransformerMetrics,
  stepTransformerGrid,
  type TransformerGridParams
} from './engine.js';

function getPreset(idx: number): TransformerGridParams {
  return resolvePluginParams(emTransformerGridPlugin.paramSchema, transformerGridPresets[idx]!.params);
}

describe('em-transformer-grid conservation & 1/4 power-loss scaling (E08)', () => {
  it('satisfies multi-tap ideal transformer power conservation sum(Uk*Ik) = U1*I1 within < 1e-10', () => {
    const p = getPreset(0);
    const m = solveTransformerMetrics(p);
    const pSec = m.u2 * m.i2 + m.u3 * m.i3;
    expect(Math.abs(pSec - m.u1 * m.i1) / (m.u1 * m.i1)).toBeLessThan(1e-10);
  });

  it('reduces transmission line loss strictly to 1/4 when doubling step-up turns ratio at constant power', () => {
    const grid10 = { ...getPreset(1), stepUpRatioK1: 10 };
    const grid20 = { ...getPreset(1), stepUpRatioK1: 20 };
    const m10 = solveTransformerMetrics(grid10);
    const m20 = solveTransformerMetrics(grid20);
    expect(Math.abs(m20.pLineLossW / m10.pLineLossW - 0.25)).toBeLessThan(1e-10);
  });

  it('handles zero power and zero dt cleanly without NaN', () => {
    const p0: TransformerGridParams = { ...getPreset(1), genPowerKw: 0 };
    const s0 = createInitialState(p0);
    expect(stepTransformerGrid(s0, p0, 0).nextState.current.pLineLossW).toBe(0);
    const s1 = stepTransformerGrid(s0, p0, 0.05).nextState;
    expect(Number.isFinite(s1.current.efficiency)).toBe(true);
  });
});
