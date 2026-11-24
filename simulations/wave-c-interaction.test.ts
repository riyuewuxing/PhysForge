import { describe, expect, it } from 'vitest';
import {
  resolvePluginParams,
  type ForceVectorItem,
  type ParamRecord,
  type SimulationPluginV2
} from '@physforge/sim-sdk';
import { loadSimulationById, simulationCatalog } from './catalog.js';

describe('Wave C: full-catalog interaction coverage and anti-placeholder audit', () => {
  it('all catalog plugins expose usable control handles with finite runnable parameter patches', async () => {
    for (const entry of simulationCatalog) {
      const modelId = entry.meta.id;
      const loaded = await loadSimulationById(modelId);
      expect(loaded, `${modelId} could not be loaded`).toBeDefined();
      const plugin = loaded as SimulationPluginV2<ParamRecord, unknown>;
      expect(typeof plugin.getControlHandles, `${modelId} missing getControlHandles`).toBe('function');

      const presets = plugin.presets.length > 0 ? plugin.presets : [null];
      let testedAtLeastOneHandle = false;

      for (const preset of presets) {
        const params = resolvePluginParams(plugin.paramSchema, preset?.params);
        const state = plugin.engine.createInitialState(params);
        const handles = plugin.getControlHandles?.(state, params) ?? [];
        if (handles.length === 0) continue;

        testedAtLeastOneHandle = true;
        for (const handle of handles) {
          expect(handle.id.trim().length, `${modelId} empty handle.id`).toBeGreaterThan(0);
          expect(handle.label.trim().length, `${modelId} empty handle.label`).toBeGreaterThan(0);
          expect(Number.isFinite(handle.position.x) && Number.isFinite(handle.position.y), `${modelId} handle ${handle.id} position is non-finite`).toBe(true);
          if (handle.origin) {
            expect(Number.isFinite(handle.origin.x) && Number.isFinite(handle.origin.y), `${modelId} handle ${handle.id} origin is non-finite`).toBe(true);
          }

          const patch = handle.onDrag({ x: handle.position.x + 0.35, y: handle.position.y + 0.25 });
          const patchKeys = Object.keys(patch);
          expect(patchKeys.length, `${modelId} handle ${handle.id} returned an empty patch`).toBeGreaterThan(0);

          const nextParams = resolvePluginParams(plugin.paramSchema, { ...params, ...patch });
          const nextState = plugin.engine.createInitialState(nextParams);
          const stepped = plugin.engine.step(nextState, nextParams, 1 / 120);
          const observables = plugin.engine.computeObservables(stepped.nextState, nextParams);
          for (const [key, value] of Object.entries(observables)) {
            const energyNorm = observables.energyNorm;
            const expectedUnboundSemiMajorAxis = modelId === 'astro-orbital-mechanics'
              && typeof energyNorm === 'number'
              && Number.isFinite(energyNorm)
              && energyNorm >= -1e-12
              && (key === 'semiMajorAxisNorm' || key === 'aSI')
              && value === Infinity;
            expect(Number.isFinite(value) || expectedUnboundSemiMajorAxis, `${modelId} handle ${handle.id} produced invalid observable ${key}`).toBe(true);
          }
        }
      }

      expect(testedAtLeastOneHandle, `${modelId} returned no control handles across its presets`).toBe(true);
    }
  }, 20000);

  it('at least 30 plugins expose authentic force vectors and at least 20 expose valid moving frames', async () => {
    let forcePluginCount = 0;
    let framePluginCount = 0;

    for (const entry of simulationCatalog) {
      const modelId = entry.meta.id;
      const loaded = await loadSimulationById(modelId);
      expect(loaded, `${modelId} could not be loaded`).toBeDefined();
      const plugin = loaded as SimulationPluginV2<ParamRecord, unknown>;
      const defaultParams = resolvePluginParams(plugin.paramSchema, plugin.presets[0]?.params);
      let state = plugin.engine.createInitialState(defaultParams);
      for (let index = 0; index < 8; index += 1) {
        state = plugin.engine.step(state, defaultParams, 1 / 60).nextState;
      }

      if (plugin.getForceVectors) {
        forcePluginCount += 1;
        const presets = plugin.presets.length > 0 ? plugin.presets : [null];
        let hasNonZeroForce = false;

        for (const preset of presets) {
          const params = resolvePluginParams(plugin.paramSchema, preset?.params);
          let presetState = plugin.engine.createInitialState(params);
          for (let index = 0; index < 8; index += 1) {
            presetState = plugin.engine.step(presetState, params, 1 / 60).nextState;
          }

          const vectors: ForceVectorItem[] = plugin.getForceVectors(presetState, params);
          for (const vector of vectors) {
            expect(vector.id.trim().length, `${modelId} empty force id`).toBeGreaterThan(0);
            expect(vector.label.trim().length, `${modelId} force ${vector.id} empty label`).toBeGreaterThan(0);
            expect(Number.isFinite(vector.origin.x) && Number.isFinite(vector.origin.y), `${modelId} force ${vector.id} origin is non-finite`).toBe(true);
            expect(Number.isFinite(vector.force.x) && Number.isFinite(vector.force.y), `${modelId} force ${vector.id} vector is non-finite`).toBe(true);
            if (vector.force.x !== 0 || vector.force.y !== 0) hasNonZeroForce = true;
          }
        }

        expect(hasNonZeroForce, `${modelId} produced only empty or zero forces across its presets`).toBe(true);
      }

      if (plugin.referenceFrames && plugin.referenceFrames.length > 0) {
        framePluginCount += 1;
        for (const frame of plugin.referenceFrames) {
          expect(frame.id.trim().length, `${modelId} empty reference frame id`).toBeGreaterThan(0);
          expect(frame.id, `${modelId} frame id collides with built-in ground`).not.toBe('ground');
          expect(frame.label.trim().length, `${modelId} frame ${frame.id} empty label`).toBeGreaterThan(0);
          const origin = frame.getOrigin(state, defaultParams);
          expect(Number.isFinite(origin.x) && Number.isFinite(origin.y), `${modelId} frame ${frame.id} origin is non-finite`).toBe(true);
          if (frame.getVelocity) {
            const velocity = frame.getVelocity(state, defaultParams);
            expect(Number.isFinite(velocity.x) && Number.isFinite(velocity.y), `${modelId} frame ${frame.id} velocity is non-finite`).toBe(true);
          }
        }
      }
    }

    expect(forcePluginCount).toBeGreaterThanOrEqual(30);
    expect(framePluginCount).toBeGreaterThanOrEqual(20);
  });
});
