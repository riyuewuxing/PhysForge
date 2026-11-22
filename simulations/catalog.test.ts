import { resolvePluginParams, type SimulationPluginV2 } from '@physforge/sim-sdk';
import { describe, expect, it } from 'vitest';
import { loadSimulationById, resolveCanonicalModelId, simulationCatalog } from './catalog.js';
import { simulationPlugins } from './registry.js';

describe('@physforge/simulations catalog vs registry parity & 43-unit contract', () => {
  it('keeps lightweight catalog metadata 1:1 synced with full plugin registry and dynamic loaders', async () => {
    expect(simulationCatalog.length).toBe(43);
    expect(simulationCatalog.length).toBe(simulationPlugins.length);

    for (const plugin of simulationPlugins) {
      const entry = simulationCatalog.find((c) => c.meta.id === plugin.meta.id);
      expect(entry).toBeDefined();
      expect(entry!.meta).toEqual(plugin.meta);

      const loaded = await loadSimulationById(plugin.meta.id);
      expect(loaded).toBeDefined();
      expect(loaded!.meta.id).toBe(plugin.meta.id);
    }

    const legacyLoaded = await loadSimulationById('em-bounded-magnetic-field');
    expect(legacyLoaded?.meta.id).toBe(resolveCanonicalModelId('em-bounded-magnetic-field'));
  });

  it.each(simulationCatalog.map((c) => [c.meta.id, c.meta.title]))(
    'runs headless contract (init, 5 steps, finite observables, invariants, DiagramIR) for %s (%s)',
    async (modelId) => {
      const plugin = await loadSimulationById(modelId);
      expect(plugin).toBeDefined();
      const firstPreset = plugin!.presets[0];
      expect(firstPreset).toBeDefined();

      const params = resolvePluginParams(plugin!.paramSchema, firstPreset!.params);
      const init = plugin!.engine.createInitialState(params);
      let state = init;
      for (let i = 0; i < 5; i++) {
        state = plugin!.engine.step(state, params, 0.02).nextState;
      }

      const obs = plugin!.engine.computeObservables(state, params);
      for (const val of Object.values(obs)) {
        expect(Number.isFinite(val)).toBe(true);
      }

      if (plugin!.engine.checkInvariants) {
        for (const inv of plugin!.engine.checkInvariants(state, init, params)) {
          expect(inv.passed).toBe(true);
        }
      }

      const v2 = plugin as unknown as SimulationPluginV2<typeof params, typeof state>;
      if (v2.exportDiagramIR) {
        const ir = v2.exportDiagramIR(state, params);
        expect(ir.primitives.length).toBeGreaterThan(0);
      }
    }
  );
});
