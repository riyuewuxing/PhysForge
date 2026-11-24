import { describe, expect, it } from 'vitest';
import { closestDisplayFrame, createDisplayLayerSelector, selectDisplayFrame } from './displayFrame.js';

describe('shared stage display frame', () => {
  const previousState = { x: 1 };
  const currentState = { x: 1.2 };
  const snapshots = [{ t: 0, state: { x: 0 }, observables: { x: 0 } },
    { t: 1, state: previousState, observables: { x: 1 } }];
  const input = { modelId: 'e10', ownerModelId: 'e10', resetNonce: 3, ownerResetNonce: 3, currentState, currentTime: 1.2, scrubTime: null, snapshots };

  it('uses the actual latest state for live display, not the last recorded sample', () => {
    const live = selectDisplayFrame(input);
    expect(live?.t).toBe(1.2);
    expect(live?.state).toBe(currentState);
    expect(live?.observables).toBeUndefined();
  });
  it('uses the same recorded state and observation for scrubbed time', () => {
    const replay = selectDisplayFrame({ ...input, scrubTime: 0.8 });
    expect(replay).toBe(snapshots[1]);
    expect(replay?.state).toBe(previousState);
    expect(replay?.observables?.x).toBe(1);
    expect(closestDisplayFrame(snapshots, -10)).toBe(snapshots[0]);
    expect(closestDisplayFrame(snapshots, 10)).toBe(snapshots[1]);
    expect(closestDisplayFrame(snapshots, NaN)).toBeNull();
    expect(closestDisplayFrame([], 0)).toBeNull();
  });
  it('never passes another model state into a newly mounted renderer', () => {
    expect(selectDisplayFrame({ ...input, ownerModelId: 's01' })).toBeNull();
    expect(selectDisplayFrame({ ...input, resetNonce: 4 })).toBeNull();
    expect(selectDisplayFrame({ ...input, ownerModelId: null, scrubTime: 0.5 })).toBeNull();
    expect(selectDisplayFrame({ ...input, currentState: 0 })?.state).toBe(0);
    expect(selectDisplayFrame({ ...input, currentState: null })).toBeNull();
  });
  it('shares identical mask semantics and stable layer identity across frames', () => {
    const select = createDisplayLayerSelector();
    const layers = ['fieldRegion', 'trajectory', 'larmorCircle', 'eventPins'];
    const ordinary = select(layers, false);
    expect(ordinary).toEqual(new Set(layers));
    expect(select(layers, false)).toBe(ordinary);
    const masked = select(layers, true);
    expect(masked).toEqual(new Set(['fieldRegion']));
    expect(select(layers, true)).toBe(masked);
    expect(layers).toHaveLength(4);
    expect(select(layers, false)).toEqual(ordinary);
    expect(select(['fieldRegion', 'rods'], true)).toEqual(new Set(['fieldRegion', 'rods']));
  });
});
